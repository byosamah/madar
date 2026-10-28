import type { Event, Project, User } from './contract/entities';
import { can, holdsRight, projectResource, type Actor } from './permissions';
import { ensureRights } from './rights';
import type { State } from './store';

/**
 * The view rule of a project for the LISTS (hidden projects, wave D2, owner 2026-10-22). One person asks it for many projects, so the
 * person gets the office rights once. It is the rule of mayViewProject (permissions.ts): the same facts, asked of one project at a time.
 * Every list, count and search that runs over projects asks it first, so a hidden project, or an open project for a role without
 * "See every project" where the person does not work, never shows in a list, a count or a hit.
 */
type ViewState = Pick<State, 'projects' | 'members' | 'settings'>;

/** True for a project that the viewer sees. The viewer carries the office rights (ensureRights does it here). */
export function projectViewer(state: ViewState, viewer: User): (project: Pick<Project, 'id'>) => boolean {
  const actor = ensureRights(state, viewer);
  return (project) => can(actor, 'project.view', projectResource(state, project.id, viewer.id));
}

/** The ids of the projects of the office that the viewer sees. */
export function visibleProjectIds(state: ViewState, viewer: User): Set<string> {
  const sees = projectViewer(state, viewer);
  return new Set(Object.values(state.projects).filter(sees).map((project) => project.id));
}

/** The ids of the projects of the office that the viewer does not see. */
export function hiddenProjectIds(state: ViewState, viewer: User): string[] {
  const sees = projectViewer(state, viewer);
  return Object.values(state.projects).filter((project) => !sees(project)).map((project) => project.id);
}

/** The verb of the change that deletes a project. Its "before" holds the project as it was. */
export const PROJECT_DELETED_VERB = 'project.deleted';

/** The verbs of the changes of the team of a project. A member change holds the person in "after" (added) or in "before" (removed). */
export const MEMBER_ADDED_VERB = 'member.added';
export const MEMBER_REMOVED_VERB = 'member.removed';

/** The facts of a deleted project that its view rule reads, taken from its delete event (security review F4). */
export type GoneProject = {
  /** True when the project was hidden at the delete. */
  readonly hidden: boolean;
  readonly leaderId: string | null;
  /** The chosen viewers of the project at the delete. */
  readonly viewerIds: readonly string[];
  /** The people on the team at the delete. */
  readonly teamIds: readonly string[];
};

type DeleteEvent = Pick<Event, 'seq' | 'before' | 'teamIds'> & Partial<Pick<Event, 'undoneBy'>>;
type MemberEvent = Pick<Event, 'seq' | 'verb' | 'before' | 'after'>;

const userIdIn = (side: unknown): string | undefined => {
  const id = (side as { userId?: unknown } | null | undefined)?.userId;
  return typeof id === 'string' ? id : undefined;
};

/**
 * The team of a project at the delete, for a delete event that holds no list (written before the list existed). It replays the member
 * changes that came before the delete, in order. A team row that was written with no change is not known here: such a row exists only in
 * sample data and in tests, and every delete event of the current code holds the list.
 */
function teamFromChanges(deleteSeq: number, changes: readonly MemberEvent[]): string[] {
  const team = new Set<string>();
  for (const change of [...changes].sort((a, b) => a.seq - b.seq)) {
    if (change.seq >= deleteSeq) continue;
    if (change.verb === MEMBER_ADDED_VERB) {
      const id = userIdIn(change.after);
      if (id) team.add(id);
    } else if (change.verb === MEMBER_REMOVED_VERB) {
      const id = userIdIn(change.before);
      if (id) team.delete(id);
    }
  }
  return [...team];
}

/** The facts of one deleted project. "changes" are the member changes of that project: they are read only when the event holds no list. */
export function goneProjectOf(event: DeleteEvent, changes: readonly MemberEvent[]): GoneProject {
  const before = (event.before ?? {}) as { access?: { hidden?: boolean; viewerIds?: string[] }; leaderId?: string | null };
  return {
    hidden: before.access?.hidden === true,
    leaderId: before.leaderId ?? null,
    viewerIds: before.access?.viewerIds ?? [],
    teamIds: event.teamIds ?? teamFromChanges(event.seq, changes),
  };
}

/**
 * The facts of every deleted project that these events name, by project id. A project that was deleted, taken back and deleted again reads its
 * newest delete that stands. Pass the events of the state: the delete events, and for an old delete event the member changes.
 */
export function goneProjectsOf(events: Iterable<Pick<Event, 'verb' | 'projectId' | 'targetId' | 'seq' | 'before' | 'after' | 'teamIds'> & Partial<Pick<Event, 'undoneBy'>>>): Map<string, GoneProject> {
  const deletes = new Map<string, DeleteEvent>();
  const changes = new Map<string, MemberEvent[]>();
  for (const event of events) {
    if (event.verb === PROJECT_DELETED_VERB) {
      const found = deletes.get(event.targetId);
      if (!event.undoneBy && (!found || event.seq > found.seq)) deletes.set(event.targetId, event);
    } else if ((event.verb === MEMBER_ADDED_VERB || event.verb === MEMBER_REMOVED_VERB) && event.projectId !== null) {
      changes.set(event.projectId, [...(changes.get(event.projectId) ?? []), event]);
    }
  }
  return new Map([...deletes].map(([id, event]) => [id, goneProjectOf(event, changes.get(id) ?? [])]));
}

/**
 * The view rule of a deleted project (security review F4). A holder of "See hidden projects" reads it always. A project that was hidden at
 * the delete shows to such a holder only. A project that was open shows to the people who saw it before: the leader, the team and the
 * chosen people of the delete, and a holder of "See every project". The last step is can('project.view'), the rule of a live project, so a
 * person who left the office still sees an open project only when that person worked on it.
 */
export function viewsGoneProject(actor: Actor, viewerId: string, project: GoneProject): boolean {
  if (holdsRight(actor, 'project.hidden')) return true;
  if (project.hidden) return false;
  const projectRole = project.leaderId === viewerId ? 'leader' : project.teamIds.includes(viewerId) ? 'team' : 'other';
  return can(actor, 'project.view', { projectRole, access: { hidden: false, chosen: project.viewerIds.includes(viewerId) } });
}

/**
 * True for a change that the viewer may read by its project: a change with no project, a change of a project that the viewer sees, and
 * a change of a deleted project that the viewer saw (viewsGoneProject). A state that holds no delete event of the project reads it as open.
 */
export function eventProjectViewer(state: State, viewer: User): (event: Pick<Event, 'projectId'>) => boolean {
  const sees = projectViewer(state, viewer);
  const actor = ensureRights(state, viewer);
  let gone: Map<string, GoneProject> | undefined;
  return (event) => {
    if (event.projectId === null) return true;
    const project = state.projects[event.projectId];
    if (project) return sees(project);
    gone ??= goneProjectsOf(Object.values(state.events));
    const facts = gone.get(event.projectId);
    return facts === undefined || viewsGoneProject(actor, viewer.id, facts);
  };
}
