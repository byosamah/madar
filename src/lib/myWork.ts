import type { TaskRow } from '../api/contract/views';
import { addDays, dayOfWeek, weekStartOf } from './dates';

export type WorkGroup = 'overdue' | 'today' | 'week' | 'later' | 'none';
export const WORK_GROUPS: WorkGroup[] = ['overdue', 'today', 'week', 'later', 'none'];

/** Spec 6.1: Overdue, Today, This week, Later and No date. A task in review is never overdue, so a past date shows under Today. */
export function workGroupOf(row: TaskRow, today: string): WorkGroup {
  if (row.overdue) return 'overdue';
  const due = row.task.dueDate;
  if (!due) return 'none';
  if (due <= today) return 'today';
  // The office works Sunday to Thursday. On Friday and Saturday the week left is days off, so "This week" means the coming
  // Sunday to Saturday (audit 2026-10-03, BRW-9).
  const weekend = dayOfWeek(today) >= 5;
  const start = weekend ? addDays(weekStartOf(today), 7) : weekStartOf(today);
  return due <= addDays(start, 6) ? 'week' : 'later';
}

export function groupMyTasks(rows: TaskRow[], today: string): { group: WorkGroup; rows: TaskRow[] }[] {
  return WORK_GROUPS
    .map((group) => ({ group, rows: rows.filter((row) => workGroupOf(row, today) === group) }))
    .filter((group) => group.rows.length > 0);
}
