import { DEFAULT_STALE_DAYS, type PauseKind, type Project, type Settings } from './contract/entities';
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

/** The project test for a team filter. No team id lets every project through. A team that does not exist matches nothing, like a leader or a client that does not exist. */
export function teamFilter(state: State, teamId: string | undefined): (project: Project) => boolean {
  if (!teamId) return () => true;
  const team = teamsOf(state)[teamId];
  return (project) => team !== undefined && projectTouchesTeam(state, project, team.memberIds);
}
