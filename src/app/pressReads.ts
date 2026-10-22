import { useCallback } from 'react';
import { PROJECT_SORT_KEY, PROJECT_SORTS } from '../features/projects/sort';
import { GUARD_READS, read, type GuardRead } from './guardReads';
import { usePrefetchCall } from './prefetch';

/**
 * The main reads of the tabs (performance audit 2026-10-21, LV-9). A tab of the bar starts them on pointerdown of its link, so the
 * first open of a screen finds its answers in the cache and does not wait for a full trip after the click. Never on hover: a hover on a
 * tab that nobody opens would cost quota. The lists follow the screen file, with the keys of the screen at its link with no filter;
 * `PressReads.test.tsx` holds the keys. Only the remote build starts them (`usePrefetchCall`). A cached answer is not asked again.
 * Home and Tasks start nothing: they show at once from the cache.
 */
function storedSort(): (typeof PROJECT_SORTS)[number] {
  try {
    const stored = window.localStorage.getItem(PROJECT_SORT_KEY);
    return PROJECT_SORTS.find((sort) => sort === stored) ?? 'updated';
  } catch {
    return 'updated';
  }
}

/** features/projects/ProjectsScreen.tsx at /projects. */
function projects(): GuardRead[] {
  return [
    read('projects.list', { status: 'active', sort: storedSort(), filter: 'all' }),
    read('settings.get', {}), read('teams.list', {}), read('users.list', {}), read('clients.list', {}), read('subCompanies.list', {}),
  ];
}

/** The reads by the link of the tab. */
export const PRESS_READS: Record<string, () => GuardRead[]> = {
  '/projects': projects,
  '/dashboard': () => GUARD_READS.dashboard!(new URLSearchParams(), undefined),
  '/inbox': () => [read('chats.list', {})],
  '/notifications': () => [read('notifications.list', {})],
};

/** The function for onPointerDown of a tab link: it starts the main reads of the tab, when it has any. */
export function usePressReads(): (to: string) => void {
  const prefetch = usePrefetchCall();
  return useCallback((to: string) => {
    for (const start of PRESS_READS[to]?.() ?? []) start(prefetch);
  }, [prefetch]);
}
