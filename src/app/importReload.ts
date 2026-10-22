/** The reload of the page after a failed import (moved out of screens.ts, 2026-10-22). */

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

/** The parts of this tab. */
export function thisPage(): PageReload {
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

/**
 * Runs an import at a screen change. After a release, a tab that opened before it can ask for a chunk that the host no longer
 * has. Then the page reloads once, with a mark for this address in the session storage, and gets the new build. A second
 * failure at the same address, an offline device or a storage that takes no mark gives the error, as before. A part that loads
 * on its first use (`app/lazyOverlay.tsx`) uses it too.
 * This file imports nothing: lazyOverlay.tsx takes it from here, and an import of screens.ts there made an import loop through
 * the screens in the prototype dev server (`importCycle.test.ts`).
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
