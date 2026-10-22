import type { Meeting, OfficeRight, Project, Task, User } from './contract/entities';
import { memberKey } from './rowKeys';
import { ensureRights } from './rights';
import { BASIC_ON, CATALOG_RIGHT_IDS, CATALOG_SECTIONS, DEFAULT_EXTRA } from './rightsCatalog';
import type { State } from './store';

/**
 * The actions that can() answers. Role rights version 2 (owner, 2026-10-21): one action for every power of the catalog
 * (rightsCatalog.ts), named like the power. A power with scopes (lead, team, all, office, none) asks the scope rule of scopeAllows.
 * The first block holds the old names that are also the name of a power. The stand-ins that covered many powers are gone: every call
 * site asks the action of its own power (role rights version 2, screens track).
 */
export type Action =
  // The old names that are also the name of a power. They follow the switch of the same name: project.create, project.archive,
  // project.delete, task.take, task.help, task.review, chat.project, report.office, subCompanies.manage, templates.updateProjects,
  // feedback.manage, gaps.view.
  | 'project.view' | 'project.create' | 'project.archive' | 'project.delete'
  | 'task.view' | 'task.review' | 'task.take' | 'task.help' | 'meeting.view' | 'chat.project' | 'comment.read'
  | 'admin.manage' | 'report.office' | 'subCompanies.manage' | 'templates.updateProjects' | 'feedback.manage' | 'gaps.view'
  // The powers of the catalog (one action for each power that the old list did not name).
  | 'client.create' | 'project.details' | 'project.team' | 'project.stages' | 'project.deadlines' | 'project.template' | 'project.leader'
  | 'project.health' | 'project.code'
  // Hidden projects (owner, 2026-10-22): see every open project, choose who sees a project (a scope power), see the hidden projects.
  | 'project.seeAll' | 'project.access' | 'project.hidden'
  | 'task.add' | 'task.assign' | 'task.work' | 'task.details' | 'task.dates' | 'task.deleteOwn' | 'task.any' | 'task.officeAll'
  | 'meeting.plan' | 'meeting.editOwn' | 'meeting.minutesOwn' | 'meeting.any' | 'meeting.minutesAny'
  | 'post.create' | 'comment.create' | 'post.editOwn' | 'project.links'
  | 'file.upload' | 'file.deliver' | 'file.share' | 'file.deleteOwn' | 'file.deleteAny'
  | 'chat.direct' | 'chat.groupCreate' | 'chat.groupChange' | 'chat.mentionEveryone'
  | 'tracker.log' | 'tracker.reply' | 'tracker.export' | 'tracker.deleteOwn' | 'tracker.deleteAny'
  | 'people.invite' | 'people.change' | 'people.teams' | 'people.turnOff' | 'people.remove' | 'clients.change'
  | 'payment.view' | 'payment.add' | 'payment.change' | 'payment.receive'
  | 'templates.projectCreate' | 'templates.projectAny' | 'templates.taskSave' | 'templates.taskAny'
  | 'dashboard.view' | 'workload.view' | 'search.use'
  | 'ai.connect' | 'ai.readWork' | 'ai.readChats' | 'ai.todos' | 'ai.posts' | 'ai.messages' | 'ai.meetings' | 'ai.tracker' | 'ai.projects'
  | 'ai.payments' | 'ai.feedback' | 'ai.report' | 'ai.undo' | 'ai.undoOthers'
  | 'feedback.send' | 'office.settings';

export type ProjectRole = 'leader' | 'team' | 'other';

/**
 * The switches in their 13 sections, in the order of the role sheet (rightsCatalog.ts). The key of a section is the last part of its
 * word key: roleRights.sections.<key>.
 */
export const RIGHT_SECTIONS: readonly { readonly key: string; readonly rights: readonly OfficeRight[] }[] = CATALOG_SECTIONS.map((section) => ({
  key: section.key,
  rights: section.powers.flatMap((power) => power.switches.map((item) => item.id)),
}));

/** The 117 switches, in the order of the sections. The Admin holds every one of them. */
export const OFFICE_RIGHTS: readonly OfficeRight[] = CATALOG_RIGHT_IDS;

export { BASIC_ON, DEFAULT_EXTRA };

/** A person as can() reads it: the user, plus the office rights that the office settings give the person (rights.ts). */
export type Actor = User & { readonly officeRights?: readonly OfficeRight[] };

const ALL_SET: ReadonlySet<string> = new Set(CATALOG_RIGHT_IDS);
const NONE_SET: ReadonlySet<string> = new Set();
const heldSets = new WeakMap<readonly OfficeRight[], ReadonlySet<string>>();

/**
 * The switches of an actor as a set. The Admin holds all of them. Any other person holds the attached rights only. A person with no
 * attached rights holds none, so a path that forgot to attach them fails closed. Without this rule, the Admin could take a right
 * from Management and a forgotten path would still give the default (security review 2026-10-18).
 */
function heldSet(actor: Actor): ReadonlySet<string> {
  if (actor.systemRole === 'admin') return ALL_SET;
  const list = actor.officeRights;
  if (!list) return NONE_SET;
  let set = heldSets.get(list);
  if (!set) heldSets.set(list, (set = new Set(list)));
  return set;
}

/** True when the actor holds the switch. The Admin holds all of them. */
export function holdsRight(actor: Actor, id: string): boolean {
  return heldSet(actor).has(id);
}

/**
 * The scope rule of a power with scopes, on a project (design section 3): hold `<power>.all`, or hold `<power>.lead` and lead the
 * project, or hold `<power>.team` and be on the team (the leader counts as on the team). A power that lacks a scope has no such
 * switch, and the scope never passes. The Admin holds every `.all`.
 */
export function scopeAllows(actor: Actor, power: string, role: ProjectRole): boolean {
  const held = heldSet(actor);
  if (held.has(`${power}.all`)) return true;
  if (role === 'leader') return held.has(`${power}.lead`) || held.has(`${power}.team`);
  if (role === 'team') return held.has(`${power}.team`);
  return false;
}

/** The actions that one switch of the same name answers, with no scope and no people rule. */
const SIMPLE: ReadonlySet<Action> = new Set<Action>([
  'project.create', 'client.create', 'project.seeAll', 'project.hidden', 'task.assign', 'task.officeAll', 'file.share', 'chat.direct', 'chat.groupCreate', 'chat.groupChange', 'chat.mentionEveryone',
  'tracker.reply', 'tracker.export', 'people.invite', 'people.change', 'people.teams', 'people.turnOff', 'people.remove', 'clients.change',
  'subCompanies.manage', 'payment.view', 'payment.add', 'payment.change', 'payment.receive', 'templates.projectCreate', 'templates.projectAny',
  'templates.taskAny', 'templates.updateProjects', 'dashboard.view', 'workload.view', 'search.use', 'gaps.view', 'report.office',
  'ai.connect', 'ai.readWork', 'ai.readChats', 'ai.todos', 'ai.posts', 'ai.messages', 'ai.meetings', 'ai.tracker', 'ai.projects',
  'ai.payments', 'ai.feedback', 'ai.report', 'ai.undo', 'feedback.send', 'feedback.manage', 'office.settings',
]);

/**
 * ownerId is the lead of a task. Null: the task has no lead, so nobody holds the rights of its lead.
 * office: the resource is an office task (or its comment or file), which belongs to no project. makerId is the person who made the
 * task: for a task an agent made, the person the agent acts for (owner, 2026-10-06). A project task names its maker too (2026-10-07).
 */
export type Resource = {
  projectRole?: ProjectRole; ownerId?: string | null; helperIds?: string[]; authorId?: string; targetUserId?: string;
  office?: boolean; makerId?: string;
  /**
   * The facts of the project that its view rule reads (hidden projects, owner 2026-10-22): hidden is true for a project kept for its team,
   * chosen is true when the viewer is in its list of chosen people. A resource with a projectRole and no access reads as an open project.
   */
  access?: ProjectAccessFacts;
  /**
   * A meeting (fbk_022). organizerId is the person behind the organizer (an agent organizer is its person). noProject: the meeting has
   * no project, so only its organizer and its attendees read it, the Admin too only as an attendee (owner, 2026-10-19). A project
   * meeting reads like its project and carries projectRole.
   */
  meeting?: { organizerId: string; attendeeIds: readonly string[]; noProject: boolean };
};

/** What the view rule of a project reads about the project and the viewer (hidden projects, owner 2026-10-22). */
export type ProjectAccessFacts = { readonly hidden: boolean; readonly chosen: boolean };

export function projectAccessOf(project: Pick<Project, 'access'> | undefined, viewerId: string): ProjectAccessFacts {
  return { hidden: project?.access?.hidden === true, chosen: project?.access?.viewerIds.includes(viewerId) === true };
}

export function projectRoleOf(state: Pick<State, 'projects' | 'members'>, projectId: string | null, userId: string): ProjectRole {
  if (projectId === null) return 'other';
  const project = state.projects[projectId];
  if (!project) return 'other';
  if (project.leaderId === userId) return 'leader';
  return state.members[memberKey(projectId, userId)] ? 'team' : 'other';
}

/** The resource of a project for the rules of one person: their role in it, and the facts that its view rule reads. */
export function projectResource(state: Pick<State, 'projects' | 'members'>, projectId: string | null, viewerId: string): Resource {
  if (projectId === null) return { projectRole: 'other' };
  return { projectRole: projectRoleOf(state, projectId, viewerId), access: projectAccessOf(state.projects[projectId], viewerId) };
}

/**
 * The one view rule of a project (hidden projects, owner 2026-10-22): true for a holder of "See hidden projects", for the leader, a team
 * member or a chosen person, and for a holder of "See every project" when the project is open. A project that this rule hides answers
 * every call as a missing project (requireProject). The viewer carries the office rights (ensureRights does it here).
 */
export function mayViewProject(state: State, project: Pick<Project, 'id' | 'access'>, viewer: User): boolean {
  return can(ensureRights(state, viewer), 'project.view', projectResource(state, project.id, viewer.id));
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
  return { ...projectResource(state, task.projectId, viewerId), makerId, ...people };
}

/** The fields of an event side as a plain record. */
const sideOf = (side: unknown): Record<string, unknown> => (side && typeof side === 'object' ? side as Record<string, unknown> : {});

/**
 * True when the lead of a task got it with their own take of a task with no lead (tasks.take): the newest change of its lead that
 * still stands is the lead's own take. Such a lead does not delete the task, so a take never opens a delete (fbk_034, security
 * review 2026-10-20). It reads the history of the task, which the server loads with the task (taskTail).
 */
export function leadTookTask(state: State, task: Pick<Task, 'id' | 'ownerId'>): boolean {
  if (task.ownerId === null) return false;
  let newest: State['events'][string] | undefined;
  for (const event of Object.values(state.events)) {
    if (event.targetType !== 'task' || event.targetId !== task.id || event.undoneBy || !('ownerId' in sideOf(event.after))) continue;
    if (!newest || event.seq > newest.seq) newest = event;
  }
  if (!newest || newest.verb !== 'task.reassigned' || newest.actingForId !== task.ownerId) return false;
  return (sideOf(newest.before).ownerId ?? null) === null && sideOf(newest.after).ownerId === task.ownerId;
}

/** The one view rule of a task: everyone sees a project task; an office task shows to its maker, lead, helpers and the Admin. */
export function mayViewTask(state: State, viewer: User, task: TaskPeople): boolean {
  return can(ensureRights(state, viewer), 'task.view', taskResource(state, task, viewer.id));
}


/**
 * The view rule of a project as can() reads it (hidden projects, owner 2026-10-22). The facts come from projectResource: the role of the
 * person and, for a hidden project, the list of chosen people. A holder of "See hidden projects" sees every project. The leader, the team and
 * a chosen person see their project. Any other person needs "See every project" and an open project. A resource with neither a role nor
 * access facts names no project, so the plain question "may this person read" answers true.
 */
function viewsProject(actor: Actor, resource: Resource): boolean {
  if (resource.projectRole === undefined && resource.access === undefined) return true;
  const role = resource.projectRole ?? 'other';
  if (holdsRight(actor, 'project.hidden') || role === 'leader' || role === 'team' || resource.access?.chosen === true) return true;
  return resource.access?.hidden !== true && holdsRight(actor, 'project.seeAll');
}

/**
 * The rules of an office task (owner, 2026-10-06). Its maker holds the rights a project leader holds on a project task: the lead,
 * the helpers, the review need, the review and the delete. Its lead changes and finishes it. A helper ticks. Every person who sees
 * it comments on it and takes it when it has no lead. Anyone makes an office task, for themselves or for anyone.
 * Role rights version 2: each of these powers also needs its switch. The person who holds task.officeAll (the Admin by default) holds
 * the place of the maker on every office to-do. The people of an office to-do count as the team for the team switches (comment, upload).
 */
function canOnOfficeTask(actor: Actor, action: Action, resource: Resource): boolean {
  const held = (id: string) => holdsRight(actor, id);
  const maker = held('task.officeAll') || resource.makerId === actor.id;
  const leads = maker || (resource.ownerId !== undefined && resource.ownerId === actor.id);
  const sees = leads || (resource.helperIds ?? []).includes(actor.id);
  const team = (power: string) => sees && scopeAllows(actor, power, 'team');
  const authored = sees && resource.authorId === actor.id;
  switch (action) {
    case 'task.add':
      return held('task.add.office');
    case 'task.view':
    case 'comment.read':
      return sees;
    case 'comment.create':
    case 'file.upload':
      return team(action);
    case 'task.take':
    // A helper leaves an office task. Nobody joins one: its maker names its people (fbk_035, the call refuses a join).
    case 'task.help':
      return sees && held(action);
    case 'task.work':
    case 'task.details':
    case 'task.dates':
      return leads && held(action);
    case 'task.review':
    // The office has no switch for deleting a file of an office to-do: its maker does it, as today.
    case 'file.deleteAny':
      return maker;
    case 'task.deleteOwn':
      return maker && held('task.deleteOwn');
    case 'post.editOwn':
    case 'file.deleteOwn':
      return authored && held(action);
    case 'task.officeAll':
    case 'task.assign':
    case 'file.share':
      return held(action);
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
  return { ...projectResource(state, meeting.projectId, viewerId), meeting: people };
}

/** The one view rule of a meeting: everyone sees a project meeting; a meeting with no project shows to its organizer and its attendees only. */
export function mayViewMeeting(state: State, viewer: User, meeting: MeetingPeople): boolean {
  return can(ensureRights(state, viewer), 'meeting.view', meetingResource(state, meeting, viewer.id));
}

/**
 * The rules of a meeting (fbk_022, owner 2026-10-19). A project meeting is read by everyone. A person plans one with the switch of the
 * team (or every project), the organizer changes it with the switch of the own meetings, and the leader (or every project) changes
 * any project meeting with the switch of the any meetings. A meeting with no project is planned with the none switch, read by its
 * organizer and its attendees, and changed by its organizer. The Admin has no extra right there.
 * The minutes (wave 2): the organizer and the attendees write them with the switch of the own minutes. For a project meeting the leader
 * and the Admin may too (the switch of the any minutes), because the minutes join the project record that the leader answers for. A
 * team member who did not attend only reads them.
 */
function canOnMeeting(actor: Actor, action: Action, resource: Resource): boolean {
  const people = resource.meeting!;
  const held = (id: string) => holdsRight(actor, id);
  const organizer = people.organizerId === actor.id;
  const attends = organizer || people.attendeeIds.includes(actor.id);
  if (people.noProject) {
    switch (action) {
      case 'meeting.view':
        return attends;
      case 'meeting.plan':
        return held('meeting.plan.none');
      case 'meeting.editOwn':
        return organizer && held('meeting.editOwn');
      case 'meeting.minutesOwn':
        return attends && held('meeting.minutesOwn');
      default:
        return false;
    }
  }
  const role = resource.projectRole ?? 'other';
  const own = organizer && held('meeting.editOwn');
  const ownMinutes = attends && held('meeting.minutesOwn');
  switch (action) {
    // A project meeting reads like its project: a person who does not see the project does not see the meeting (hidden projects).
    case 'meeting.view':
      return viewsProject(actor, resource);
    case 'meeting.plan':
      return scopeAllows(actor, 'meeting.plan', role);
    case 'meeting.editOwn':
      return own;
    case 'meeting.any':
      return scopeAllows(actor, 'meeting.any', role);
    case 'meeting.minutesOwn':
      return ownMinutes;
    case 'meeting.minutesAny':
      return scopeAllows(actor, 'meeting.minutesAny', role);
    default:
      return false;
  }
}

/** True when the actor reviews the to-dos of a project in which they have this role: the Admin, a person with every project, a leader with the lead switch. */
export function canReview(actor: Actor, role: ProjectRole): boolean {
  return can(actor, 'task.review', { projectRole: role });
}

/** The permission table from spec section 2.3. No screen checks permissions in another way. */
export function can(actor: Actor, action: Action, resource: Resource = {}): boolean {
  // A person who left the office reads and changes no meeting.
  if (resource.meeting) return actor.active && canOnMeeting(actor, action, resource);
  // A project task reads like its project. An office task stays with its people.
  // A hidden project never shows to a person who left the office (owner, 2026-10-22).
  if (!actor.active) return !resource.access?.hidden && (action === 'project.view' || (action === 'task.view' && !resource.office));
  if (resource.office) return canOnOfficeTask(actor, action, resource);
  const admin = actor.systemRole === 'admin';
  const role = resource.projectRole ?? 'other';
  const onProject = admin || role === 'leader' || role === 'team';
  const held = (id: string) => holdsRight(actor, id);
  const scope = (power: string) => scopeAllows(actor, power, role);
  // The person who added a task holds the leader's rights on it while on the team: the lead, the helpers, the prerequisites, the
  // changes and the delete. The review stays with the leader (owner, 2026-10-07). The leader holds every change through task.any.lead.
  const anyTask = scope('task.any');
  const maker = onProject && resource.makerId !== undefined && resource.makerId === actor.id;
  const lead = onProject && resource.ownerId === actor.id;
  const own = maker || lead;
  const authored = onProject && resource.authorId === actor.id;
  if (SIMPLE.has(action)) return held(action);
  switch (action) {
    // A project task and its comments read like their project (hidden projects, owner 2026-10-22). The Inbox task threads use the same rule.
    // A resource with no project facts is the plain question "may this person read at all", and answers true.
    case 'project.view':
    case 'task.view':
    case 'comment.read':
      return viewsProject(actor, resource);
    // The powers of a project: the leader, or a person with the all switch. Each power opens its own action and no other.
    case 'project.details':
    case 'project.team':
    case 'project.stages':
    case 'project.deadlines':
    case 'project.template':
    case 'project.archive':
    case 'project.leader':
    case 'project.health':
    case 'project.delete':
    case 'task.any':
    case 'task.review':
    case 'file.deleteAny':
    case 'tracker.deleteAny':
    case 'templates.taskSave':
    case 'post.create':
    case 'comment.create':
    case 'project.links':
    case 'project.access':
    case 'file.upload':
    case 'file.deliver':
    case 'tracker.log':
    case 'chat.project':
    case 'task.add':
      return scope(action);
    case 'ai.undoOthers':
      return scope('ai.undoOthers');
    // The code is fixed after create. Only a person with the right corrects it (owner, 2026-10-05), and only where the details pass.
    case 'project.code':
      return held('project.code') && scope('project.details');
    // A person on the team takes the lead of a task with no lead (owner, 2026-10-05). The call checks that the task has none.
    case 'task.take':
    // A person on the team joins a task as a helper, or leaves it, with one tap (fbk_035, owner 2026-10-20).
    case 'task.help':
      return onProject && held(action);
    // The lead and the maker work on their own to-dos with the switch of each kind of change. The Admin and the leader use task.any.
    case 'task.work':
    case 'task.details':
    case 'task.dates':
      return own && held(action);
    // The lead deletes the task too, for a task that went into the wrong project. The call tells the maker (fbk_034, owner 2026-10-20).
    case 'task.deleteOwn':
      return own && held('task.deleteOwn');
    case 'post.editOwn':
    case 'file.deleteOwn':
    case 'tracker.deleteOwn':
      return authored && held(action);
    // The office settings stay with the Admin.
    case 'admin.manage':
      return admin;
    default:
      return false;
  }
}
