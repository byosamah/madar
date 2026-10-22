import type { ComponentType } from 'react';
import { reloadOnFailedImport, thisPage, type PageReload } from './importReload';
import { LOADERS } from './screenLoaders';
import { whenIdle } from './whenIdle';

// The reload after a failed import lives in importReload.ts, so lazyOverlay.tsx can use it without the screen list.
export { reloadOnFailedImport, type PageReload } from './importReload';

/**
 * The screens that load on demand (performance audit BND-1): the list is in screenLoaders.ts. The remote build splits each
 * screen into its own chunk. The prototype keeps one script file (codeSplitting false) and plain imports.
 * routes.tsx gives a route its Component when the screen is loaded, else a lazy import. main.tsx loads the screens of the
 * first address before it makes the router, so the router starts with no lazy route there and shows the screen at once.
 */

export type ScreenName = keyof typeof LOADERS;
export const SCREEN_NAMES = Object.keys(LOADERS) as ScreenName[];

/** Runs a step when the browser is idle (Safari: after 200 ms). The function lives in whenIdle.ts, so a part of a screen needs no loader table. */
export { whenIdle };

/** The loaded screens and the imports on their way, for one set of loaders. */
export function screenCache<N extends string>(loaders: Record<N, () => Promise<ComponentType>>) {
  const names = Object.keys(loaders) as N[];
  const loaded = new Map<N, ComponentType>();
  const loading = new Map<N, Promise<ComponentType>>();

  /** Imports a screen once. A failed import leaves no trace, so the next load tries again. */
  function loadScreen(name: N): Promise<ComponentType> {
    const done = loaded.get(name);
    if (done) return Promise.resolve(done);
    let promise = loading.get(name);
    if (!promise) {
      promise = loaders[name]().then(
        (component) => {
          loaded.set(name, component);
          loading.delete(name);
          return component;
        },
        (error: unknown) => {
          loading.delete(name);
          throw error;
        },
      );
      loading.set(name, promise);
    }
    return promise;
  }

  return {
    loadScreen,
    /** The screen when it is loaded, else undefined. */
    screenFor: (name: N): ComponentType | undefined => loaded.get(name),
    /** Loads the screens (all of them by default). The prototype and the screen tests load all before they make a router. */
    async preloadScreens(list: readonly N[] = names): Promise<void> {
      await Promise.all(list.map(loadScreen));
    },
    /**
     * The lazy import of a route at a screen change. After a release, a tab that opened before it can ask for a chunk that the
     * host no longer has. Then the page reloads once, with a mark for this address in the session storage, and gets the new
     * build. A second failure at the same address, an offline device or a storage that takes no mark shows the error page,
     * as before. A global vite:preloadError listener would also reload for a failed prefetch, while a person types.
     */
    loadForNavigation(name: N, page: PageReload = thisPage()): Promise<ComponentType> {
      return reloadOnFailedImport(() => loadScreen(name), page);
    },
    /**
     * Loads the other screens, one at each idle moment for each line, after the first screen shows (`options.limit` lines, one by
     * default; main.tsx gives 3 through `app/idlePrefetch.ts`). So a later screen change waits for no chunk, and a release that
     * removes the old chunks finds them already in memory. A failure is ignored: the screen change tries the import again. A
     * prefetch never reloads the page. `skip` names a screen that this person has no use for: it is asked at the step of that
     * screen, and a skipped screen loads on its first use, as an unlisted one does. A screen that a person opens first loads at
     * once through `loadScreen`, and the queue passes it.
     */
    prefetchScreens(
      list: readonly N[] = names,
      idle: (run: () => void) => void = whenIdle,
      skip?: (name: N) => boolean,
      options: { limit?: number } = {},
    ): void {
      const queue = list.filter((name) => !loaded.has(name));
      const next = (): void => {
        // A screen that a person opened first is loaded or on its way: the queue passes it with no idle wait.
        let name = queue.shift();
        while (name !== undefined && (loaded.has(name) || loading.has(name))) name = queue.shift();
        if (name === undefined) return;
        const step = name;
        idle(() => {
          // The rule answers at the step, not at the start, so it reads what the first answers brought (audit 2026-10-21, FL-8).
          if (skip?.(step)) next();
          else loadScreen(step).then(next, next);
        });
      };
      // `limit` lines run side by side (2026-10-22), so a press on a tab never waits behind the whole queue. One line is the old pace.
      for (let line = 0; line < Math.max(1, options.limit ?? 1); line += 1) next();
    },
  };
}

const screens = screenCache(LOADERS);
export const { loadScreen, screenFor, preloadScreens, loadForNavigation, prefetchScreens } = screens;
