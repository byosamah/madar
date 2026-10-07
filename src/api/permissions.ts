import type { Task, User } from './contract/entities';
import { memberKey, type State } from './store';

export type Action =
  | 'project.view' | 'project.create' | 'project.edit' | 'project.changeLeader' | 'project.archive'
  | 'project.delete' | 'project.healthOverride' | 'project.editCode'
  | 'task.view' | 'task.createForAnyone' | 'task.createForSelf' | 'task.updateOwn' | 'task.contribute' | 'task.updateAny' | 'task.review' | 'task.delete'
  | 'task.take'
  | 'content.post' | 'content.editOwn' | 'chat.project' | 'comment.read'
  | 'event.undoAgent' | 'admin.manage' | 'people.manage' | 'payment.manage';

export type ProjectRole = 'leader' | 'team' | 'other';

/**
 * ownerId is the lead of a task. Null: the task has no lead, so nobody holds the rights of its lead.
 * office: the resource is an office task (or its comment or file), which belongs to no project. makerId is the person who made the
 * task: for a task an agent made, the person the agent acts for (owner, 2026-10-06). A project task names its maker too (2026-10-07).
 */
export type Resource = {
  projectRole?: ProjectRole; ownerId?: string | null; helperIds?: string[]; authorId?: string; targetUserId?: string;
  office?: boolean; makerId?: string;
};

export function projectRoleOf(state: State, projectId: string | null, userId: string): ProjectRole {
  if (projectId === null) return 'other';
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

type TaskPeople = Pick<Task, 'projectId' | 'createdBy' | 'ownerId' | 'helperIds'>;

/**
 * The resource of a task for the rules of one person: the role of the person in the project of a project task, or the people of an
 * office task. Every rule on a task asks can() with this resource, so a project task and an office task each keep one rule.
 */
export function taskResource(state: State, task: TaskPeople, viewerId: string): Resource {
  const people = { ownerId: task.ownerId, helperIds: task.helperIds ?? [] };
  const makerId = principalOf(state, task.createdBy);
  if (task.projectId === null) return { office: true, makerId, ...people };
  return { projectRole: projectRoleOf(state, task.projectId, viewerId), makerId, ...people };
}

/** The one view rule of a task: everyone sees a project task; an office task shows to its maker, lead, helpers and the Admin. */
export function mayViewTask(state: State, viewer: User, task: TaskPeople): boolean {
  return can(viewer, 'task.view', taskResource(state, task, viewer.id));
}

/**
 * The rules of an office task (owner, 2026-10-06). Its maker holds the rights a project leader holds on a project task: the lead,
 * the helpers, the review need, the review and the delete. Its lead changes and finishes it. A helper ticks. Every person who sees
 * it comments on it and takes it when it has no lead. Anyone makes an office task, for themselves or for anyone.
 */
function canOnOfficeTask(actor: User, action: Action, resource: Resource): boolean {
  const admin = actor.systemRole === 'admin';
  const maker = admin || resource.makerId === actor.id;
  const leads = maker || (resource.ownerId !== undefined && resource.ownerId === actor.id);
  const sees = leads || (resource.helperIds ?? []).includes(actor.id);
  switch (action) {
    case 'task.createForSelf':
    case 'task.createForAnyone':
      return true;
    case 'task.view':
    case 'comment.read':
    case 'content.post':
    case 'task.contribute':
    case 'task.take':
      return sees;
    case 'task.updateOwn':
      return leads;
    case 'task.updateAny':
    case 'task.review':
    case 'task.delete':
    case 'event.undoAgent':
      return maker;
    case 'content.editOwn':
      return sees && resource.authorId === actor.id;
    default:
      return false;
  }
}

/** The permission table from spec section 2.3. No screen checks permissions in another way. */
export function can(actor: User, action: Action, resource: Resource = {}): boolean {
  // A project task reads like its project. An office task stays with its people.
  if (!actor.active) return action === 'project.view' || (action === 'task.view' && !resource.office);
  if (resource.office) return canOnOfficeTask(actor, action, resource);
  const admin = actor.systemRole === 'admin';
  const role = resource.projectRole ?? 'other';
  const leads = admin || role === 'leader';
  const onProject = leads || role === 'team';
  // The person who added a task holds the leader's rights on it while on the team: the lead, the helpers, the prerequisites, the
  // changes and the delete. The review stays with the leader (owner, 2026-10-07).
  const makes = leads || (onProject && resource.makerId !== undefined && resource.makerId === actor.id);
  switch (action) {
    case 'project.view':
    case 'project.create':
    // Every person sees every project task (spec 2.3).
    case 'task.view':
    // Every active person reads task comments, as the project page shows them to non-members too. The Inbox task threads use the same rule.
    case 'comment.read':
      return true;
    case 'project.edit':
    case 'project.changeLeader':
    case 'project.archive':
    case 'project.healthOverride':
    case 'task.review':
    case 'event.undoAgent':
      return leads;
    case 'task.updateAny':
    case 'task.delete':
      return makes;
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
    // A team member adds a task for any team mate (owner, 2026-10-07). Only the leader and the Admin name a person outside the team.
    case 'task.createForAnyone':
    case 'task.createForSelf':
    case 'content.post':
    case 'chat.project':
    // A person on the team takes the lead of a task with no lead (owner, 2026-10-05). The call checks that the task has none.
    case 'task.take':
      return onProject;
    case 'task.updateOwn':
      return makes || (onProject && resource.ownerId === actor.id);
    // A helper ticks checklist items beside the lead. The lead, the maker, the leader and the Admin may do it too.
    case 'task.contribute':
      return makes || (onProject && (resource.ownerId === actor.id || (resource.helperIds ?? []).includes(actor.id)));
    case 'content.editOwn':
      return onProject && resource.authorId === actor.id;
    default:
      return false;
  }
}
