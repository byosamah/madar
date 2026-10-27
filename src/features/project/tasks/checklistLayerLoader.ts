import type { DragChecklistProps } from './ChecklistDrag';
import { createLayerLoader } from '../lazyLayer';

/**
 * The loader of the drag layer of the checklist (fbk_043). It follows `dragLayerLoader.ts`: dnd-kit stays out of the first load, so the
 * checklist first draws static rows and swaps the layer in once it has loaded. The module is kept here once it has loaded, so a
 * checklist that mounts later takes it at once, with no second frame.
 */
const layer = createLayerLoader<DragChecklistProps>(() => import('./ChecklistDrag').then((module) => module.DragChecklist));

/** The drag layer of the checklist when it is loaded, else null. */
export const loadedChecklistLayer = layer.loaded;

/** Imports the layer once. A failed import leaves no trace, so the next call tries again. */
export const loadChecklistLayer = layer.load;
