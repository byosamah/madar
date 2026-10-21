import type { ComponentType } from 'react';
import { LOADERS } from './screenLoaders';

/**
 * The screens that load on demand (performance audit BND-1): the list is in screenLoaders.ts. The remote build splits each
 * screen into its own chunk. The prototype keeps one script file (codeSplitting false) and plain imports.
 * routes.tsx gives a route its Component when the screen is loaded, else a lazy import. main.tsx loads the screens of the
 * first address before it makes the router, so the router starts with no lazy route there and shows the screen at once.
 */

export type ScreenName = keyof typeof LOADERS;
export const SCREEN_NAMES = Object.keys(LOADERS) as ScreenName[];

/** The page parts that a failed import at a screen change uses. A test gives its own. */
export type PageReload = {
  online(): boolean;
  href(): string;
  markedHref(): string | null;
  /** Keeps the mark in the session storage of the tab. False when the storage takes nothing. */
  mark(href: string): boolean;
  unmark(): void;
  reload(): void;
};

/** The session mark of a reload after a failed import, with the address of that reload. */
const RELOAD_MARK = 'madar.screenReload';

function thisPage(): PageReload {
  return {
    online: () => navigator.onLine !== false,
    href: () => window.location.href,
    markedHref: () => {
      try {
        return window.sessionStorage.getItem(RELOAD_MARK);
      } catch {
        return null;
      }
    },
    mark: (href) => {
      try {
        window.sessionStorage.setItem(RELOAD_MARK, href);
        return window.sessionStorage.getItem(RELOAD_MARK) === href;
      } catch {
        return false;
      }
    },
    unmark: () => {
      try {
        window.sessionStorage.removeItem(RELOAD_MARK);
      } catch {
        // Blocked storage holds no mark.
      }
    },
    reload: () => window.location.reload(),
  };
}

/** Runs a step when the browser is idle. Safari has no requestIdleCallback, so it waits 200 ms there. */
export function whenIdle(run: () => void): void {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => run());
  else setTimeout(run, 200);
}

/**
 * Runs an import at a screen change. After a release, a tab that opened before it can ask for a chunk that the host no longer
 * has. Then the page reloads once, with a mark for this address in the session storage, and gets the new build. A second
 * failure at the same address, an offline device or a storage that takes no mark gives the error, as before. A part that loads
 * on its first use (`app/lazyOverlay.tsx`) uses it too.
 */
export async function reloadOnFailedImport<T>(load: () => Promise<T>, page: PageReload = thisPage()): Promise<T> {
  try {
    const result = await load();
    if (page.markedHref() !== null) page.unmark();
    return result;
  } catch (error) {
    const href = page.href();
    if (page.online() && page.markedHref() !== href && page.mark(href)) {
      page.reload();
      // The page goes away, so the screen change waits for nothing.
      return new Promise<never>(() => undefined);
    }
    throw error;
  }
}

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
     * Loads the other screens one at a time, one at each idle moment, after the first screen shows. So a later screen change
     * waits for no chunk, and a release that removes the old chunks finds them already in memory. A failure is ignored: the
     * screen change tries the import again. A prefetch never reloads the page. `skip` names a screen that this person has no use
     * for: it is asked at the step of that screen, and a skipped screen loads on its first use, as an unlisted one does.
     */
    prefetchScreens(list: readonly N[] = names, idle: (run: () => void) => void = whenIdle, skip?: (name: N) => boolean): void {
      const queue = list.filter((name) => !loaded.has(name));
      const next = (): void => {
        const name = queue.shift();
        if (name === undefined) return;
        idle(() => {
          // The rule answers at the step, not at the start, so it reads what the first answers brought (audit 2026-10-21, FL-8).
          if (skip?.(name)) next();
          else loadScreen(name).then(next, next);
        });
      };
      next();
    },
  };
}

const screens = screenCache(LOADERS);
export const { loadScreen, screenFor, preloadScreens, loadForNavigation, prefetchScreens } = screens;
