import { createLayerLoader } from '../tasks/lazyLayer';
import type { FilesDragHostProps } from './FilesDragLayer';

/**
 * The loader of the file drag layer (fbk_066). dnd-kit is a chunk of its own: the first load draws the Files & Links list with no drag.
 * It is the loaded-module pattern of `dragLayerLoader.ts`: a list that mounts later takes the layer at once, with no Suspense step.
 */
const layer = createLayerLoader<FilesDragHostProps>(() => import('./FilesDragLayer').then((module) => module.FilesDragHost));

/** The drag host when it is loaded, else null. */
export const loadedFilesDrag = layer.loaded;

/** Imports the layer once. A failed import leaves no trace, so the next call tries again. */
export const loadFilesDrag = layer.load;

/** For the tests: forget the loaded layer. */
export const forgetFilesDragForTests = layer.forget;
