import type { CallInput, CallName } from '../api/calls';
import { clientParam, oneOf, subCompanyParam, teamParam, userParam } from '../lib/params';
import { REMOTE } from './mode';
import type { usePrefetchCall } from './prefetch';
import type { ScreenName } from './screens';

/**
 * The reads of the screens that sit behind a guard (performance audit 2026-10-21, DF-7). RequireRight, and the Admin page, draw nothing
 * until session.get answers, so the reads of their screens started one round trip after the first request. The guard starts the reads
 * of this list at once, with the session, under the exact keys of the screens (`usePrefetchCall`, remote build only). A person who
 * may not open the screen wastes one set of reads, and the server refuses each one: a guard that finds the session in the cache
 * without the switch starts none (`StartReads`, routes.tsx).
 * A list follows the screen file. When a screen changes a read, change its line here too: `GuardReads.test.tsx` holds every answer and
 * fails when the screen asks for a key that this list did not start.
 */

type Prefetch = ReturnType<typeof usePrefetchCall>;
/** One read, as a step that starts it with the prefetch function. */
export type GuardRead = (prefetch: Prefetch) => void;
const read = <N extends CallName>(name: N, input: CallInput<N>): GuardRead => (prefetch) => prefetch(name, input);

/** The Dashboard filters in the link: the same four that the Dashboard, the meeting view and the Open space read. */
function filtersOf(params: URLSearchParams) {
  return { leaderId: userParam(params.get('leader')), clientId: clientParam(params.get('client')), teamId: teamParam(params.get('team')), subCompanyId: subCompanyParam(params.get('subCompany')) };
}

const STATUSES = ['active', 'on_hold', 'all'] as const;

/** features/dashboard/DashboardScreen.tsx */
function dashboard(params: URLSearchParams): GuardRead[] {
  const filters = filtersOf(params);
  const status = oneOf(params.get('status'), STATUSES, 'active');
  // The status changes only the schedule section; every other section counts the active projects.
  const shown = oneOf(params.get('view'), ['projects', 'people', 'schedule', 'map'] as const, 'projects') === 'schedule' ? status : 'active';
  return [
    read('dashboard.get', { status: 'active', ...filters }),
    ...(shown === 'active' ? [] : [read('dashboard.get', { status: shown, ...filters })]),
    read('users.list', {}), read('clients.list', {}), read('teams.list', {}), read('subCompanies.list', {}),
  ];
}

/** features/dashboard/MeetingView.tsx */
function meeting(params: URLSearchParams): GuardRead[] {
  return [
    read('dashboard.get', { status: oneOf(params.get('status'), STATUSES, 'active'), ...filtersOf(params) }),
    read('tasks.list', { includeDone: false, activeProjectsOnly: false }),
    read('users.list', {}), read('clients.list', {}), read('teams.list', {}), read('subCompanies.list', {}),
  ];
}

/** features/space/OpenSpaceScreen.tsx (the filters come from useScope: the same four) */
function space(params: URLSearchParams): GuardRead[] {
  const filters = filtersOf(params);
  return [
    read('projects.list', { status: 'all', ...filters }),
    read('tasks.list', { activeProjectsOnly: false, includeDone: false, ...filters }),
    read('users.list', {}), read('subCompanies.list', {}),
  ];
}

/** features/settings/admin/PeopleSection.tsx: the section that /admin opens for the Admin. Another section starts nothing here. */
function admin(_params: URLSearchParams, section: string | undefined): GuardRead[] {
  if (section !== undefined && section !== 'people') return [];
  return [
    read('settings.get', {}), read('users.list', { includeInactive: true }), read('teams.list', {}),
    ...(REMOTE ? [read('users.invites', {})] : []),
  ];
}

/** The reads of each guarded screen, by the name of the screen in the route table. */
export const GUARD_READS: Partial<Record<ScreenName, (params: URLSearchParams, section: string | undefined) => GuardRead[]>> = {
  dashboard, meeting, space, admin,
};
