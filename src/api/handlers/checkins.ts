import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { Checkin, CheckinKind, Day, TaskId, type User } from '../contract/entities';
import { CHECKIN_LIMITS } from '../contract/limits';
import { CheckinItem, CheckinMine, CheckinView, WeekView } from '../contract/views';
import { invalid } from '../errors';
import { applyPatch, recordCreate } from '../events';
import { checkinsOf, nextId, type State } from '../store';
import { cardOf } from '../views';
import { addDays, stampDay } from '../../lib/dates';
import { can, mayViewTask } from '../permissions';
import { withRights } from '../rights';
import { involves } from '../../lib/taskPeople';
import { reviewDay, weekHasBegun, weekOf } from '../../lib/week';
import { assertCan } from './shared';

/**
 * The weekly question (fbk_088, owner 2026-11-08). Sunday: "What do you plan this week?". Thursday: "What did you do this week?". One person has
 * at most one answer for each week and kind. Everyone who holds "Read the weekly answers" reads every answer. Only the author writes the own
 * answer of the current week, with the switch "Answer the weekly question". The Undo of a save takes it back (events checkin.created and
 * checkin.updated), and only its author may do that (assertMayUndo in history.ts). Those events show only to the holders of "Read the weekly
 * answers" and to the author (seesEvent in history.ts).
 * An answer stores the ids of the kept to-dos, never a title. Every read builds the lines from the live to-dos that the reader may view (viewOf).
 */

/** The week of an input: the Sunday of the day, or of today. A week that has not begun has no answer, so it is refused. */
function weekOfInput(day: string | undefined, today: string): string {
  const week = weekOf(day ?? today);
  if (!weekHasBegun(week, today)) throw invalid('week', 'This week has not begun yet.', 'week_future');
  return week;
}

/**
 * The ids of the to-dos that the person keeps. A to-do must exist and be the person's own (lead or helper); an id of another person's to-do is
 * refused. The answer keeps the ids only (security review of fbk_088): an office to-do and a to-do of a hidden project go in as well, because
 * `viewOf` leaves out of every read the to-do that the reader may not view.
 */
function checkinTaskIds(ctx: Ctx, ids: readonly string[]): string[] {
  const me = ctx.authority.id;
  const kept: string[] = [];
  for (const id of new Set(ids)) {
    const task = ctx.state.tasks[id];
    if (!task || !involves(task, me)) throw invalid('items', 'Keep only the to-dos that you lead or help with.', 'not_your_task');
    kept.push(task.id);
  }
  return kept;
}

/**
 * An answer as the reader gets it: each line is built now, from the live to-do with the title it has now, and only when the reader may view
 * that to-do (mayViewTask, the one view rule of a to-do). A to-do that the reader may not view, or that is gone, gives no line, and nothing in the
 * answer tells that it was kept. So a project that is hidden after the answer hides its titles at once.
 */
function viewOf(ctx: Ctx, answer: Checkin): CheckinView {
  const { taskIds, ...rest } = answer;
  const items: CheckinItem[] = [];
  for (const id of taskIds) {
    const task = ctx.state.tasks[id];
    if (task && mayViewTask(ctx.state, ctx.authority, task)) items.push({ taskId: task.id, title: task.title.slice(0, CHECKIN_LIMITS.titleMax) });
  }
  return { ...rest, items };
}

const WeekInput = z.object({ week: Day.optional() });

/** The own answers of one week. No switch: a person always reads the own rows, and the rows of nobody else are in the answer. */
const checkinsMine = defineCall({
  input: WeekInput,
  output: CheckinMine,
  readOnly: true,
  run(input, ctx) {
    const week = weekOfInput(input.week, ctx.today);
    const mine = Object.values(checkinsOf(ctx.state)).filter((one) => one.userId === ctx.authority.id && one.week === week);
    const of = (kind: CheckinKind) => mine.find((one) => one.kind === kind) ?? null;
    const view = (one: Checkin | null) => (one ? viewOf(ctx, one) : null);
    return { week, plan: view(of('plan')), review: view(of('review')) };
  },
});

/** Saves the own answer of the current week, for the plan or the review. A second save changes the same answer. */
const checkinsSave = defineCall({
  input: z.object({ kind: CheckinKind, items: z.array(TaskId).max(CHECKIN_LIMITS.itemsMax), text: z.string().trim().max(CHECKIN_LIMITS.textMax) }),
  output: CheckinView,
  run(input, ctx) {
    assertCan(ctx, 'checkin.answer');
    const me = ctx.authority.id;
    const week = weekOf(ctx.today);
    // The review opens on its Thursday, as Home asks for it only from Thursday. The plan opens on every day of the week.
    if (input.kind === 'review' && reviewDay(week) > ctx.today) throw invalid('kind', 'The review of the week opens on Thursday.', 'review_not_yet');
    const taskIds = checkinTaskIds(ctx, input.items);
    if (taskIds.length === 0 && input.text === '') throw invalid('text', 'Write a line, or keep a to-do.', 'empty_answer');
    const old = Object.values(checkinsOf(ctx.state)).find((one) => one.userId === me && one.week === week && one.kind === input.kind);
    if (!old) {
      const id = nextId(ctx.state, 'chk');
      const answer: Checkin = { id, userId: me, week, kind: input.kind, taskIds, text: input.text, createdAt: ctx.stamp, updatedAt: ctx.stamp };
      checkinsOf(ctx.state)[id] = answer;
      recordCreate(ctx, { projectId: null, verb: 'checkin.created', targetType: 'checkin', targetId: id, entity: answer });
      return viewOf(ctx, answer);
    }
    // The same lines and the same text change nothing and write no event.
    if (JSON.stringify(old.taskIds) === JSON.stringify(taskIds) && old.text === input.text) return viewOf(ctx, old);
    applyPatch(ctx, old, { taskIds, text: input.text, updatedAt: ctx.stamp }, { projectId: null, verb: 'checkin.updated', targetType: 'checkin', targetId: old.id });
    return viewOf(ctx, old);
  },
});

/**
 * The week of the team: every answer of one week, one row for each person, and who has not answered. It needs "Read the weekly answers".
 * The review list of `missing` is empty before the review is due (the Thursday of the week).
 */
const checkinsWeek = defineCall({
  input: WeekInput,
  output: WeekView,
  readOnly: true,
  run(input, ctx) {
    assertCan(ctx, 'checkin.read');
    const week = weekOfInput(input.week, ctx.today);
    const answers = Object.values(checkinsOf(ctx.state)).filter((one) => one.week === week);
    const people = Object.values(ctx.state.users).filter((user) => user.kind === 'human');
    const find = (userId: string, kind: CheckinKind) => answers.find((one) => one.userId === userId && one.kind === kind);
    const answered = (userId: string, kind: CheckinKind) => {
      const one = find(userId, kind);
      return one ? viewOf(ctx, one) : null;
    };
    const rows = people
      .filter((user) => answers.some((one) => one.userId === user.id))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((user) => ({ user: cardOf(ctx.state, user.id), plan: answered(user.id, 'plan'), review: answered(user.id, 'review') }));
    // Only a person who may answer can be missing. This is the same test as `runScheduledTriggers` (notify.ts): one rule, two places.
    const active = people.filter((user) => user.active && can(withRights(ctx.state, user), 'checkin.answer')).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const reviewDue = reviewDay(week) <= ctx.today;
    // A person is missing only for a question that came after the person was added: the plan opens on the Sunday and the review on the
    // Thursday of the week. A person with no `createdAt` was there from the start.
    const joinedAfter = (user: User, due: string) => user.createdAt !== undefined && stampDay(user.createdAt) > due;
    const missing = {
      plan: active.filter((user) => !find(user.id, 'plan') && !joinedAfter(user, week)).map((user) => cardOf(ctx.state, user.id)),
      review: reviewDue ? active.filter((user) => !find(user.id, 'review') && !joinedAfter(user, reviewDay(week))).map((user) => cardOf(ctx.state, user.id)) : [],
    };
    return { week, previous: addDays(week, -7), next: week < weekOf(ctx.today) ? addDays(week, 7) : null, rows, missing };
  },
});

export const checkinCalls = {
  'checkins.mine': checkinsMine,
  'checkins.save': checkinsSave,
  'checkins.week': checkinsWeek,
};
