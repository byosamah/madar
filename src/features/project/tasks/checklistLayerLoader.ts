import type { ComponentType } from 'react';
import type { DragChecklistProps } from './ChecklistDrag';

/**
 * The loader of the drag layer of the checklist (fbk_043). It follows `dragLayerLoader.ts`: dnd-kit stays out of the first load, so the
 * checklist first draws static rows and swaps the layer in once it has loaded. The module is kept here once it has loaded, so a
 * checklist that mounts later takes it at once, with no second frame.
 */
let loaded: ComponentType<DragChecklistProps> | null = null;
let loading: Promise<ComponentType<DragChecklistProps>> | null = null;

/** The drag layer of the checklist when it is loaded, else null. */
export function loadedChecklistLayer(): ComponentType<DragChecklistProps> | null {
  return loaded;
}

/** Imports the layer once. A failed import leaves no trace, so the next call tries again. */
export function loadChecklistLayer(): Promise<ComponentType<DragChecklistProps>> {
  if (loaded) return Promise.resolve(loaded);
  loading ??= import('./ChecklistDrag').then(
    (module) => {
      loaded = module.DragChecklist;
      loading = null;
      return module.DragChecklist;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}
