import type { Checkin } from '../../../src/api/contract/entities';
import { can } from '../../../src/api/permissions';
import { todayISO } from '../../../src/lib/dates';
import { weekOf } from '../../../src/lib/week';
import type { Load } from './build';

/**
 * The loaders of the weekly question (fbk_088). An answer is no office list: a call reads the rows of one week, or the rows of one person in
 * one week. About 30 rows a week, so the whole-office read of each request does not grow. The week is the Sunday of the day that the call names,
 * else of today (LoadCtx.now). The handler refuses a week that has not begun, and the loader reads it as an empty week.
 */

type Input = Record<string, unknown>;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The Sunday that starts the week of the call, or undefined when the call has no clock and names no day. */
function weekOfCall(L: Load, input: Input): string | undefined {
  const named = typeof input.week === 'string' && DAY.test(input.week) ? input.week : undefined;
  const day = named ?? (L.now ? todayISO(L.now) : undefined);
  return day ? weekOf(day) : undefined;
}

/**
 * The fields of a to-do that the line of an answer reads: the view rule (taskResource: its project, lead, helpers and maker) and the title.
 * An answer keeps the ids only (security review of fbk_088), so a read of checkins.mine or checkins.week brings the to-dos that its answers name.
 * The projects, their people and the users are in the office already. A read never saves, so it takes only these fields.
 */
const LINE_FIELDS = ['id', 'projectId', 'ownerId', 'helperIds', 'createdBy', 'title'] as const;

/** The to-dos that the answers keep, for the lines of the view (handlers/checkins.ts, viewOf). A deleted to-do is not found and gives no line. */
async function lineTasks(L: Load, answers: readonly Checkin[]): Promise<void> {
  const ids = [...new Set(answers.flatMap((answer) => answer.taskIds))];
  if (ids.length > 0) await L.select({ c: 'tasks', where: [{ col: 'id', in: ids }], pick: LINE_FIELDS });
}

/** checkins.mine: the own answers of the week, and the to-dos that they keep. */
export async function checkinsMine(L: Load, input: Input): Promise<void> {
  const week = weekOfCall(L, input);
  if (!L.authority || !week) return;
  await lineTasks(L, (await L.select({ c: 'checkins', where: [{ col: 'week', in: [week] }, { col: 'user_id', in: [L.authority.id] }] })) as Checkin[]);
}

/**
 * checkins.week: every answer of the week, for a person who holds "Read the weekly answers" (the handler refuses any other person, so nothing is
 * read), and the to-dos that the answers keep. About 30 answers keep a few to-dos each, so the read stays small.
 */
export async function checkinsWeek(L: Load, input: Input): Promise<void> {
  const week = weekOfCall(L, input);
  if (!L.authority || !week || !can(L.authority, 'checkin.read')) return;
  await lineTasks(L, (await L.select({ c: 'checkins', where: [{ col: 'week', in: [week] }] })) as Checkin[]);
}

/**
 * checkins.save: the own answers of the current week (the save changes the one of its kind), and the to-dos that the person keeps. The handler
 * reads each to-do for its lead, its helpers, its maker, its title and its project, which the office holds. The save answers with the lines of the
 * saved answer, which keeps exactly these to-dos, so no other read is needed.
 */
export async function checkinsSave(L: Load, input: Input): Promise<void> {
  const week = L.now ? weekOf(todayISO(L.now)) : undefined;
  if (!L.authority || !week) return;
  await L.select({ c: 'checkins', where: [{ col: 'week', in: [week] }, { col: 'user_id', in: [L.authority.id] }] });
  await L.byKey('tasks', Array.isArray(input.items) ? input.items.filter((id): id is string => typeof id === 'string') : []);
}
