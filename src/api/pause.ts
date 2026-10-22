import { DEFAULT_STALE_DAYS, type PauseKind, type Project, type Settings, type User } from './contract/entities';
import { projectViewer } from './projectView';
import { teamsOf, type State } from './store';
import { diffDays, stampDay } from '../lib/dates';

/** How many days a paused project waits before it turns stale. */
export function staleAfterDaysOf(settings: Settings): number {
  return settings.staleAfterDays ?? DEFAULT_STALE_DAYS;
}

export function pauseKindOf(project: Project): PauseKind {
  return project.pause?.kind ?? 'internal';
}

/**
 * The days a project has been paused, when that is longer than the office allows. Null for a project that is not
 * paused or not stale yet. Computed from the day of the pause and today, never stored (colleague comment 16).
 * A project paused exactly the limit is not stale yet. The day after it is.
 */
export function staleDaysOf(state: State, project: Project, today: string): number | null {
  if (project.status !== 'on_hold' || !project.pause) return null;
  const days = diffDays(stampDay(project.pause.at), today);
  return days > staleAfterDaysOf(state.settings) ? days : null;
}

/** True when any person of the team leads the project or is on its team. */
export function projectTouchesTeam(state: State, project: Project, memberIds: string[]): boolean {
  return memberIds.some((userId) => project.leaderId === userId || state.members[`${project.id}:${userId}`] !== undefined);
}

/** The team test of a project, with no view rule. No team id lets every project through. A team that does not exist matches nothing. */
function inTeamOf(state: State, teamId: string | undefined): (project: Project) => boolean {
  if (!teamId) return () => true;
  const team = teamsOf(state)[teamId];
  return (project) => team !== undefined && projectTouchesTeam(state, project, team.memberIds);
}

/**
 * The project test for a team filter. A project that the viewer does not see never passes (hidden projects, owner 2026-10-22). No team id
 * lets every project that the viewer sees through. A team that does not exist matches nothing, like a leader or a client that does not exist.
 */
export function teamFilter(state: State, teamId: string | undefined, viewer: User): (project: Project) => boolean {
  const sees = projectViewer(state, viewer);
  const inTeam = inTeamOf(state, teamId);
  return (project) => sees(project) && inTeam(project);
}

/**
 * The project test for the Leader, Client, Team and Sub-company filters of the Dashboard. The lists that the Dashboard opens take
 * the same filters, so a number and its list agree (owner, 2026-10-06; sub-company, INT-09, 2026-10-19). A leader, a client, a
 * team or a sub-company that does not exist matches nothing. A project that the viewer does not see never passes (hidden projects,
 * owner 2026-10-22), so every number and every list that takes this filter counts only the projects of the viewer.
 */
export function peopleFilter(
  state: State,
  filters: { leaderId?: string; clientId?: string; teamId?: string; subCompanyId?: string },
  viewer: User,
): (project: Project) => boolean {
  const sees = projectViewer(state, viewer);
  const inTeam = inTeamOf(state, filters.teamId);
  return (project) => sees(project)
    && (!filters.leaderId || project.leaderId === filters.leaderId)
    && (!filters.clientId || project.clientId === filters.clientId)
    && (!filters.subCompanyId || project.subCompanyId === filters.subCompanyId)
    && inTeam(project);
}
