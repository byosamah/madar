import type { CallOutput } from '../../api/calls';

export type DashboardData = CallOutput<'dashboard.get'>;

/** The Leader, Client, Team and Sub-company filters of the Dashboard. Each number counts only the projects that pass them. */
export type DashboardFilters = { leaderId?: string; clientId?: string; teamId?: string; subCompanyId?: string };

/**
 * A link to a list that keeps the Leader, Client, Team and Sub-company filters of the Dashboard, so the list shows what the number counts
 * (audit 2026-10-03, DSH-7; owner, 2026-10-06, item 3). Every link to a list has a query already.
 */
export function withFilters(to: string, filters: DashboardFilters): string {
  const parts = ([['leader', filters.leaderId], ['client', filters.clientId], ['team', filters.teamId], ['subCompany', filters.subCompanyId]] as const)
    .flatMap(([key, value]) => (value ? [`${key}=${value}`] : []));
  return parts.length > 0 ? `${to}&${parts.join('&')}` : to;
}
