import type { User } from './contract/entities';
import { memberKey, type State } from './store';

export type Action =
  | 'project.view' | 'project.create' | 'project.edit' | 'project.changeLeader' | 'project.archive'
  | 'project.delete' | 'project.healthOverride' | 'project.editCode'
  | 'task.createForAnyone' | 'task.createForSelf' | 'task.updateOwn' | 'task.contribute' | 'task.updateAny' | 'task.review' | 'task.delete'
  | 'task.take'
  | 'content.post' | 'content.editOwn' | 'chat.project' | 'comment.read'
  | 'event.undoAgent' | 'admin.manage' | 'people.manage' | 'payment.manage';

export type ProjectRole = 'leader' | 'team' | 'other';

/** ownerId is the lead of a task. Null: the task has no lead, so nobody holds the rights of its lead. */
export type Resource = { projectRole?: ProjectRole; ownerId?: string | null; helperIds?: string[]; authorId?: string; targetUserId?: string };

export function projectRoleOf(state: State, projectId: string, userId: string): ProjectRole {
  const project = state.projects[projectId];
  if (!project) return 'other';
  if (project.leaderId === userId) return 'leader';
  return state.members[memberKey(projectId, userId)] ? 'team' : 'other';
}

/** The person behind a user: an agent's owner, or the person. */
export function principalOf(state: State, userId: string): string {
  const user = state.users[userId];
  return user?.kind === 'agent' && user.ownerId ? user.ownerId : userId;
}

/**
 * True when a user is an Admin, or an agent that acts for an Admin. An agent acts with the rights of its person,
 * so an agent of an Admin holds the Admin's rights. Management never makes or changes either kind.
 * It reads only the people, so the Admin screen asks the same rule with the people of users.list.
 */
export function holdsAdminRights(state: Pick<State, 'users'>, user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.systemRole === 'admin') return true;
  return user.kind === 'agent' && user.ownerId !== null && state.users[user.ownerId]?.systemRole === 'admin';
}

/** The permission table from spec section 2.3. No screen checks permissions in another way. */
export function can(actor: User, action: Action, resource: Resource = {}): boolean {
  if (!actor.active) return action === 'project.view';
  const admin = actor.systemRole === 'admin';
  const role = resource.projectRole ?? 'other';
  const leads = admin || role === 'leader';
  const onProject = leads || role === 'team';
  switch (action) {
    case 'project.view':
    case 'project.create':
    // Every active person reads task comments, as the project page shows them to non-members too. The Inbox task threads use the same rule.
    case 'comment.read':
      return true;
    case 'project.edit':
    case 'project.changeLeader':
    case 'project.archive':
    case 'project.healthOverride':
    case 'task.createForAnyone':
    case 'task.updateAny':
    case 'task.review':
    case 'task.delete':
    case 'event.undoAgent':
      return leads;
    case 'project.delete':
    // The code is fixed after create. Only the Admin corrects it (owner, 2026-10-05).
    case 'project.editCode':
    case 'admin.manage':
      return admin;
    // Management makes and changes people, but never an Admin: the calls add that rule. The office settings stay with the Admin.
    case 'people.manage':
      return admin || actor.systemRole === 'management';
    // Payments are for the people who handle money. Every other person, a project leader too, never reads them.
    case 'payment.manage':
      return admin || actor.systemRole === 'management' || actor.systemRole === 'accounting';
    case 'task.createForSelf':
    case 'content.post':
    case 'chat.project':
    // A person on the team takes the lead of a task with no lead (owner, 2026-10-05). The call checks that the task has none.
    case 'task.take':
      return onProject;
    case 'task.updateOwn':
      return leads || (onProject && resource.ownerId === actor.id);
    // A helper ticks checklist items beside the lead. The lead, the leader and the Admin may do it too.
    case 'task.contribute':
      return leads || (onProject && (resource.ownerId === actor.id || (resource.helperIds ?? []).includes(actor.id)));
    case 'content.editOwn':
      return onProject && resource.authorId === actor.id;
    default:
      return false;
  }
}
