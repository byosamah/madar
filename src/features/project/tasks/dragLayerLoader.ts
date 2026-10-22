import type { ComponentType } from 'react';
import { whenIdle } from '../../../app/screens';
import type { DragRowsProps } from './DragLayer';

/**
 * The loader of the drag layer (performance audit 2026-10-21, FL-2). dnd-kit is about 18 KB of script, so it is a chunk of its own and
 * the first load draws the sortable lists with no drag. The module is kept here once it has loaded (the loaded-module pattern of the
 * task panel): a list that mounts later takes it at once, with no Suspense step and no second frame.
 */
let loaded: ComponentType<DragRowsProps> | null = null;
let loading: Promise<ComponentType<DragRowsProps>> | null = null;

/** The drag layer when it is loaded, else null. */
export function loadedDragLayer(): ComponentType<DragRowsProps> | null {
  return loaded;
}

/** Imports the layer once. A failed import leaves no trace, so the next call tries again. */
export function loadDragLayer(): Promise<ComponentType<DragRowsProps>> {
  if (loaded) return Promise.resolve(loaded);
  loading ??= import('./DragLayer').then(
    (module) => {
      loaded = module.DragRows;
      loading = null;
      return module.DragRows;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** Starts the import when the browser is idle (`whenIdle`: Safari has no requestIdleCallback), so a list that mounts later finds the layer in memory. A failure is ignored. */
export function warmDragLayer(): void {
  whenIdle(() => {
    loadDragLayer().catch(() => undefined);
  });
}

/** For the tests: forget the loaded layer, so a list starts with its static rows again. */
export function forgetDragLayerForTests(): void {
  loaded = null;
  loading = null;
}
