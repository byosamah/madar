import type { TaskRow } from '../api/contract/views';
import { arranged } from './arrange';
import { nowStamp, stampDay } from './dates';
import { workGroupOf } from './myWork';
import { isWaiting } from './waiting';

export type NextItem =
  | { kind: 'review' | 'pastDue' | 'dueToday' | 'continue'; row: TaskRow }
  | { kind: 'clear' };

/** Open means the person can still act on it: not done, and not waiting for a leader's review. */
const open = (row: TaskRow) => row.task.status === 'todo' || row.task.status === 'in_progress';
/**
 * Home asks a person only for what they can finish: a task they lead (a helper cannot finish it, owner decision C2) that waits
 * for no other task or stage (audit 2026-10-03, PER-1 and PER-2). Helper tasks stay on the Tasks screen.
 */
const mayFinish = (row: TaskRow) => row.canMove;
const byDue = (a: TaskRow, b: TaskRow) => (a.task.dueDate ?? '9999-12-31').localeCompare(b.task.dueDate ?? '9999-12-31');
/**
 * Home follows the shared order of the Tasks screen (owner, 2026-10-07): the groups in their order, and inside each group the
 * placed tasks first. The tasks with no place keep the date order.
 */
function inWorkOrder(rows: TaskRow[], today: string): TaskRow[] {
  const sorted = [...rows].sort(byDue);
  const groups = [...new Set(sorted.map((row) => workGroupOf(row, today)))];
  return groups.flatMap((group) => arranged(sorted.filter((row) => workGroupOf(row, today) === group)));
}

/** The one thing for Home's card (redesign spec 3.2). The first match wins. */
export function nextForYou(input: { review: TaskRow[]; mine: TaskRow[]; today: string }): NextItem {
  const { review, today } = input;
  if (review.length > 0) return { kind: 'review', row: review[0] };
  const mine = input.mine.filter((row) => mayFinish(row) && !isWaiting(row));
  // The top task of the person's order comes first; with no order, the oldest past-due task (owner, 2026-10-07).
  const pastDue = arranged(mine.filter((row) => open(row) && row.task.dueDate !== null && row.task.dueDate < today).sort(byDue));
  if (pastDue.length > 0) return { kind: 'pastDue', row: pastDue[0] };
  const dueToday = arranged(mine.filter((row) => open(row) && row.task.dueDate === today))[0];
  if (dueToday) return { kind: 'dueToday', row: dueToday };
  const doing = mine.filter((row) => row.task.status === 'in_progress').sort(byDue);
  if (doing.length > 0) return { kind: 'continue', row: doing[0] };
  return { kind: 'clear' };
}

/** My open tasks that today asks for: due today or past due. */
export function dueByToday(mine: TaskRow[], today: string): TaskRow[] {
  return inWorkOrder(mine.filter((row) => mayFinish(row) && open(row) && row.task.dueDate !== null && row.task.dueDate <= today), today);
}

/** How many later tasks Home shows when today asks for nothing (owner, 2026-10-07). A short list keeps one next step clear. */
export const COMING_UP = 3;

/**
 * My next open tasks with a due date after today: This week before Later, each in the shared order, else soonest first. Home
 * shows them when today asks for nothing (owner, 2026-10-07).
 */
export function comingUp(mine: TaskRow[], today: string, limit = COMING_UP): TaskRow[] {
  return inWorkOrder(mine.filter((row) => mayFinish(row) && open(row) && row.task.dueDate !== null && row.task.dueDate > today), today).slice(0, limit);
}

/**
 * The day ring (redesign spec 5.2): what today asks of me, and how much of it I finished.
 * A task I sent to review is finished from my side, so it fills the ring too; otherwise a member who ticks a task sees the ring shrink.
 */
export function dayRing(all: TaskRow[], today: string): { done: number; total: number } {
  const mine = all.filter(mayFinish);
  const doneToday = mine.filter((row) => row.task.status === 'done' && row.task.completedAt !== null && stampDay(row.task.completedAt) === today).length;
  const waiting = mine.filter((row) => row.task.status === 'in_review' && row.task.dueDate !== null && row.task.dueDate <= today).length;
  const done = doneToday + waiting;
  return { done, total: done + dueByToday(mine, today).length };
}

export function greetingKey(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 12) return 'morning';
  return hour < 17 ? 'afternoon' : 'evening';
}

/** The hour of the day in office time, so the greeting is right in any time zone. */
export function officeHour(): number {
  return Number(nowStamp().slice(11, 13));
}
