import type { TaskStatus } from '../api/contract/entities';

export const BOARD_COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];

/** The column an arrow key moves a card to. The end-side arrow moves forward, so in Arabic ArrowLeft moves forward. */
export function nextColumn(current: TaskStatus, key: string, rtl: boolean): TaskStatus | null {
  const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
  const back = rtl ? 'ArrowRight' : 'ArrowLeft';
  const index = BOARD_COLUMNS.indexOf(current);
  if (key === forward && index < BOARD_COLUMNS.length - 1) return BOARD_COLUMNS[index + 1];
  if (key === back && index > 0) return BOARD_COLUMNS[index - 1];
  return null;
}
