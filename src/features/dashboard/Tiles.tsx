import type { CallOutput } from '../../api/calls';

export type DashboardData = CallOutput<'dashboard.get'>;

/**
 * A Projects link that keeps the Team filter of the Dashboard, so the list shows the projects that the number counts
 * (audit 2026-10-03, DSH-7). The Projects screen has no leader or client filter. Every Projects link has a query already.
 */
export const withTeam = (to: string, teamId: string | undefined) => (teamId ? `${to}&team=${teamId}` : to);
