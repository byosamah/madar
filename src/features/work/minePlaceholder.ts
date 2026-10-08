import type { QueryClient } from '@tanstack/react-query';
import type { TaskRow } from '../../api/contract/views';

/** The key of the list of my tasks that Home reads (useCall('tasks.list', { filter: 'mine' })). It holds my done tasks too. */
export const HOME_MINE = ['api', 'tasks.list', { filter: 'mine' }] as const;

/** My open tasks: the list of the Tasks screen, made from the list of Home. The handler gives the same rows in the same order. */
export const openRows = (rows: TaskRow[]): TaskRow[] => rows.filter((row) => row.task.status !== 'done');

/**
 * The open rows of the cached Home list, for the Tasks screen to show while its own list loads (performance audit 2026-10-07,
 * FET-9). Only an answer that exists and that no change marked counts, so the screen never shows a list it knows is old.
 */
export function homePlaceholder(client: QueryClient): TaskRow[] | undefined {
  const state = client.getQueryState<TaskRow[]>(HOME_MINE);
  if (!state || state.isInvalidated || state.data === undefined) return undefined;
  return openRows(state.data);
}
