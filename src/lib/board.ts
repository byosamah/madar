import type { TaskStatus } from '../api/contract/entities';

export const BOARD_COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];

/**
 * The columns a card may move to. The person who reviews a task in review moves it only to Done (approve): the server
 * refuses To do and In progress, because Send back needs a note (audit 2026-10-03, V-5).
 */
export function moveTargets(status: TaskStatus, reviews: boolean): TaskStatus[] {
  if (status === 'in_review' && reviews) return ['done'];
  return BOARD_COLUMNS.filter((column) => column !== status);
}

/** The column an arrow key moves a card to. The end-side arrow moves forward, so in Arabic ArrowLeft moves forward. */
export function nextColumn(current: TaskStatus, key: string, rtl: boolean): TaskStatus | null {
  const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
  const back = rtl ? 'ArrowRight' : 'ArrowLeft';
  const index = BOARD_COLUMNS.indexOf(current);
  if (key === forward && index < BOARD_COLUMNS.length - 1) return BOARD_COLUMNS[index + 1];
  if (key === back && index > 0) return BOARD_COLUMNS[index - 1];
  return null;
}
