import type { TaskStatus } from '../api/contract/entities';
import { arrowStep } from './keys';

export const BOARD_COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];

/**
 * The columns a card may move to. The person who reviews a task in review moves it only to Done (approve): the server
 * refuses To do and In progress, because Send back needs a note (audit 2026-10-03, V-5).
 * For anyone else, Done on a task that needs review lands in In review again and changes nothing. So while it waits, its lead
 * gets only the pull-back columns, To do and In progress (audit 2026-10-03, F-19).
 */
export function moveTargets(status: TaskStatus, reviews: boolean, needsReview = false): TaskStatus[] {
  if (status === 'in_review' && reviews) return ['done'];
  if (status === 'in_review' && needsReview) return ['todo', 'in_progress'];
  return BOARD_COLUMNS.filter((column) => column !== status);
}

/** The column an arrow key moves a card to. The end-side arrow moves forward, so in Arabic ArrowLeft moves forward. */
export function nextColumn(current: TaskStatus, key: string, rtl: boolean): TaskStatus | null {
  const step = arrowStep(key, rtl);
  return step === 0 ? null : BOARD_COLUMNS[BOARD_COLUMNS.indexOf(current) + step] ?? null;
}
