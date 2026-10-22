import type { TaskStatus } from '../../api/contract/entities';
import type { TaskRow } from '../../api/contract/views';
import { addDays } from '../../lib/dates';

/** How many Riyadh days the Done column holds: today and the 6 days before (owner, 2026-10-22, fbk_042). */
export const DONE_DAYS = 7;

/**
 * The read of the Done column: the to-dos that I lead or help on and finished in the last 7 days. `doneFrom` keeps the Riyadh day of the
 * finish stamp, and `status` narrows the read to the done rows. The read starts only while the Board shows.
 */
export function doneWindow(today: string): { filter: 'mine'; status: TaskStatus[]; includeDone: true; doneFrom: string } {
  return { filter: 'mine', status: ['done'], includeDone: true, doneFrom: addDays(today, 1 - DONE_DAYS) };
}

const finishedAt = (row: TaskRow) => Date.parse(row.task.completedAt ?? '') || 0;

/**
 * One card for each to-do. The to-dos that wait for my review come first (they wait for me), then my open to-dos in the order of the
 * list, then my finished to-dos, the newest first. A to-do that is mine and also in my review queue shows once.
 */
export function boardRows(mine: readonly TaskRow[], review: readonly TaskRow[], done: readonly TaskRow[]): TaskRow[] {
  const seen = new Set<string>();
  const rows: TaskRow[] = [];
  const add = (row: TaskRow) => {
    if (seen.has(row.task.id)) return;
    seen.add(row.task.id);
    rows.push(row);
  };
  review.forEach(add);
  mine.forEach(add);
  [...done].sort((a, b) => finishedAt(b) - finishedAt(a)).forEach(add);
  return rows;
}
