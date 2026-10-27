import type { ComponentType } from 'react';
import { whenIdle } from '../../../app/whenIdle';
import type { FilesDragHostProps } from './FilesDragLayer';

/**
 * The loader of the file drag layer (fbk_066). dnd-kit is a chunk of its own: the first load draws the Files & Links list with no drag.
 * It is the loaded-module pattern of `dragLayerLoader.ts`: a list that mounts later takes the layer at once, with no Suspense step.
 */
let loaded: ComponentType<FilesDragHostProps> | null = null;
let loading: Promise<ComponentType<FilesDragHostProps>> | null = null;

/** The drag host when it is loaded, else null. */
export function loadedFilesDrag(): ComponentType<FilesDragHostProps> | null {
  return loaded;
}

/** Imports the layer once. A failed import leaves no trace, so the next call tries again. */
export function loadFilesDrag(): Promise<ComponentType<FilesDragHostProps>> {
  if (loaded) return Promise.resolve(loaded);
  loading ??= import('./FilesDragLayer').then(
    (module) => {
      loaded = module.FilesDragHost;
      loading = null;
      return module.FilesDragHost;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** Starts the import when the browser is idle. A failure is ignored. */
export function warmFilesDrag(): void {
  whenIdle(() => {
    loadFilesDrag().catch(() => undefined);
  });
}

/** For the tests: forget the loaded layer. */
export function forgetFilesDragForTests(): void {
  loaded = null;
  loading = null;
}
