import type { Meeting, OfficeRight, Task, User } from './contract/entities';
import { memberKey } from './rowKeys';
import type { State } from './store';

export type Action =
  | 'project.view' | 'project.create' | 'project.edit' | 'project.changeLeader' | 'project.archive'
  | 'project.delete' | 'project.healthOverride' | 'project.editCode'
  | 'task.view' | 'task.createForAnyone' | 'task.createForSelf' | 'task.updateOwn' | 'task.contribute' | 'task.updateAny' | 'task.review' | 'task.delete'
  | 'task.take' | 'meeting.view' | 'meeting.create' | 'meeting.edit' | 'meeting.minutes'
  | 'content.post' | 'content.editOwn' | 'chat.project' | 'comment.read'
  | 'event.undoAgent' | 'admin.manage' | 'people.manage' | 'payment.manage' | 'clients.manage' | 'templates.manageAll' | 'report.office';

export type ProjectRole = 'leader' | 'team' | 'other';

/**
 * The office rights, with the same names and order as OfficeRight (contract/entities.ts). A test checks that both lists agree.
 * The Admin holds every one of them.
 */
export const OFFICE_RIGHTS: readonly OfficeRight[] = [
  'people.manage', 'payment.manage', 'project.delete', 'project.editCode', 'clients.manage', 'templates.manageAll', 'report.office',
];

/**
 * The rights of each built-in role when the office settings give none (owner, 2026-10-18). They match today's rights. The office report
 * right is new, and management holds it by default.
 */
export const DEFAULT_RIGHTS: Readonly<Record<'management' | 'accounting' | 'member', readonly OfficeRight[]>> = {
  management: ['people.manage', 'payment.manage', 'report.office'],
  accounting: ['payment.manage'],
  member: [],
};

/** A person as can() reads it: the user, plus the office rights that the office settings give the person (rights.ts). */
export type Actor = User & { readonly officeRights?: readonly OfficeRight[] };

/**
 * The office rights of an actor. The Admin holds all of them. Any other person holds the attached rights only. A person with no
 * attached rights holds none, so a path that forgot to attach them fails closed. Without this rule, the Admin could take a right
 * from Management and a forgotten path would still give the default (security review 2026-10-18).
 */
function heldRights(actor: Actor): readonly OfficeRight[] {
  if (actor.systemRole === 'admin') return OFFICE_RIGHTS;
  return actor.officeRights ?? [];
}

/**
 * ownerId is the lead of a task. Null: the task has no lead, so nobody holds the rights of its lead.
 * office: the resource is an office task (or its comment or file), which belongs to no project. makerId is the person who made the
 * task: for a task an agent made, the person the agent acts for (owner, 2026-10-06). A project task names its maker too (2026-10-07).
 */
export type Resource = {
  projectRole?: ProjectRole; ownerId?: string | null; helperIds?: string[]; authorId?: string; targetUserId?: string;
  office?: boolean; makerId?: string;
  /**
   * A meeting (fbk_022). organizerId is the person behind the organizer (an agent organizer is its person). noProject: the meeting has
   * no project, so only its organizer and its attendees read it, the Admin too only as an attendee (owner, 2026-10-19). A project
   * meeting reads like its project and carries projectRole.
   */
  meeting?: { organizerId: string; attendeeIds: readonly string[]; noProject: boolean };
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

type MeetingPeople = Pick<Meeting, 'projectId' | 'organizerId' | 'attendeeIds'>;

/**
 * The resource of a meeting for the rules of one person: the role of the person in the project of a project meeting, or the people of
 * a meeting with no project. Every rule on a meeting asks can() with this resource.
 */
export function meetingResource(state: State, meeting: MeetingPeople, viewerId: string): Resource {
  const people = { organizerId: principalOf(state, meeting.organizerId), attendeeIds: meeting.attendeeIds, noProject: meeting.projectId === null };
  if (meeting.projectId === null) return { meeting: people };
  return { projectRole: projectRoleOf(state, meeting.projectId, viewerId), meeting: people };
}

/** The one view rule of a meeting: everyone sees a project meeting; a meeting with no project shows to its organizer and its attendees only. */
export function mayViewMeeting(state: State, viewer: User, meeting: MeetingPeople): boolean {
  return can(viewer, 'meeting.view', meetingResource(state, meeting, viewer.id));
}

/**
 * The rules of a meeting (fbk_022, owner 2026-10-19). A project meeting is read by everyone. The team, the leader and the Admin plan
 * one (the right to post). The organizer, the leader and the Admin change or cancel it. A meeting with no project is planned by
 * anyone, read by its organizer and its attendees, and changed by its organizer. The Admin has no extra right there.
 * The minutes (wave 2): the organizer and the attendees write them. For a project meeting the leader and the Admin may too, because the
 * minutes join the project record that the leader answers for. A team member who did not attend only reads them.
 */
function canOnMeeting(actor: User, action: Action, resource: Resource): boolean {
  const people = resource.meeting!;
  const organizer = people.organizerId === actor.id;
  if (people.noProject) {
    switch (action) {
      case 'meeting.view':
        return organizer || people.attendeeIds.includes(actor.id);
      case 'meeting.create':
        return true;
      case 'meeting.edit':
        return organizer;
      case 'meeting.minutes':
        return organizer || people.attendeeIds.includes(actor.id);
      default:
        return false;
    }
  }
  const leads = actor.systemRole === 'admin' || resource.projectRole === 'leader';
  switch (action) {
    case 'meeting.view':
      return true;
    case 'meeting.create':
      return leads || resource.projectRole === 'team';
    case 'meeting.edit':
      return leads || organizer;
    case 'meeting.minutes':
      return leads || organizer || people.attendeeIds.includes(actor.id);
    default:
      return false;
  }
}

/** The permission table from spec section 2.3. No screen checks permissions in another way. */
export function can(actor: Actor, action: Action, resource: Resource = {}): boolean {
  // A person who left the office reads and changes no meeting.
  if (resource.meeting) return actor.active && canOnMeeting(actor, action, resource);
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
    // The office settings stay with the Admin.
    case 'admin.manage':
      return admin;
    // The office rights (rights.ts): the Admin holds all of them. A role holds the rights that the office gives it.
    // Management makes and changes people, but never an Admin: the calls add that rule.
    case 'people.manage':
    // Payments are for the people who handle money. A project leader never reads them, unless the office gives the right.
    case 'payment.manage':
    // The code is fixed after create. Only a person with the right corrects it (owner, 2026-10-05).
    case 'project.delete':
    case 'project.editCode':
    case 'clients.manage':
    case 'templates.manageAll':
    case 'report.office':
      return heldRights(actor).includes(action);
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
