import type { Event, Project, User } from './contract/entities';
import { can, mayViewProject, projectAccessOf } from './permissions';
import { ensureRights } from './rights';
import type { State } from './store';

/**
 * The notice rule of a hidden project (hidden projects, owner 2026-10-22, wave D3). A notice whose item belongs to a project that its
 * owner no longer sees reads as gone: no words, no names, no link and no badge (the rule of a notice of an office to-do). It stays in the
 * list of its owner, so an Undo never changes the list or the count of a person who lost the view.
 *
 * This one function holds the rule for the four places that mirror it: `hiddenProject` (handlers/notifications.ts: isGone, viewOf and
 * peopleOfCopy), `noticeProjectHidden` use in `dropNotices` (handlers/history.ts) and `mayView` of the Admin copies (adminCopies.ts).
 * Change them together.
 */

type Copy = Record<string, unknown>;

/** The last copy of a deleted item (a to-do, a post or a project), from its newest delete event that stands. */
function lastCopy(state: State, targetType: 'task' | 'update' | 'project', id: string): Copy | null {
  let found: Event | null = null;
  for (const event of Object.values(state.events)) {
    if (event.verb === `${targetType}.deleted` && event.targetId === id && !event.undoneBy && (!found || event.seq > found.seq)) found = event;
  }
  return found && found.before !== null && typeof found.before === 'object' ? (found.before as Copy) : null;
}

/** The id of the project that the item of a notice belongs to, live or deleted. Null for a notice of no project (a report, an office to-do, a direct chat). */
export function projectOfNotice(state: State, targetType: string, targetId: string): string | null {
  const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
  if (targetType === 'task') return text((state.tasks[targetId] ?? lastCopy(state, 'task', targetId))?.projectId);
  if (targetType === 'update') return text((state.updates[targetId] ?? lastCopy(state, 'update', targetId))?.projectId);
  if (targetType === 'project') return targetId;
  if (targetType === 'chat') {
    const conversation = state.conversations[targetId];
    return conversation?.kind === 'project' ? text(conversation.projectId) : null;
  }
  if (targetType === 'meeting') return text(state.meetings?.[targetId]?.projectId);
  return null;
}

/**
 * True when the item of a notice belongs to a project that the person may not view. The project may be gone: then its last copy tells
 * (its leader, its chosen people and the holders of "See hidden projects" keep the view of a deleted hidden project, because its team is
 * gone with it). A project that never existed hides nothing.
 */
export function noticeProjectHidden(state: State, targetType: string, targetId: string, person: User): boolean {
  const projectId = projectOfNotice(state, targetType, targetId);
  if (projectId === null) return false;
  const project = state.projects[projectId];
  if (project) return !mayViewProject(state, project, person);
  const copy = lastCopy(state, 'project', projectId) as (Partial<Project> & Pick<Project, 'access'>) | null;
  if (copy === null) return false;
  const role = copy.leaderId === person.id ? 'leader' : 'other';
  return !can(ensureRights(state, person), 'project.view', { projectRole: role, access: projectAccessOf(copy, person.id) });
}
