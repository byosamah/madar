import type { TaskRow } from '../api/contract/views';
import { nowStamp, stampDay } from './dates';

export type NextItem =
  | { kind: 'review' | 'pastDue' | 'dueToday' | 'continue'; row: TaskRow }
  | { kind: 'clear' };

/** Open means the person can still act on it: not done, and not waiting for a leader's review. */
const open = (row: TaskRow) => row.task.status === 'todo' || row.task.status === 'in_progress';
const byDue = (a: TaskRow, b: TaskRow) => (a.task.dueDate ?? '9999-12-31').localeCompare(b.task.dueDate ?? '9999-12-31');

/** The one thing for Home's card (redesign spec 3.2). The first match wins. */
export function nextForYou(input: { review: TaskRow[]; mine: TaskRow[]; today: string }): NextItem {
  const { review, mine, today } = input;
  if (review.length > 0) return { kind: 'review', row: review[0] };
  const pastDue = mine.filter((row) => open(row) && row.task.dueDate !== null && row.task.dueDate < today).sort(byDue);
  if (pastDue.length > 0) return { kind: 'pastDue', row: pastDue[0] };
  const dueToday = mine.find((row) => open(row) && row.task.dueDate === today);
  if (dueToday) return { kind: 'dueToday', row: dueToday };
  const doing = mine.filter((row) => row.task.status === 'in_progress').sort(byDue);
  if (doing.length > 0) return { kind: 'continue', row: doing[0] };
  return { kind: 'clear' };
}

/** My open tasks that today asks for: due today or past due. */
export function dueByToday(mine: TaskRow[], today: string): TaskRow[] {
  return mine.filter((row) => open(row) && row.task.dueDate !== null && row.task.dueDate <= today).sort(byDue);
}

/**
 * The day ring (redesign spec 5.2): what today asks of me, and how much of it I finished.
 * A task I sent to review is finished from my side, so it fills the ring too; otherwise a member who ticks a task sees the ring shrink.
 */
export function dayRing(mine: TaskRow[], today: string): { done: number; total: number } {
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
