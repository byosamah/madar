import { adminReachOf } from '../api/chatState';
import type { AdminReach } from '../api/contract/entities';

/**
 * What "Only my work" does to the project lists (owner, 2026-10-26, fbk_065). An Admin who picked "Only my work" sees on Home and in the
 * Projects screen only the projects that the Admin leads or works on. The Dashboard, the map and the Open space stay office-wide.
 * "My work, and the rest in the list" and "Everything" change nothing here.
 */

/** The reach of a session answer. A stored answer may have no preferences: then it is "mixed". */
export function reachOfSession(session: unknown): AdminReach {
  const user = (session as { user?: Parameters<typeof adminReachOf>[0] } | null | undefined)?.user;
  return user?.systemRole && user.preferences ? adminReachOf(user) : 'mixed';
}

/**
 * The projects.list input of Home for a person. The Admin asks for every active project, but not with "Only my work": then the Admin
 * asks as a Member does (the projects that the person leads or works on, the paused ones too). The home cache keys use this too.
 */
export function homeProjectsInput(admin: boolean, reach: AdminReach) {
  return admin && reach !== 'mine'
    ? ({ filter: 'all', sort: 'deadline' } as const)
    : ({ filter: 'mine', status: 'all', sort: 'deadline' } as const);
}

/** The keys of the Projects link that set a filter. A link that has none of them is a bare link. */
export const PROJECT_FILTER_KEYS = ['filter', 'leader', 'client', 'team', 'stage', 'health', 'subCompany', 'status'] as const;

/** True when the link carries no filter key at all. */
export function isBareProjectsLink(params: URLSearchParams): boolean {
  return PROJECT_FILTER_KEYS.every((key) => !params.has(key));
}

/**
 * The "Show" choice of the Projects screen when the link does not name one. An Admin with "Only my work" opens a bare link on "mine".
 * A link with any filter key keeps "all", so a link from the Dashboard still shows what it promises.
 */
export function projectsDefaultShow(reach: AdminReach, params: URLSearchParams): 'mine' | 'all' {
  return reach === 'mine' && isBareProjectsLink(params) ? 'mine' : 'all';
}
