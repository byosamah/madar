import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';

/**
 * The shared part of the lazy drag layers (performance audit 2026-10-21, FL-2): the loader that keeps a loaded module, and the swap from
 * static rows to the layer. dnd-kit is a chunk of its own, so this file imports none of it. Each loader file keeps its own `import()`.
 */

export type LayerLoader<P> = {
  /** The layer when it is loaded, else null. */
  loaded: () => ComponentType<P> | null;
  /** Imports the layer once. A failed import leaves no trace, so the next call tries again. */
  load: () => Promise<ComponentType<P>>;
  /** For the tests: forget the loaded layer, so a list starts with its static rows again. */
  forget: () => void;
};

/** The loaded-module pattern: a list that mounts later takes the layer at once, with no Suspense step and no second frame. */
export function createLayerLoader<P>(importer: () => Promise<ComponentType<P>>): LayerLoader<P> {
  let loaded: ComponentType<P> | null = null;
  let loading: Promise<ComponentType<P>> | null = null;
  return {
    loaded: () => loaded,
    load() {
      if (loaded) return Promise.resolve(loaded);
      loading ??= importer().then(
        (layer) => {
          loaded = layer;
          loading = null;
          return layer;
        },
        (error: unknown) => {
          loading = null;
          throw error;
        },
      );
      return loading;
    },
    forget() {
      loaded = null;
      loading = null;
    },
  };
}

const CONTROLS = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Where the focus is inside a list: the row and the control in it. The swap to the drag layer makes new nodes, so the focus goes there again. */
type FocusMark = { row: number; control: number };

function markFocus(list: HTMLUListElement | null): FocusMark | null {
  const active = document.activeElement;
  if (!list || !active || active === list || !list.contains(active)) return null;
  const rows = [...list.children];
  const row = rows.findIndex((item) => item.contains(active));
  if (row < 0) return null;
  const control = [...rows[row]!.querySelectorAll(CONTROLS)].indexOf(active);
  return control < 0 ? null : { row, control };
}

function restoreFocus(list: HTMLUListElement | null, mark: FocusMark): void {
  const target = list?.children[mark.row]?.querySelectorAll<HTMLElement>(CONTROLS)[mark.control];
  target?.focus({ preventScroll: true });
}

/**
 * The swap from the static list to the drag layer. It returns the layer when it is loaded, else null (draw the static rows). The import
 * starts when `wanted` is true. The swap makes new nodes, so with a `listRef` the focus goes back to the control that had it. A list
 * with no `listRef` keeps no focus mark.
 */
export function useLayerSwap<P>(
  loader: Pick<LayerLoader<P>, 'loaded' | 'load'>,
  wanted: boolean,
  listRef?: { readonly current: HTMLUListElement | null },
): ComponentType<P> | null {
  const [Layer, setLayer] = useState<ComponentType<P> | null>(loader.loaded);
  const mark = useRef<FocusMark | null>(null);
  useEffect(() => {
    if (!wanted || Layer) return undefined;
    let live = true;
    loader.load().then((layer) => {
      if (!live) return;
      mark.current = markFocus(listRef?.current ?? null);
      setLayer(() => layer);
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [loader, wanted, Layer, listRef]);
  useLayoutEffect(() => {
    if (!Layer || !mark.current) return;
    const kept = mark.current;
    mark.current = null;
    restoreFocus(listRef?.current ?? null, kept);
  }, [Layer, listRef]);
  return Layer;
}
