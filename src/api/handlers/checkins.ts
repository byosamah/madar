import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { Checkin, CheckinKind, Day, TaskId, type CheckinItem } from '../contract/entities';
import { CHECKIN_LIMITS } from '../contract/limits';
import { CheckinMine, WeekView } from '../contract/views';
import { invalid } from '../errors';
import { applyPatch, recordCreate } from '../events';
import { checkinsOf, nextId, type State } from '../store';
import { cardOf } from '../views';
import { addDays } from '../../lib/dates';
import { involves } from '../../lib/taskPeople';
import { reviewDay, weekHasBegun, weekOf } from '../../lib/week';
import { assertCan } from './shared';

/**
 * The weekly question (fbk_088, owner 2026-11-08). Sunday: "What do you plan this week?". Thursday: "What did you do this week?". One person has
 * at most one answer for each week and kind. Everyone who holds "Read the weekly answers" reads every answer. Only the author writes the own
 * answer of the current week, with the switch "Answer the weekly question". The Undo of a save takes it back (events checkin.created and
 * checkin.updated), and only its author may do that (assertMayUndo in history.ts).
 */

/** The week of an input: the Sunday of the day, or of today. A week that has not begun has no answer, so it is refused. */
function weekOfInput(day: string | undefined, today: string): string {
  const week = weekOf(day ?? today);
  if (!weekHasBegun(week, today)) throw invalid('week', 'This week has not begun yet.', 'week_future');
  return week;
}

/**
 * True when the title of a to-do may stand in an answer that everyone reads. A to-do with no project is private to its people, and a to-do of
 * a hidden project is private to the people of that project, so neither title goes into an answer (the card leaves them out; this is the
 * rule of the server for an agent and for a stale screen).
 */
function mayShareTitle(state: State, task: { projectId: string | null }): boolean {
  if (task.projectId === null) return false;
  const project = state.projects[task.projectId];
  return project !== undefined && project.access?.hidden !== true;
}

/**
 * The lines of an answer from the ids of the to-dos that the person keeps. A to-do must exist and be the person's own (lead or helper); an
 * id of another person's to-do is refused. A to-do whose title may not be shared is left out. The title is the one the to-do has now.
 */
function checkinItems(ctx: Ctx, ids: readonly string[]): CheckinItem[] {
  const me = ctx.authority.id;
  const items: CheckinItem[] = [];
  for (const id of new Set(ids)) {
    const task = ctx.state.tasks[id];
    if (!task || !involves(task, me)) throw invalid('items', 'Keep only the to-dos that you lead or help with.', 'not_your_task');
    if (mayShareTitle(ctx.state, task)) items.push({ taskId: task.id, title: task.title.slice(0, CHECKIN_LIMITS.titleMax) });
  }
  return items;
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
    return { week, plan: of('plan'), review: of('review') };
  },
});

/** Saves the own answer of the current week, for the plan or the review. A second save changes the same answer. */
const checkinsSave = defineCall({
  input: z.object({ kind: CheckinKind, items: z.array(TaskId).max(CHECKIN_LIMITS.itemsMax), text: z.string().trim().max(CHECKIN_LIMITS.textMax) }),
  output: Checkin,
  run(input, ctx) {
    assertCan(ctx, 'checkin.answer');
    const me = ctx.authority.id;
    const week = weekOf(ctx.today);
    const items = checkinItems(ctx, input.items);
    if (items.length === 0 && input.text === '') throw invalid('text', 'Write a line, or keep a to-do.', 'empty_answer');
    const old = Object.values(checkinsOf(ctx.state)).find((one) => one.userId === me && one.week === week && one.kind === input.kind);
    if (!old) {
      const id = nextId(ctx.state, 'chk');
      const answer: Checkin = { id, userId: me, week, kind: input.kind, items, text: input.text, createdAt: ctx.stamp, updatedAt: ctx.stamp };
      checkinsOf(ctx.state)[id] = answer;
      recordCreate(ctx, { projectId: null, verb: 'checkin.created', targetType: 'checkin', targetId: id, entity: answer });
      return answer;
    }
    // The same lines and the same text change nothing and write no event.
    if (JSON.stringify(old.items) === JSON.stringify(items) && old.text === input.text) return old;
    applyPatch(ctx, old, { items, text: input.text, updatedAt: ctx.stamp }, { projectId: null, verb: 'checkin.updated', targetType: 'checkin', targetId: old.id });
    return old;
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
    const answered = (userId: string, kind: CheckinKind) => answers.find((one) => one.userId === userId && one.kind === kind) ?? null;
    const rows = people
      .filter((user) => answers.some((one) => one.userId === user.id))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((user) => ({ user: cardOf(ctx.state, user.id), plan: answered(user.id, 'plan'), review: answered(user.id, 'review') }));
    const active = people.filter((user) => user.active).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const reviewDue = reviewDay(week) <= ctx.today;
    const missing = {
      plan: active.filter((user) => !answered(user.id, 'plan')).map((user) => cardOf(ctx.state, user.id)),
      review: reviewDue ? active.filter((user) => !answered(user.id, 'review')).map((user) => cardOf(ctx.state, user.id)) : [],
    };
    return { week, previous: addDays(week, -7), next: week < weekOf(ctx.today) ? addDays(week, 7) : null, rows, missing };
  },
});

export const checkinCalls = {
  'checkins.mine': checkinsMine,
  'checkins.save': checkinsSave,
  'checkins.week': checkinsWeek,
};
