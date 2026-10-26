import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { EventId, EventTarget, ProjectId, Stamp, type ChecklistItem, type Event, type FileRec, type Meeting, type Notification, type Task, type TrackerEntry, type User } from '../contract/entities';
import { EventLineView, EventView } from '../contract/views';
import { ApiError, forbidden, notFound } from '../errors';
import { DERIVED, FOLLOW_ON, lastProjectCopy, lastTaskCopy, NOT_UNDOABLE, undoEvent } from '../events';
import { assertHasLead, assertMayFinish, reopenDependents, resyncStage, stageTag } from '../flow';
import { noticeProjectHidden } from '../hiddenNotice';
import { feedbackNoticeHidden } from '../notify';
import { eventProjectViewer } from '../projectView';
import { ensureRights, withRights } from '../rights';
import { can, holdsAdminRights, holdsRight, mayViewMeeting, mayViewProject, mayViewTask, meetingResource, principalOf, taskResource, type Action, type Resource } from '../permissions';
import { eventLabel, eventViewOf, mayDeleteTracker, officeResource } from '../views';
import { mayEditMeeting, mayWriteMinutes } from '../meetingGates';
import { isTaskMaker, mayAssignTask, mayChangePrerequisites, mayDeleteTask, mayTickChecklist } from '../taskGates';
import { involves, onlyTicks } from '../../lib/taskPeople';
import { isRoleEvent, undoRoleChange } from './roles';
import type { State } from '../store';
import { assertCan, roleIn, touch } from './shared';

type Fields = Record<string, unknown>;
const fieldsOf = (value: unknown): Fields => (value !== null && typeof value === 'object' ? (value as Fields) : {});

/** A template change is taken back by the person who saved the template, or by a person with the template right (owner, 2026-10-18). */
const mayUndoTemplate = (ctx: Ctx, createdBy: string | undefined, right: Action): boolean =>
  can(ctx.authority, right) || createdBy === ctx.authority.id;

/**
 * True when a change to a person sets a role: a systemRole or a custom role that the change moves (owner, 2026-10-18). A new person
 * with the Member role and no custom role sets no role.
 */
function changesRole(event: Event): boolean {
  if (event.verb === 'user.created') {
    const made = fieldsOf(event.after);
    return (made.systemRole ?? 'member') !== 'member' || Boolean(made.roleId);
  }
  const after = fieldsOf(event.after);
  return 'systemRole' in after || 'roleId' in after;
}

/**
 * The rights of a change of an office task, of its comments or of its files: the people of that task (owner, 2026-10-06). A list
 * reads the live task only, so the changes of a deleted office task show to the Admin alone. An Undo also reads the last copy of
 * a deleted task, so its maker may take the delete back.
 */
function officeOf(ctx: Ctx, event: Event, undo: boolean, viewer: User = ctx.authority): Resource {
  const id = event.officeTaskId!;
  const task = ctx.state.tasks[id] ?? (undo ? lastTaskCopy(ctx.state, id) : undefined);
  return task ? taskResource(ctx.state, task, viewer.id) : officeResource(ctx.state, null, viewer.id);
}

/** The last copy of a deleted meeting, from its newest delete event that stands. Undefined when no such event is in the state. */
function lastMeetingCopy(state: State, meetingId: string): Meeting | undefined {
  let found: Event | undefined;
  for (const event of Object.values(state.events)) {
    if (event.verb === 'meeting.deleted' && event.targetId === meetingId && !event.undoneBy && (!found || event.seq > found.seq)) found = event;
  }
  return found && found.before !== null && typeof found.before === 'object' ? (found.before as Meeting) : undefined;
}

/**
 * True when the person sees the change: every change but one of an office task that the person does not see. viewer: another
 * person than the one of the call, for example the owner of a notice.
 */
export function seesEvent(ctx: Ctx, event: Event, undo = false, viewer: User = ctx.authority): boolean {
  // A change of a meeting with no project shows to the people of that meeting only. The Admin has no extra view (owner, 2026-10-19).
  // A meeting that is gone shows its changes to nobody, so the History tells nothing of it. An Undo also reads the last copy of a
  // deleted meeting (meeting.deleted keeps it), so the people of that meeting take the delete back (owner, 2026-10-23).
  if (event.officeMeetingId) {
    const meeting = ctx.state.meetings?.[event.officeMeetingId] ?? (undo ? lastMeetingCopy(ctx.state, event.officeMeetingId) : undefined);
    return meeting !== undefined && mayViewMeeting(ctx.state, viewer, meeting);
  }
  // A change of a project follows the view of the project (hidden projects, owner 2026-10-22).
  if (event.projectId && !seesProjectEvent(ctx, event.projectId, viewer)) return false;
  return !event.officeTaskId || can(viewer, 'task.view', officeOf(ctx, event, undo, viewer));
}

/**
 * The view rule for the changes of one project: a project that the person sees shows its changes. A deleted project that was hidden
 * shows its changes only to the holders of "See hidden projects"; a deleted open project keeps the old rule (everyone). The copy of a
 * deleted project comes from its delete event, so a state that does not hold the event reads the project as open.
 */
function seesProjectEvent(ctx: Ctx, projectId: string, viewer: User): boolean {
  const project = ctx.state.projects[projectId];
  if (project) return mayViewProject(ctx.state, project, viewer);
  const copy = lastProjectCopy(ctx.state, projectId);
  return copy?.access?.hidden !== true || holdsRight(ensureRights(ctx.state, viewer), 'project.hidden');
}

export const eventsList = defineCall({
  input: z.object({
    projectId: ProjectId.optional(),
    targetType: EventTarget.optional(),
    targetId: z.string().optional(),
    correlationId: z.string().min(1).max(80).optional(),
    /** Only the events at or after this office-time stamp. */
    since: Stamp.optional(),
    limit: z.number().int().min(1).max(500).default(50),
  }),
  output: z.array(EventLineView),
  readOnly: true,
  run(input, ctx) {
    // A payment event holds an amount, so only the people who may handle payments ever read one.
    const seesPayments = can(ctx.authority, 'payment.view');
    // A bug report can be private, so only a person who reads the reports (feedback.manage) reads their events (audit 2026-10-03, API-12).
    const seesFeedback = can(ctx.authority, 'feedback.manage');
    // The contract takes any time offset, so "since" compares times, not text (audit 2026-10-03, API-20).
    const since = input.since ? Date.parse(input.since) : null;
    // A change of a project that the person does not see is not in the list, and the limit counts only the changes the person reads
    // (hidden projects, owner 2026-10-22). The change of a deleted hidden project shows to a holder of "See hidden projects" only.
    const seesProjectOf = eventProjectViewer(ctx.state, ctx.authority);
    return Object.values(ctx.state.events)
      .filter((e) => (seesPayments || e.targetType !== 'payment')
        && seesProjectOf(e)
        && (seesFeedback || e.targetType !== 'feedback')
        && seesEvent(ctx, e)
        && (!input.projectId || e.projectId === input.projectId)
        && (!input.targetType || e.targetType === input.targetType)
        && (!input.targetId || e.targetId === input.targetId)
        && (!input.correlationId || e.correlationId === input.correlationId)
        && (since === null || Date.parse(e.createdAt) >= since))
      .sort((a, b) => b.seq - a.seq)
      .slice(0, input.limit)
      .map((e) => ({ ...eventViewOf(ctx.state, e), ...eventLabel(ctx.state, e) }));
  },
});

/** Removing a member by undo follows the same rules as members.remove. */
function assertMemberUndo(ctx: Ctx, event: Event): void {
  if (event.before !== null) return;
  const userId = String(fieldsOf(event.after).userId);
  const project = event.projectId ? ctx.state.projects[event.projectId] : undefined;
  if (project?.leaderId === userId) throw new ApiError('conflict', 'This person now leads the project. Undo is not available.');
  const openTasks = Object.values(ctx.state.tasks).some((t) => t.projectId === event.projectId && involves(t, userId) && t.status !== 'done');
  if (openTasks) throw new ApiError('conflict', 'This person now has open tasks here. Undo is not available.');
}

/** The fields that the review switch and the assign switch guard. A change of only these fields asks no other switch. */
const ASSIGN_FIELDS = ['ownerId', 'helperIds'];
const ANY_TASK_FIELDS = ['ownerId', 'needsReview', 'helperIds', 'prerequisiteIds'];

/** The cover comes back with its file only for a person who may undo that file delete. */
function coverComesBackWithFile(ctx: Ctx, event: Event): boolean {
  const fileId = fieldsOf(event.before).coverFileId;
  if (typeof fileId !== 'string') return false;
  const deleted = Object.values(ctx.state.events).find((e) =>
    e.correlationId === event.correlationId && e.projectId === event.projectId && e.verb === 'file.deleted' && e.targetId === fileId);
  if (!deleted) return false;
  try {
    assertMayUndo(ctx, deleted);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the event is this person's own take of a task with no lead: made for them (by them or their agent), from no lead to
 * them, and with no other change than the taker leaving the helper list. A lead that the leader gave, or a change with other
 * fields, is not a take, so its Undo needs the leader's right (review 2026-10-05).
 */
function isOwnTake(ctx: Ctx, event: Event): boolean {
  const me = ctx.authority.id;
  const before = fieldsOf(event.before);
  const after = fieldsOf(event.after);
  if (event.verb !== 'task.reassigned' || event.actingForId !== me || before.ownerId !== null || after.ownerId !== me) return false;
  return Object.keys({ ...before, ...after }).every((key) => key === 'ownerId' || (key === 'helperIds'
    && Array.isArray(before.helperIds) && Array.isArray(after.helperIds)
    && JSON.stringify((before.helperIds as string[]).filter((id) => id !== me)) === JSON.stringify(after.helperIds)));
}

/** True when the event is the person's own join or leave as a helper (fbk_035): only the helper list changed, by that one person. */
function isOwnHelp(ctx: Ctx, event: Event): boolean {
  const me = ctx.authority.id;
  const before = fieldsOf(event.before);
  const after = fieldsOf(event.after);
  if (event.verb !== 'task.updated' || event.actingForId !== me) return false;
  if (Object.keys({ ...before, ...after }).some((key) => key !== 'helperIds')) return false;
  if (!Array.isArray(before.helperIds) || !Array.isArray(after.helperIds)) return false;
  const was = before.helperIds as string[];
  const now = JSON.stringify(after.helperIds);
  return now === JSON.stringify([...was, me]) || (was.includes(me) && now === JSON.stringify(was.filter((id) => id !== me)));
}

/** True when the event changed nothing but ticks: only the checklist, with the same items in the same order and the same texts. */
function isTickOnly(event: Event): boolean {
  const keys = Object.keys(fieldsOf(event.after));
  const before = fieldsOf(event.before).checklist;
  const after = fieldsOf(event.after).checklist;
  return keys.length === 1 && keys[0] === 'checklist' && Array.isArray(before) && Array.isArray(after)
    && onlyTicks(before as ChecklistItem[], after as ChecklistItem[]);
}

/** The rights on a project task for an Undo of its change: the live task, or the last copy of a deleted one. */
function projectTaskOf(ctx: Ctx, event: Event, projectRole: Resource['projectRole']): Resource {
  const task = ctx.state.tasks[event.targetId] ?? lastTaskCopy(ctx.state, event.targetId);
  return task ? taskResource(ctx.state, task, ctx.authority.id) : { projectRole };
}

/** The fields of a to-do that belong to the date switch, and to the work switch (role rights version 2). The rest belong to the details switch. */
const DATE_FIELDS = ['startDate', 'dueDate', 'schedule', 'durationDays', 'dateNotes'];
const WORK_FIELDS = ['status', 'completedAt', 'rank', 'version', 'versions'];

/**
 * True when the event is a change of the caller (or of the caller's own agent): the event names the caller as the person it acted for.
 * Only then may the Undo of a CREATE event use the create right (security review of role rights version 2). A create by another
 * person's agent, which the caller may undo through ai.undoOthers, needs the right that deletes the item directly.
 */
const isOwnChange = (ctx: Ctx, event: Event): boolean => event.actingForId === ctx.authority.id;

/** The project verbs of a pause, a finish and an archive: the power to pause, finish and archive (project.archive). */
const ARCHIVE_VERBS = new Set(['project.status_changed', 'project.paused', 'project.restart_moved', 'project.resumed']);

/**
 * An undo is a new change: the person must have the right to make it now, under the same rules as the original call. Role rights
 * version 2: each event asks the right of its own act, never the right of a neighbour (design section 6.5). The Undo of a new to-do
 * asks the right to add one, and the Undo of a delete asks the right to delete.
 */
function assertMayUndo(ctx: Ctx, event: Event): void {
  const projectRole = event.projectId ? roleIn(ctx, event.projectId) : 'other';
  // A change of an office task follows the rights of the people of that task (owner, 2026-10-06). A change of a project task
  // follows the rights on that task, so its maker takes back their own changes (owner, 2026-10-07).
  const base: Resource = event.officeTaskId ? officeOf(ctx, event, true) : event.targetType === 'task' ? projectTaskOf(ctx, event, projectRole) : { projectRole };
  const need = (action: Action, resource: Resource = {}) => assertCan(ctx, action, { ...base, ...resource });
  const record = { ...fieldsOf(event.before), ...fieldsOf(event.after) };
  switch (event.targetType) {
    case 'project':
      if (event.verb === 'project.leader_changed') return need('project.leader');
      if (event.verb === 'project.code_changed') return need('project.code');
      if (event.verb === 'project.access_changed') return need('project.access');
      // The folders of the Files & Links tab follow the upload right (fbk_066).
      if (event.verb === 'project.folders_changed') return need('file.upload');
      // Deleting the cover file also clears the cover. Whoever may bring that file back may bring the cover back with it.
      if (event.verb === 'project.cover_changed' && coverComesBackWithFile(ctx, event)) return;
      if (ARCHIVE_VERBS.has(event.verb)) return need('project.archive');
      if (event.verb.startsWith('project.health_')) return need('project.health');
      if (event.verb === 'project.template_linked') return need('project.template');
      // A team member adds, edits and removes links, so they may take back their own link change (audit 2026-10-03, API-6).
      if (event.verb === 'project.updated' && Object.keys(fieldsOf(event.after)).every((key) => key === 'links')) return need('project.links');
      return need('project.details');
    case 'member':
      need('project.team');
      return assertMemberUndo(ctx, event);
    case 'stage':
      return need('project.stages');
    case 'deadline':
      return need('project.deadlines');
    case 'task': {
      // A reply task belongs to the Tracker entry it answers, so the people who may post there may take back its making and its finish.
      const replyTask = ctx.state.tasks[event.targetId]?.trackerEntryId;
      if (replyTask && (event.verb === 'task.status_changed' || (event.verb === 'task.created' && isOwnChange(ctx, event)))) return need('tracker.log');
      // The link of a reply task to its entry is part of the Tracker loop, so the people who may post there may bring it back (audit 2026-10-03, V-13).
      if (event.verb === 'task.reply_unlinked') return need('tracker.log');
      // The Undo of a new to-do asks the right to add one. The Undo of a delete asks the right to delete (the lead's delete, or any).
      // A to-do of another person's agent (taken back through ai.undoOthers) needs the right that deletes it: task.any, or task.deleteOwn.
      if (event.verb === 'task.created') {
        if (isOwnChange(ctx, event)) return need('task.add');
        if (!mayDeleteTask(ctx.authority, base)) throw forbidden('You cannot do this.', { action: 'task.deleteOwn' });
        return;
      }
      if (event.verb === 'task.deleted') {
        if (can(ctx.authority, 'task.any', { ...base })) return;
        return need('task.deleteOwn');
      }
      if (event.verb === 'task.approved') return need('task.review');
      // The person who took a task with no lead may give it back (owner, 2026-10-05). Any other change of lead keeps the rule below.
      if (isOwnTake(ctx, event)) return need('task.take');
      // The person who joined a task as a helper, or left it, may take that back (fbk_035).
      if (isOwnHelp(ctx, event)) return need('task.help');
      if ('needsReview' in fieldsOf(event.after)) need('task.review');
      const current = ctx.state.tasks[event.targetId];
      const people = { ...base, ownerId: current?.ownerId, helperIds: current?.helperIds };
      const after = Object.keys(fieldsOf(event.after));
      // The lead and the helpers follow task.assign (the maker, or task.any). The waits keep their old rule: task.any, or the maker with task.details.
      if (after.some((field) => ASSIGN_FIELDS.includes(field)) && !mayAssignTask(ctx.authority, people)) throw forbidden('You cannot do this.', { action: 'task.assign' });
      if (after.includes('prerequisiteIds') && !mayChangePrerequisites(ctx.authority, people)) throw forbidden('You cannot do this.', { action: 'task.details' });
      if (after.length > 0 && after.every((field) => ANY_TASK_FIELDS.includes(field))) return;
      // A helper may take back a tick. Any other checklist change (an item added, removed, renamed or moved) follows the rule of the lead.
      if (isTickOnly(event)) {
        if (!mayTickChecklist(ctx.authority, people)) throw forbidden('You cannot do this.', { action: 'task.work' });
        return;
      }
      // Any change of a to-do (task.any) takes back every kind of change. The lead and the maker take back each kind with its own switch.
      const resource = { ownerId: current?.ownerId };
      if (after.includes('prerequisiteIds') && after.length === 1) return;
      if (can(ctx.authority, 'task.any', { ...base, ...resource })) return;
      const fields = Object.keys(fieldsOf(event.after));
      if (fields.some((field) => DATE_FIELDS.includes(field))) need('task.dates', resource);
      if (fields.some((field) => WORK_FIELDS.includes(field))) need('task.work', resource);
      if (fields.some((field) => !DATE_FIELDS.includes(field) && !WORK_FIELDS.includes(field)) || fields.length === 0) need('task.details', resource);
      return;
    }
    case 'update':
    case 'comment': {
      // A person who may react may take back their own reaction (audit 2026-10-03, API-19).
      if (event.verb === 'comment.reacted') return need('comment.create');
      // The Undo of a new post or comment asks the right to write one. The Undo of an edit or a delete asks the right to edit your own.
      // A post or a comment of another person's agent keeps the old rule: only its author takes it back.
      if (event.verb === 'update.posted' && isOwnChange(ctx, event)) return need('post.create');
      if (event.verb === 'comment.created' && isOwnChange(ctx, event)) return need('comment.create');
      const current = event.targetType === 'update' ? ctx.state.updates[event.targetId] : ctx.state.comments[event.targetId];
      const authorId = String(current?.authorId ?? record.authorId);
      return need('post.editOwn', { authorId: principalOf(ctx.state, authorId) });
    }
    case 'file': {
      const file = (ctx.state.files[event.targetId] ?? event.before) as FileRec | null;
      const uploader = file?.versions?.[0]?.uploadedBy ?? '';
      // The Undo of an upload asks the right to upload. The Undo of a delete asks the right to delete: any file, or your own.
      if (event.verb !== 'file.deleted' && isOwnChange(ctx, event)) return need('file.upload');
      const allowed = can(ctx.authority, 'file.deleteAny', base)
        || can(ctx.authority, 'file.deleteOwn', { ...base, authorId: principalOf(ctx.state, uploader) });
      if (!allowed) throw forbidden('Only the uploader or the project leader can undo this.');
      return;
    }
    case 'tracker': {
      // The minutes of a meeting (wave 2) are taken back by the people who write them now: the right to write the minutes of the meeting
      // of the line (the organizer, the attendees, and for a project meeting the leader and the Admin).
      if (event.verb === 'tracker.minutes_saved') {
        const entry = ctx.state.tracker?.[event.targetId];
        const meeting = entry?.meetingId ? ctx.state.meetings?.[entry.meetingId] : undefined;
        if (!meeting) throw forbidden('You cannot do this.', { action: 'meeting.minutesOwn' });
        if (!mayWriteMinutes(ctx.authority, meetingResource(ctx.state, meeting, ctx.authority.id))) throw forbidden('You cannot do this.', { action: 'meeting.minutesOwn' });
        return;
      }
      // Logging and deleting undo each other, so both follow the delete rule. Closing and editing follow the rule of logging.
      if (event.verb === 'tracker.reply_assigned') return need('tracker.reply');
      if (event.verb !== 'tracker.logged' && event.verb !== 'tracker.deleted') return need('tracker.log');
      const entry = (ctx.state.tracker?.[event.targetId] ?? event.before ?? event.after) as TrackerEntry;
      // The Undo of your own new entry asks the right to log. The line that Madar made for a meeting (auto 'meeting') has no author delete, so
      // its Undo never takes this way (security fix, 2026-10-19). An entry of another person's agent needs the right that deletes it.
      if (event.verb === 'tracker.logged' && isOwnChange(ctx, event) && entry.auto !== 'meeting') return need('tracker.log');
      if (!mayDeleteTracker(ctx.state, ctx.authority, entry)) throw forbidden('Only the person who logged this, the project leader or the Admin can undo this.');
      return;
    }
    case 'payment':
      // The Undo of a payment event asks the right of that change.
      return need(event.verb === 'payment.created' ? 'payment.add' : event.verb === 'payment.received' ? 'payment.receive' : 'payment.change');
    case 'team':
      return need('people.teams');
    case 'stageTemplate': {
      // Undoing a save deletes the template, so every undo follows the delete rule: the person who saved it (they made it with their own
      // switch), or the template right.
      const saved = (event.before ?? event.after) as { createdBy?: string } | null;
      if (!mayUndoTemplate(ctx, saved?.createdBy, 'templates.projectAny')) throw forbidden('Only the person who saved it, or a person with the template right, can undo this.');
      return;
    }
    case 'taskTemplate': {
      // Undoing a save deletes the template, so every undo follows the delete rule: the person who saved it, or the template right.
      const saved = (event.before ?? event.after) as { createdBy?: string } | null;
      if (!mayUndoTemplate(ctx, saved?.createdBy, 'templates.taskAny')) throw forbidden('Only the person who saved it, or a person with the template right, can undo this.');
      return;
    }
    case 'projectTemplate': {
      // Every undo of a project template follows the rule of a change: the person who saved it, or the template right. A change keeps
      // no author in its event, so the template itself names the author (owner, 2026-10-05, item 6a).
      const saved = (ctx.state.projectTemplates?.[event.targetId] ?? event.before ?? event.after) as { createdBy?: string } | null;
      if (!mayUndoTemplate(ctx, saved?.createdBy, 'templates.projectAny')) throw forbidden('Only the person who saved it, or a person with the template right, can undo this.');
      return;
    }
    case 'client':
      return need(event.verb === 'client.created' ? 'client.create' : 'clients.change');
    case 'user':
      if (event.verb === 'user.profile_changed' || event.verb === 'user.preferences_changed') {
        if (principalOf(ctx.state, event.targetId) !== ctx.authority.id) throw forbidden('You can undo changes to your own profile only.');
        // An email leaves the office, so an agent may not undo the person's change to where their email goes (review 2026-10-03).
        if (ctx.actor.kind === 'agent' && event.verb === 'user.preferences_changed' && changesEmail(event)) {
          throw forbidden('Only the person changes their email settings.', { action: 'notifications.email' });
        }
        return;
      }
      // An agent may not change, turn on or re-role a person (MCP deny list, users.update), so it may not undo such a change
      // either: an undo of an email change gives the sign-in email back to the old mailbox (security scan 2026-10-07, F1).
      if (ctx.actor.kind === 'agent') throw forbidden('Only a person undoes a change to people, in the Madar screens.');
      // Management may undo its own changes to people, but never a change that makes or touches an Admin, and never a change of a role.
      // Each event asks the people right of its own act (invite, change, turn off or on, remove).
      need(PEOPLE_VERB_RIGHT[event.verb] ?? 'people.change');
      if (ctx.authority.systemRole !== 'admin' && changesRole(event)) {
        throw forbidden('Only an Admin changes the role of a person.', { action: 'people.manage', reason: 'admin_only' });
      }
      if (ctx.authority.systemRole !== 'admin' && (record.systemRole === 'admin' || holdsAdminRights(ctx.state, ctx.state.users[event.targetId]))) {
        throw forbidden('Only an Admin can change an Admin or the agent of an Admin.');
      }
      return;
    case 'settings':
      // A role change lives in the office settings. An agent of the Admin holds the rights of the Admin.
      // It never changes a role, so it never takes one back (MCP deny list: roles.*, users.update).
      // The rule holds for events.undo and for events.undoStory, because both end here.
      if (isRoleEvent(event) && ctx.actor.kind === 'agent') {
        throw forbidden('Only the Admin changes a role, in the Madar screens.', { action: 'admin.manage', reason: 'admin_only' });
      }
      // A role event keeps the Admin only. A change of the office settings asks its own switch (role rights version 2).
      return need(isRoleEvent(event) ? 'admin.manage' : event.verb === 'settings.updated' ? 'office.settings' : 'admin.manage');
    case 'meeting': {
      // A change of a meeting is taken back by the people who may change that meeting now (fbk_022). The record is the live meeting,
      // or the whole meeting that a create event keeps.
      const meeting = ctx.state.meetings?.[event.targetId] ?? (event.after as Meeting | null) ?? (event.before as Meeting | null);
      if (!meeting) return need('admin.manage');
      // The minutes of a meeting with no line (wave 2) follow the right to write them, not the right to change the meeting.
      const resource = meetingResource(ctx.state, meeting, ctx.authority.id);
      if (event.verb === 'meeting.minutes_saved') {
        if (!mayWriteMinutes(ctx.authority, resource)) throw forbidden('You cannot do this.', { action: 'meeting.minutesOwn' });
        return;
      }
      // The Undo of your own new meeting asks the right to plan one. Any other change, and a meeting of another person's agent, asks the
      // right to change that meeting (meeting.editOwn or meeting.any).
      if ((event.verb === 'meeting.created' || event.verb === 'meeting.added') && isOwnChange(ctx, event)) return need('meeting.plan', resource);
      if (!mayEditMeeting(ctx.authority, resource)) throw forbidden('You cannot do this.', { action: 'meeting.editOwn' });
      return;
    }
    case 'subCompany':
      // An agent never makes, changes or deletes a sub-company (MCP deny list), so it never takes such a change back either:
      // an undo of a making deletes the sub-company, and an undo of a change brings an old logo back (INT-27). The agent of a person who
      // holds subCompanies.manage is refused too: the right opens the screens only.
      if (ctx.actor.kind === 'agent') throw forbidden('Only a person changes a sub-company, in the Madar screens.', { action: 'subCompanies.manage', reason: 'admin_only' });
      return need('subCompanies.manage');
    // A report change follows the right to manage reports, as the report calls do (role-rights, owner 2026-10-23).
    case 'feedback':
      return need('feedback.manage');
    default:
      return need('admin.manage');
  }
}

/** The people right of each event that a call on people writes (role rights version 2). Any other event of a person asks people.change. */
const PEOPLE_VERB_RIGHT: Readonly<Record<string, Action>> = {
  'user.created': 'people.invite',
  'user.updated': 'people.change',
  'user.deactivated': 'people.turnOff',
  'user.reactivated': 'people.turnOff',
  'user.removed': 'people.remove',
};

/**
 * True when a preferences change touched an email switch, the morning summary or the work hours (quiet hours decide when an email and a
 * push go; owner, 2026-10-22). A missing switch reads as its default.
 */
function changesEmail(event: Event): boolean {
  const prefs = (side: unknown) => (side as { preferences?: { email?: Record<string, boolean>; morningSummary?: boolean; workHours?: unknown } } | null)?.preferences;
  const before = prefs(event.before);
  const after = prefs(event.after);
  const triggers = new Set([...Object.keys(before?.email ?? {}), ...Object.keys(after?.email ?? {})]);
  return [...triggers].some((trigger) => before?.email?.[trigger] !== after?.email?.[trigger])
    || (before?.morningSummary ?? true) !== (after?.morningSummary ?? true)
    || JSON.stringify(before?.workHours ?? null) !== JSON.stringify(after?.workHours ?? null);
}

/** Who may undo this change at all: its own person (or their agent's), or the leader for an agent change. */
function assertUndoRight(ctx: Ctx, event: Event): void {
  // Your own changes and your agent's changes are yours to undo: the event names the person each acted for.
  const own = event.actingForId === ctx.authority.id;
  // The maker of an office task holds the leader's place there (owner, 2026-10-06).
  const agentChange = event.actorKind === 'agent' && (event.officeTaskId
    ? isTaskMaker(ctx.authority, officeOf(ctx, event, true))
    : event.projectId !== null && can(ctx.authority, 'ai.undoOthers', { projectRole: roleIn(ctx, event.projectId) }));
  if (!own && !agentChange) throw forbidden('You can undo changes by you or your agent, and agent changes on a project you lead.');
}

/** True when events.undo would accept this agent change from this person now. The feed shows Undo only then (spec 10.7). */
export function mayUndoAgentChange(ctx: Ctx, event: Event): boolean {
  if (event.actorKind !== 'agent' || event.undoneBy || NOT_UNDOABLE.has(event.verb)) return false;
  try {
    assertUndoRight(ctx, event);
    assertMayUndo(ctx, event);
    return true;
  } catch {
    return false;
  }
}

/**
 * The Undo of a task delete brings the task back. Its template part leaves the parts that the project dropped, so a later
 * template update may match the task again (fbk_008 item 4). A task with no part, or a project with no link, changes nothing.
 */
function takeBackTemplatePart(ctx: Ctx, taskId: string, projectId: string | null): void {
  const part = ctx.state.tasks[taskId]?.templatePartId;
  const project = projectId ? ctx.state.projects[projectId] : undefined;
  if (!part || !project?.templateLink) return;
  project.templateLink = { ...project.templateLink, droppedPartIds: project.templateLink.droppedPartIds.filter((id) => id !== part) };
}

/**
 * Undoes one event for the current person, under the rules of the original action.
 * A task that was done and opens again opens the done tasks that need it, on this path too.
 * "guard" is true for a single Undo: it may not finish a task whose prerequisite is open. A story brings every task back together, so it skips the guard.
 * "followOn" is true for a follow-on change in a story with the change that caused it: the person's right to that change covers it.
 */
/**
 * The Undo of a new folder takes the folder away, also when files were moved into it later (fbk_066). Those files go back to the root of their
 * stage, as when the folder is deleted, so no file keeps the id of a folder that is gone.
 */
function releaseFilesOfGoneFolders(ctx: Ctx, projectId: string): void {
  const alive = new Set((ctx.state.projects[projectId]?.folders ?? []).map((folder) => folder.id));
  for (const file of Object.values(ctx.state.files)) {
    if (file.projectId === projectId && file.folderId && !alive.has(file.folderId)) file.folderId = null;
  }
}

function undoOne(ctx: Ctx, event: Event, guard: boolean, followOn = false): EventView {
  // A change that the person does not see reads as missing, before any other rule (owner, 2026-10-06).
  if (!seesEvent(ctx, event, true)) throw notFound('Event', event.id);
  // The mark of a settled meeting is final: the next job run would settle the meeting again (fbk_022, wave 2). Every person who
  // sees the change gets the same answer.
  if (event.verb === 'meeting.settled') {
    throw new ApiError('conflict', 'Madar marked this meeting as over. This mark has no Undo.', { reason: 'settle_final' });
  }
  assertUndoRight(ctx, event);
  if (!followOn) assertMayUndo(ctx, event);
  const task = event.targetType === 'task' ? ctx.state.tasks[event.targetId] : undefined;
  const was = task?.status;
  if (guard && task && event.before !== null && event.after !== null) {
    const back = fieldsOf(event.before).status;
    if (back === 'done' || back === 'in_review') assertMayFinish(ctx.state, { ...task, status: String(back) as Task['status'] });
  }
  // A role change lives in the office settings, not in a collection, so its own Undo takes it back (handlers/roles.ts).
  const undo = isRoleEvent(event) ? undoRoleChange(ctx, event) : undoEvent(ctx, event.id);
  // rev is not in the event of a meeting. A change that comes back is a new copy for a calendar, so rev grows again (fbk_022).
  const meeting = event.targetType === 'meeting' ? ctx.state.meetings?.[event.targetId] : undefined;
  if (meeting && undo.after !== null) meeting.rev += 1;
  const now = event.targetType === 'task' ? ctx.state.tasks[event.targetId] : undefined;
  // The cause of these reopens is the Undo itself, which is never in a story, so a story Undo never relieves them (audit 2026-10-03, V-2).
  if (was === 'done' && now && now.status !== 'done') reopenDependents(ctx, now, undo.id);
  if (event.verb === 'task.deleted') takeBackTemplatePart(ctx, event.targetId, event.projectId);
  if (event.verb === 'project.folders_changed') releaseFilesOfGoneFolders(ctx, event.targetId);
  if (event.projectId && ctx.state.projects[event.projectId]) touch(ctx, event.projectId);
  return eventViewOf(ctx.state, undo);
}

/**
 * The stage tag follows the tasks, so after an Undo it moves with them. An Undo never asks why the project moves back.
 * When the tag leaves the stage where a stage move of the story put the project, that move is taken back too, so the health
 * override and the "moved back" note that it cleared come back (audit 2026-10-03, API-5).
 * The moves of one project form a chain, newest first: a move comes back while the saved stage is still where it put the project
 * and the tag is not there. So a story with two moves takes back both, one after the other (audit 2026-10-03, V-21).
 */
function settle(ctx: Ctx, events: Event[], correlationId: string): void {
  const moves = Object.values(ctx.state.events)
    .filter((e) => e.correlationId === correlationId && DERIVED.has(e.verb) && !e.undoneBy)
    .sort((a, b) => b.seq - a.seq);
  for (const move of moves) {
    // Only a stage move made for this person comes back this way. Any other move keeps its own rules.
    if (move.actingForId !== ctx.authority.id) continue;
    const to = fieldsOf(move.after).currentStageId;
    if (typeof to !== 'string' || ctx.state.projects[move.targetId]?.currentStageId !== to || stageTag(ctx.state, move.targetId)?.id === to) continue;
    try {
      undoEvent(ctx, move.id, { derived: true });
    } catch (error) {
      // A later change set the same fields, so the API refuses this one. The tag still follows the tasks below. Any other
      // error is a fault in the code, and it fails the call (review 2026-10-03).
      if (!(error instanceof ApiError)) throw error;
    }
  }
  for (const projectId of new Set(events.map((event) => event.projectId))) if (projectId) resyncStage(ctx, projectId);
}

/** An Undo never leaves a task in review or done with no lead (owner, 2026-10-05). The refusal rolls the whole call back. */
function assertFinishedHaveLead(ctx: Ctx, events: Event[]): void {
  for (const event of events) {
    const task = event.targetType === 'task' ? ctx.state.tasks[event.targetId] : undefined;
    if (task && (task.status === 'done' || task.status === 'in_review')) assertHasLead(task);
  }
}

/** True for a notice of an office task, live or deleted, that the person may not see: the rule of a gone notice (notifications.ts). */
function noticeTaskHidden(ctx: Ctx, targetType: string, targetId: string, person: User): boolean {
  if (targetType !== 'task') return false;
  const task = ctx.state.tasks[targetId] ?? lastTaskCopy(ctx.state, targetId);
  return task !== undefined && task.projectId === null && !mayViewTask(ctx.state, person, task);
}

/** True for a notice of a meeting with no project that the person may not see: the rule of a gone notice (notifications.ts). */
function noticeMeetingHidden(ctx: Ctx, targetType: string, targetId: string, person: User): boolean {
  if (targetType !== 'meeting') return false;
  const meeting = ctx.state.meetings?.[targetId];
  return meeting !== undefined && !mayViewMeeting(ctx.state, person, meeting);
}

/** The number of standing changes that moved this report from open to done. Each one sent the one done notice (owner, 2026-10-07). */
function movesToDone(standing: Event[], reportId: string): number {
  return standing.filter((e) => e.targetType === 'feedback' && e.targetId === reportId
    && fieldsOf(e.before).status === 'new' && fieldsOf(e.after).status === 'done').length;
}

/** Oldest first: by time, then by the number in the id, so ntf_1000 comes after ntf_999. */
const oldestFirst = (a: Notification, b: Notification) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id, 'en', { numeric: true });

/** A story that is wholly taken back takes its notices with it, so no badge points at a change that did not happen (audit 2026-10-03, API-13). */
function dropNotices(ctx: Ctx, correlationId: string): void {
  const standing = Object.values(ctx.state.events).filter((e) => e.correlationId === correlationId && e.verb !== 'undo' && !DERIVED.has(e.verb) && !e.undoneBy);
  // The done notices that each report may still keep. The oldest ones stay, so the notices of the moves that an Undo took back go.
  const doneRoom = new Map<string, number>();
  const notices = Object.values(ctx.state.notifications).filter((n) => n.correlationId === correlationId).sort(oldestFirst);
  // A notice stays only for a change of the story that its owner sees. A change of an office task that the owner does not see
  // never keeps it, so a kept notice tells nothing of that task (review 2026-10-06).
  for (const notice of notices) {
    const id = notice.id;
    // The owner comes with the office rights attached, so a holder of task.officeAll keeps the notice of an office to-do.
    const person = ctx.state.users[notice.userId];
    const owner = person === undefined ? undefined : withRights(ctx.state, person);
    // A notice of an office task that its owner no longer sees already reads as gone and names nothing. It stays, so an Undo never
    // changes the list or the count of a person who left the task (final check 3, review 2026-10-06).
    if (owner !== undefined && noticeTaskHidden(ctx, notice.targetType, notice.targetId, owner)) continue;
    // The same for the notice of a meeting that its owner no longer sees (a person taken off the attendees, fbk_022).
    if (owner !== undefined && noticeMeetingHidden(ctx, notice.targetType, notice.targetId, owner)) continue;
    // The same for the notice of an item of a project that its owner no longer sees (hidden projects, owner 2026-10-22).
    if (owner !== undefined && noticeProjectHidden(ctx.state, notice.targetType, notice.targetId, owner)) continue;
    // The same for the notice of a new report that a former Admin holds (owner, 2026-10-07).
    if (owner !== undefined && feedbackNoticeHidden(notice, owner)) continue;
    let kept: boolean;
    if (notice.targetType === 'feedback' && notice.trigger === 'feedback_done') {
      // A done notice stays only once for each move of its report from open to done that still stands in the story. So done, open,
      // done and then the Undo of the last done keeps one notice, as the report has one standing move to done (review 2026-10-07).
      const room = doneRoom.get(notice.targetId) ?? movesToDone(standing, notice.targetId);
      kept = room > 0;
      doneRoom.set(notice.targetId, kept ? room - 1 : 0);
    } else if (notice.targetType === 'feedback') {
      // A report notice stays only while a change of its own report stands, so the Undo of one done change in a story of three
      // takes back only the notice of that report (owner, 2026-10-07).
      kept = standing.some((e) => e.targetType === 'feedback' && e.targetId === notice.targetId);
    } else {
      kept = standing.some((e) => (!e.officeTaskId && !e.officeMeetingId) || (owner !== undefined && seesEvent(ctx, e, true, owner)));
    }
    if (!kept) delete ctx.state.notifications[id];
  }
}

export const eventsUndo = defineCall({
  input: z.object({ eventId: EventId }),
  output: EventView,
  run(input, ctx) {
    const event = ctx.state.events[input.eventId];
    if (!event) throw notFound('Event', input.eventId);
    const view = undoOne(ctx, event, true);
    assertFinishedHaveLead(ctx, [event]);
    settle(ctx, [event], event.correlationId);
    dropNotices(ctx, event.correlationId);
    return view;
  },
});

/** Undoes every change of one story, newest first. The Undo toast calls it with the story ID of its action. */
export const eventsUndoStory = defineCall({
  input: z.object({ correlationId: z.string().min(1).max(80) }),
  output: z.object({ undone: z.array(EventView) }),
  run(input, ctx) {
    // A change that the person does not see is left out first, so the person takes back only what they see, and the answer is the
    // answer of that part alone. A story with no change the person sees reads as a missing story (review 2026-10-06).
    const all = Object.values(ctx.state.events)
      .filter((e) => e.correlationId === input.correlationId && e.verb !== 'undo' && !DERIVED.has(e.verb) && seesEvent(ctx, e, true));
    if (all.length === 0) throw notFound('Story', input.correlationId);
    // A change of the story that was undone on its own stays undone. The rest of the story comes back (review 2026-10-03).
    const story = all.filter((e) => !e.undoneBy).sort((a, b) => b.seq - a.seq);
    if (story.length === 0) throw new ApiError('conflict', 'This change is already undone.');
    // A reopened task or a moved date rides on the change that caused it (audit 2026-10-03, API-1). The relief applies only
    // when the whole story is the person's own, and the cause still passes its full check (a refusal rolls the call back).
    // The cause must be a change of this story that this call takes back. A story ID comes from the caller, so a follow-on
    // change with its cause in another story, or with no cause, keeps its own rules (audit 2026-10-03, V-2).
    const mine = story.every((event) => event.actingForId === ctx.authority.id);
    const causes = new Set(story.filter((event) => !FOLLOW_ON.has(event.verb)).map((event) => event.id));
    const relieved = (event: Event) => mine && FOLLOW_ON.has(event.verb) && event.causeEventId !== undefined && causes.has(event.causeEventId);
    const was = new Map(story.flatMap((event) => {
      const task = event.targetType === 'task' ? ctx.state.tasks[event.targetId] : undefined;
      return task ? [[task.id, task.status] as const] : [];
    }));
    // The stage moves of this story come back first. A stage that the story created still holds the project tag, so its own Undo
    // would find that stage in use. A move that the Undo refuses stays, and settle() then resyncs the tag.
    const moves = Object.values(ctx.state.events)
      .filter((e) => e.correlationId === input.correlationId && DERIVED.has(e.verb) && !e.undoneBy && e.actingForId === ctx.authority.id)
      .sort((a, b) => b.seq - a.seq);
    for (const move of moves) {
      try {
        undoEvent(ctx, move.id, { derived: true });
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
      }
    }
    const undone = story.map((event) => undoOne(ctx, event, false, relieved(event)));
    // The story skips the finish check for each task, because its tasks come back together. When the story is done, a task that
    // it brought back to Done or In review must have no open prerequisite. Else the call fails and nothing changes (audit 2026-10-03, V-2).
    for (const [id, status] of was) {
      const task = ctx.state.tasks[id];
      if (task && task.status !== status && (task.status === 'done' || task.status === 'in_review')) assertMayFinish(ctx.state, task);
    }
    assertFinishedHaveLead(ctx, story);
    settle(ctx, story, input.correlationId);
    dropNotices(ctx, input.correlationId);
    return { undone };
  },
});

export const historyCalls = {
  'events.list': eventsList,
  'events.undo': eventsUndo,
  'events.undoStory': eventsUndoStory,
};
