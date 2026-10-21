import type { Meeting, OfficeRight, Task, User } from './contract/entities';
import { memberKey } from './rowKeys';
import { BASIC_ON, CATALOG_RIGHT_IDS, CATALOG_SECTIONS, DEFAULT_EXTRA, expandRights, type LegacyRightId } from './rightsCatalog';
import type { State } from './store';

/**
 * The actions that can() answers. Role rights version 2 (owner, 2026-10-21): one action for every power of the catalog
 * (rightsCatalog.ts), named like the power. A power with scopes (lead, team, all, office, none) asks the scope rule of scopeAllows.
 * The first block holds the old actions. They stay with today's meaning, computed from the new switches ("compat"): each one is
 * deleted when the last call site has moved to the new actions.
 */
export type Action =
  // The old actions (compat: delete after the call sites move). Some old names are also the name of a power: project.create,
  // project.archive, project.delete, task.take, task.help, task.review, chat.project, report.office, subCompanies.manage,
  // templates.updateProjects, feedback.manage, gaps.view. They follow the new switch.
  | 'project.view' | 'project.create' | 'project.edit' | 'project.changeLeader' | 'project.archive'
  | 'project.delete' | 'project.healthOverride' | 'project.editCode'
  | 'task.view' | 'task.createForAnyone' | 'task.createForSelf' | 'task.updateOwn' | 'task.contribute' | 'task.updateAny' | 'task.review' | 'task.delete'
  | 'task.take' | 'task.help' | 'meeting.view' | 'meeting.create' | 'meeting.edit' | 'meeting.minutes'
  | 'content.post' | 'content.editOwn' | 'chat.project' | 'comment.read'
  | 'event.undoAgent' | 'admin.manage' | 'people.manage' | 'payment.manage' | 'clients.manage' | 'templates.manageAll' | 'report.office'
  | 'project.editAny' | 'project.changeLeaderAny' | 'project.archiveAny' | 'task.reviewAny' | 'task.changeAny'
  | 'subCompanies.manage' | 'templates.updateProjects' | 'agents.undoAny' | 'feedback.manage' | 'gaps.view'
  // The new powers (one action for each power of the catalog that the old list did not name).
  | 'client.create' | 'project.details' | 'project.team' | 'project.stages' | 'project.deadlines' | 'project.template' | 'project.leader'
  | 'project.health' | 'project.code'
  | 'task.add' | 'task.assign' | 'task.work' | 'task.details' | 'task.dates' | 'task.deleteOwn' | 'task.any' | 'task.officeAll'
  | 'meeting.plan' | 'meeting.editOwn' | 'meeting.minutesOwn' | 'meeting.any' | 'meeting.minutesAny'
  | 'post.create' | 'comment.create' | 'post.editOwn' | 'project.links'
  | 'file.upload' | 'file.deliver' | 'file.share' | 'file.deleteOwn' | 'file.deleteAny'
  | 'chat.direct' | 'chat.groupCreate' | 'chat.groupChange'
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
 * word key: roles.sections.<key>.
 */
export const RIGHT_SECTIONS: readonly { readonly key: string; readonly rights: readonly OfficeRight[] }[] = CATALOG_SECTIONS.map((section) => ({
  key: section.key,
  rights: section.powers.flatMap((power) => power.switches.map((item) => item.id)),
}));

/** The 112 switches, in the order of the sections. The Admin holds every one of them. */
export const OFFICE_RIGHTS: readonly OfficeRight[] = CATALOG_RIGHT_IDS;

export { BASIC_ON, DEFAULT_EXTRA };

/**
 * The 17 old rights in their 7 old sections (role-rights, owner 2026-10-23). The role sheet of that time still reads them, and it
 * saves them as stored ids (StoredRight). The sheet track of role rights version 2 replaces that sheet, then these three constants go.
 */
export const LEGACY_RIGHT_SECTIONS: readonly { readonly key: string; readonly rights: readonly LegacyRightId[] }[] = [
  { key: 'projects', rights: ['project.editAny', 'project.changeLeaderAny', 'project.archiveAny', 'project.delete', 'project.editCode'] },
  { key: 'todos', rights: ['task.reviewAny', 'task.changeAny'] },
  { key: 'people', rights: ['people.manage', 'clients.manage', 'subCompanies.manage'] },
  { key: 'money', rights: ['payment.manage'] },
  { key: 'templates', rights: ['templates.manageAll', 'templates.updateProjects'] },
  { key: 'ai', rights: ['report.office', 'agents.undoAny'] },
  { key: 'office', rights: ['feedback.manage', 'gaps.view'] },
];
export const LEGACY_OFFICE_RIGHTS: readonly LegacyRightId[] = LEGACY_RIGHT_SECTIONS.flatMap((section) => section.rights);
/**
 * The old rights that a stored list holds, in the old order: an old right is on when every switch it stands for is in the list (an old
 * id or its new ids). The role sheet of before role rights version 2 reads a role this way. It goes with that sheet.
 */
export function legacyView(stored: readonly string[]): LegacyRightId[] {
  const held = expandRights(stored);
  return LEGACY_OFFICE_RIGHTS.filter((right) => expandRights([right]).every((id) => held.includes(id)));
}
export const LEGACY_DEFAULT_RIGHTS: Readonly<Record<'management' | 'accounting' | 'member', readonly LegacyRightId[]>> = {
  management: ['people.manage', 'payment.manage', 'report.office'],
  accounting: ['payment.manage'],
  member: [],
};

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

/** The powers behind a compat action that stands for many (compat: delete after the call sites move). */
const EDIT_POWERS = ['project.details', 'project.team', 'project.stages', 'project.deadlines', 'project.template', 'project.health'] as const;
const POST_POWERS = ['post.create', 'comment.create', 'project.links', 'file.upload', 'file.deliver', 'tracker.log'] as const;
const PEOPLE_SWITCHES = ['people.invite', 'people.change', 'people.teams', 'people.turnOff', 'people.remove'] as const;
const PAYMENT_SWITCHES = ['payment.view', 'payment.add', 'payment.change', 'payment.receive'] as const;

/** The actions that one switch of the same name answers, with no scope and no people rule. */
const SIMPLE: ReadonlySet<Action> = new Set<Action>([
  'project.create', 'client.create', 'task.assign', 'task.officeAll', 'file.share', 'chat.direct', 'chat.groupCreate', 'chat.groupChange',
  'tracker.reply', 'tracker.export', 'people.invite', 'people.change', 'people.teams', 'people.turnOff', 'people.remove', 'clients.change',
  'subCompanies.manage', 'payment.view', 'payment.add', 'payment.change', 'payment.receive', 'templates.projectCreate', 'templates.projectAny',
  'templates.taskAny', 'templates.updateProjects', 'dashboard.view', 'workload.view', 'search.use', 'gaps.view', 'report.office',
  'ai.connect', 'ai.readWork', 'ai.readChats', 'ai.todos', 'ai.posts', 'ai.messages', 'ai.meetings', 'ai.tracker', 'ai.projects',
  'ai.payments', 'ai.feedback', 'ai.report', 'ai.undo', 'feedback.send', 'feedback.manage', 'office.settings',
]);

/**
 * True when the resource describes a task: taskResource always names the maker of the task. A file or a Tracker entry of a project asks
 * task.delete with the project role alone, as a stand-in for "the leader or the Admin". The right to change any to-do must not open
 * those: it changes to-dos, and it does not delete the files or the Tracker entries of a project (role-rights, owner 2026-10-23).
 */
function describesTask(resource: Resource): boolean {
  return resource.makerId !== undefined;
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
  return can(viewer, 'task.view', taskResource(state, task, viewer.id));
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
    case 'task.createForSelf':
      return held('task.add.office');
    case 'task.createForAnyone':
      return held('task.add.office') && held('task.assign');
    case 'task.view':
    case 'comment.read':
      return sees;
    // compat: delete after the call sites move
    case 'content.post':
      return team('comment.create') && team('file.upload');
    case 'comment.create':
    case 'file.upload':
      return team(action);
    case 'task.contribute':
      return sees && held('task.work');
    case 'task.take':
    // A helper leaves an office task. Nobody joins one: its maker names its people (fbk_035, the call refuses a join).
    case 'task.help':
      return sees && held(action);
    case 'task.work':
    case 'task.details':
    case 'task.dates':
      return leads && held(action);
    // compat: delete after the call sites move
    case 'task.updateOwn':
      return leads && held('task.work') && held('task.details') && held('task.dates');
    // compat: delete after the call sites move
    case 'task.updateAny':
      return maker && held('task.assign');
    case 'task.review':
    case 'event.undoAgent':
    // The office has no switch for deleting a file of an office to-do: its maker does it, as today.
    case 'file.deleteAny':
      return maker;
    case 'task.deleteOwn':
    // compat: delete after the call sites move
    case 'task.delete':
      return maker && held('task.deleteOwn');
    case 'post.editOwn':
    case 'file.deleteOwn':
      return authored && held(action);
    // compat: delete after the call sites move
    case 'content.editOwn':
      return authored && held('post.editOwn') && held('file.deleteOwn');
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
  return { projectRole: projectRoleOf(state, meeting.projectId, viewerId), meeting: people };
}

/** The one view rule of a meeting: everyone sees a project meeting; a meeting with no project shows to its organizer and its attendees only. */
export function mayViewMeeting(state: State, viewer: User, meeting: MeetingPeople): boolean {
  return can(viewer, 'meeting.view', meetingResource(state, meeting, viewer.id));
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
      // compat: delete after the call sites move
      case 'meeting.create':
        return held('meeting.plan.none');
      case 'meeting.editOwn':
      // compat: delete after the call sites move
      case 'meeting.edit':
        return organizer && held('meeting.editOwn');
      case 'meeting.minutesOwn':
      // compat: delete after the call sites move
      case 'meeting.minutes':
        return attends && held('meeting.minutesOwn');
      default:
        return false;
    }
  }
  const role = resource.projectRole ?? 'other';
  const own = organizer && held('meeting.editOwn');
  const ownMinutes = attends && held('meeting.minutesOwn');
  switch (action) {
    case 'meeting.view':
      return true;
    case 'meeting.plan':
    // compat: delete after the call sites move
    case 'meeting.create':
      return scopeAllows(actor, 'meeting.plan', role);
    case 'meeting.editOwn':
      return own;
    case 'meeting.any':
      return scopeAllows(actor, 'meeting.any', role);
    // compat: delete after the call sites move
    case 'meeting.edit':
      return scopeAllows(actor, 'meeting.any', role) || own;
    case 'meeting.minutesOwn':
      return ownMinutes;
    case 'meeting.minutesAny':
      return scopeAllows(actor, 'meeting.minutesAny', role);
    // compat: delete after the call sites move
    case 'meeting.minutes':
      return scopeAllows(actor, 'meeting.minutesAny', role) || ownMinutes;
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
  if (!actor.active) return action === 'project.view' || (action === 'task.view' && !resource.office);
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
    case 'project.view':
    // Every person sees every project task (spec 2.3).
    case 'task.view':
    // Every active person reads task comments, as the project page shows them to non-members too. The Inbox task threads use the same rule.
    case 'comment.read':
      return true;
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
    case 'file.upload':
    case 'file.deliver':
    case 'tracker.log':
    case 'chat.project':
    case 'task.add':
      return scope(action);
    // compat: delete after the call sites move (the old names of powers with new names)
    case 'project.edit':
      return EDIT_POWERS.every((power) => scope(power));
    case 'project.changeLeader':
      return scope('project.leader');
    case 'project.healthOverride':
      return scope('project.health');
    case 'event.undoAgent':
      return scope('ai.undoOthers');
    case 'ai.undoOthers':
      return scope('ai.undoOthers');
    // The code is fixed after create. Only a person with the right corrects it (owner, 2026-10-05), and only where the details pass.
    case 'project.code':
      return held('project.code') && scope('project.details');
    // compat: delete after the call sites move. The code call also asks project.edit, so no scope here.
    case 'project.editCode':
      return held('project.code');
    // A team member adds a task for any team mate (owner, 2026-10-07). Only the leader and the Admin name a person outside the team.
    // compat: delete after the call sites move
    case 'task.createForSelf':
      return scope('task.add');
    case 'task.createForAnyone':
      return scope('task.add') && held('task.assign');
    // compat: delete after the call sites move
    case 'content.post':
      return POST_POWERS.every((power) => scope(power));
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
    // compat: delete after the call sites move
    case 'task.updateOwn':
      return anyTask || (own && held('task.work') && held('task.details') && held('task.dates'));
    // A helper ticks checklist items beside the lead. The lead, the maker, the leader and the Admin may do it too.
    case 'task.contribute':
      return anyTask || ((own || (onProject && (resource.helperIds ?? []).includes(actor.id))) && held('task.work'));
    // compat: delete after the call sites move
    case 'task.updateAny':
      return anyTask || (maker && held('task.assign'));
    // The lead deletes the task too, for a task that went into the wrong project. The call tells the maker (fbk_034, owner 2026-10-20).
    case 'task.deleteOwn':
      return own && held('task.deleteOwn');
    // compat: delete after the call sites move. A file or a Tracker entry asks this with the project role alone, as a stand-in for
    // "the leader or the Admin"; it asks the delete switches of the files and of the Tracker.
    case 'task.delete':
      return describesTask(resource)
        ? anyTask || (own && held('task.deleteOwn'))
        : scope('file.deleteAny') && scope('tracker.deleteAny');
    case 'post.editOwn':
    case 'file.deleteOwn':
    case 'tracker.deleteOwn':
      return authored && held(action);
    // compat: delete after the call sites move
    case 'content.editOwn':
      return authored && held('post.editOwn') && held('file.deleteOwn');
    // The office settings stay with the Admin.
    case 'admin.manage':
      return admin;
    // The old office rights, asked by their own name (compat: delete after the call sites move): does the person hold the right at all.
    case 'people.manage':
      return PEOPLE_SWITCHES.every(held);
    case 'payment.manage':
      return PAYMENT_SWITCHES.every(held);
    case 'clients.manage':
      return held('clients.change');
    case 'templates.manageAll':
      return held('templates.projectAny') && held('templates.taskAny') && held('templates.taskSave.all');
    case 'project.editAny':
      return EDIT_POWERS.every((power) => held(`${power}.all`));
    case 'project.changeLeaderAny':
      return held('project.leader.all');
    case 'project.archiveAny':
      return held('project.archive.all');
    case 'task.reviewAny':
      return held('task.review.all');
    case 'task.changeAny':
      return held('task.any.all');
    case 'agents.undoAny':
      return held('ai.undoOthers.all');
    default:
      return false;
  }
}
