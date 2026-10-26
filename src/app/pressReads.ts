import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminReach } from '../api/contract/entities';
import { meetingsListInput } from '../features/meetings/readInputs';
import { PROJECT_SORT_KEY, PROJECT_SORTS } from '../features/projects/sort';
import { MINE_OPEN, REVIEW_FOR_ME } from '../features/work/readInputs';
import { todayISO } from '../lib/dates';
import { projectsDefaultShow, reachOfSession } from '../lib/projectReach';
import { GUARD_READS, read, type GuardRead } from './guardReads';
import { REMOTE } from './mode';
import { usePrefetchCall } from './prefetch';

/**
 * The main reads of the tabs (performance audit 2026-10-21, LV-9). A tab of the bar starts them on pointerdown of its link, so the
 * first open of a screen finds its answers in the cache and does not wait for a full trip after the click. Never on hover: a hover on a
 * tab that nobody opens would cost quota. The lists follow the screen file, with the keys of the screen at its link with no filter;
 * `PressReads.test.tsx` holds the keys. Only the remote build starts them (`usePrefetchCall`). A cached answer is not asked again.
 * Home starts nothing: it shows at once from the cache. The Work tab of a phone starts the two to-do lists, the Meetings view starts its list, and
 * the Me tab starts the settings (and the Google status, in the real build). On a desk the Tasks tab starts the two to-do lists too: Home holds
 * them, so a cached answer is not asked again.
 */
function storedSort(): (typeof PROJECT_SORTS)[number] {
  try {
    const stored = window.localStorage.getItem(PROJECT_SORT_KEY);
    return PROJECT_SORTS.find((sort) => sort === stored) ?? 'updated';
  } catch {
    return 'updated';
  }
}

/**
 * features/projects/ProjectsScreen.tsx at /projects. The link has no filter, so an Admin with "Only my work" opens it on "mine"
 * (owner, 2026-10-26, fbk_065): the read follows the reach of the cached session.
 */
function projects(reach: AdminReach): GuardRead[] {
  return [
    read('projects.list', { status: 'active', sort: storedSort(), filter: projectsDefaultShow(reach, new URLSearchParams()) }),
    read('settings.get', {}), read('teams.list', {}), read('users.list', {}), read('clients.list', {}), read('subCompanies.list', {}),
  ];
}

/** The reads by the link of the tab. */
export const PRESS_READS: Record<string, (reach: AdminReach) => GuardRead[]> = {
  '/projects': projects,
  '/dashboard': () => GUARD_READS.dashboard!(new URLSearchParams(), undefined),
  '/work': () => [read('tasks.list', MINE_OPEN), read('tasks.list', REVIEW_FOR_ME)],
  '/meetings': () => [read('meetings.list', meetingsListInput(todayISO()))],
  '/me': () => [read('settings.get', {}), ...(REMOTE ? [read('google.status', {})] : [])],
  '/inbox': () => [read('chats.list', {})],
  '/notifications': () => [read('notifications.list', {})],
};

/** The function for onPointerDown of a tab link: it starts the main reads of the tab, when it has any. */
export function usePressReads(): (to: string) => void {
  const prefetch = usePrefetchCall();
  const client = useQueryClient();
  return useCallback((to: string) => {
    const reach = reachOfSession(client.getQueryData(['api', 'session.get', {}]));
    for (const start of PRESS_READS[to]?.(reach) ?? []) start(prefetch);
  }, [prefetch, client]);
}
