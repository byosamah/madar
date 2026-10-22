import type { Event, Project, User } from './contract/entities';
import { can, holdsRight, projectResource } from './permissions';
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

/**
 * The ids of the projects that were deleted while hidden. The list reads the delete events: a deleted project has no record left,
 * and its "before" tells what its access was. Only a holder of "See hidden projects" reads the changes of such a project.
 */
export function goneHiddenProjectIds(events: Iterable<Pick<Event, 'verb' | 'targetId' | 'before'>>): Set<string> {
  const gone = new Set<string>();
  for (const event of events) {
    if (event.verb !== PROJECT_DELETED_VERB) continue;
    const before = event.before as { access?: { hidden?: boolean } } | null | undefined;
    if (before?.access?.hidden === true) gone.add(event.targetId);
  }
  return gone;
}

/**
 * True for a change that the viewer may read by its project: a change with no project, a change of a project that the viewer sees, and
 * a change of a deleted project that was open. A change of a deleted project that was hidden shows to a holder of "See hidden projects"
 * only (the Admin by default). An open project keeps the rule it had.
 */
export function eventProjectViewer(state: State, viewer: User): (event: Pick<Event, 'projectId'>) => boolean {
  const sees = projectViewer(state, viewer);
  const mayHidden = holdsRight(ensureRights(state, viewer), 'project.hidden');
  let gone: Set<string> | undefined;
  return (event) => {
    if (event.projectId === null) return true;
    const project = state.projects[event.projectId];
    if (project) return sees(project);
    if (mayHidden) return true;
    gone ??= goneHiddenProjectIds(Object.values(state.events));
    return !gone.has(event.projectId);
  };
}
