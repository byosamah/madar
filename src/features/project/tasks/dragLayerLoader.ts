import { whenIdle } from '../../../app/whenIdle';
import type { DragRowsProps } from './DragLayer';
import { createLayerLoader } from './lazyLayer';

/**
 * The loader of the drag layer (performance audit 2026-10-21, FL-2). dnd-kit is about 18 KB of script, so it is a chunk of its own and
 * the first load draws the sortable lists with no drag. The module is kept here once it has loaded (the loaded-module pattern of the
 * task panel): a list that mounts later takes it at once, with no Suspense step and no second frame.
 */
const layer = createLayerLoader<DragRowsProps>(() => import('./DragLayer').then((module) => module.DragRows));

/** The drag layer when it is loaded, else null. */
export const loadedDragLayer = layer.loaded;

/** Imports the layer once. A failed import leaves no trace, so the next call tries again. */
export const loadDragLayer = layer.load;

/** Starts the import when the browser is idle (`whenIdle`: Safari has no requestIdleCallback), so a list that mounts later finds the layer in memory. A failure is ignored. */
export function warmDragLayer(): void {
  whenIdle(() => {
    loadDragLayer().catch(() => undefined);
  });
}

/** For the tests: forget the loaded layer, so a list starts with its static rows again. */
export const forgetDragLayerForTests = layer.forget;
