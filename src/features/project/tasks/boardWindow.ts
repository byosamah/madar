import type { TaskRow } from '../../../api/contract/views';
import { addDays, stampDay } from '../../../lib/dates';
import { DONE_DAYS } from '../../work/boardRows';

/**
 * The rows of the status board of a project: every open to-do, and the done to-dos of the last 7 days (today and the 6 days before),
 * as the Done column of the Work board holds them (fbk_085, owner 2026-11-08). The project list already holds every done row, so this
 * cuts them on the screen and asks the server for nothing more. A done to-do with no finish stamp is left out.
 */
export function boardWindowRows(rows: readonly TaskRow[], today: string): TaskRow[] {
  const from = addDays(today, 1 - DONE_DAYS);
  return rows.filter((row) => row.task.status !== 'done' || (!!row.task.completedAt && stampDay(row.task.completedAt) >= from));
}
