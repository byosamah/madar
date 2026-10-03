import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { EventId, EventTarget, ProjectId, Stamp, type ChecklistItem, type Event, type FileRec, type Task, type TrackerEntry } from '../contract/entities';
import { EventLineView, EventView } from '../contract/views';
import { ApiError, forbidden, notFound } from '../errors';
import { DERIVED, FOLLOW_ON, NOT_UNDOABLE, undoEvent } from '../events';
import { assertMayFinish, reopenDependents, resyncStage, stageTag } from '../flow';
import { can, holdsAdminRights, principalOf, type Action, type Resource } from '../permissions';
import { eventLabel, eventViewOf, mayDeleteTracker } from '../views';
import { involves, onlyTicks } from '../../lib/taskPeople';
import { assertCan, roleIn, touch } from './shared';

type Fields = Record<string, unknown>;
const fieldsOf = (value: unknown): Fields => (value !== null && typeof value === 'object' ? (value as Fields) : {});

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
    const seesPayments = can(ctx.authority, 'payment.manage');
    // A bug report can be private, so only the Admin, who reads the reports, reads their events (audit 2026-10-03, API-12).
    const seesFeedback = can(ctx.authority, 'admin.manage');
    // The contract takes any time offset, so "since" compares times, not text (audit 2026-10-03, API-20).
    const since = input.since ? Date.parse(input.since) : null;
    return Object.values(ctx.state.events)
      .filter((e) => (seesPayments || e.targetType !== 'payment')
        && (seesFeedback || e.targetType !== 'feedback')
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

const ANY_TASK_FIELDS = ['ownerId', 'needsReview', 'helperIds'];

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

/** True when the event changed nothing but ticks: only the checklist, with the same items in the same order and the same texts. */
function isTickOnly(event: Event): boolean {
  const keys = Object.keys(fieldsOf(event.after));
  const before = fieldsOf(event.before).checklist;
  const after = fieldsOf(event.after).checklist;
  return keys.length === 1 && keys[0] === 'checklist' && Array.isArray(before) && Array.isArray(after)
    && onlyTicks(before as ChecklistItem[], after as ChecklistItem[]);
}

/** An undo is a new change: the person must have the right to make it now, under the same rules as the original call. */
function assertMayUndo(ctx: Ctx, event: Event): void {
  const projectRole = event.projectId ? roleIn(ctx, event.projectId) : 'other';
  const need = (action: Action, resource: Resource = {}) => assertCan(ctx, action, { projectRole, ...resource });
  const record = { ...fieldsOf(event.before), ...fieldsOf(event.after) };
  switch (event.targetType) {
    case 'project':
      if (event.verb === 'project.leader_changed') return need('project.changeLeader');
      // Deleting the cover file also clears the cover. Whoever may bring that file back may bring the cover back with it.
      if (event.verb === 'project.cover_changed' && coverComesBackWithFile(ctx, event)) return;
      if (event.verb === 'project.status_changed') return need('project.archive');
      if (event.verb.startsWith('project.health_')) return need('project.healthOverride');
      // A team member adds, edits and removes links, so they may take back their own link change (audit 2026-10-03, API-6).
      if (event.verb === 'project.updated' && Object.keys(fieldsOf(event.after)).every((key) => key === 'links')) return need('content.post');
      return need('project.edit');
    case 'member':
      need('project.edit');
      return assertMemberUndo(ctx, event);
    case 'stage':
    case 'deadline':
      return need('project.edit');
    case 'task': {
      // A reply task belongs to the Tracker entry it answers, so the people who may post there may take back its making and its finish.
      const replyTask = ctx.state.tasks[event.targetId]?.trackerEntryId;
      if (replyTask && (event.verb === 'task.created' || event.verb === 'task.status_changed')) return need('content.post');
      // The link of a reply task to its entry is part of the Tracker loop, so the people who may post there may bring it back (audit 2026-10-03, V-13).
      if (event.verb === 'task.reply_unlinked') return need('content.post');
      if (event.verb === 'task.created' || event.verb === 'task.deleted') return need('task.delete');
      if (event.verb === 'task.approved') return need('task.review');
      if (Object.keys(fieldsOf(event.after)).some((field) => ANY_TASK_FIELDS.includes(field))) return need('task.updateAny');
      const current = ctx.state.tasks[event.targetId];
      // A helper may take back a tick. Any other checklist change (an item added, removed, renamed or moved) follows the rule of the lead.
      if (isTickOnly(event)) return need('task.contribute', { ownerId: current?.ownerId, helperIds: current?.helperIds });
      return need('task.updateOwn', { ownerId: current?.ownerId });
    }
    case 'update':
    case 'comment': {
      // A person who may react may take back their own reaction (audit 2026-10-03, API-19).
      if (event.verb === 'comment.reacted') return need('content.post');
      const current = event.targetType === 'update' ? ctx.state.updates[event.targetId] : ctx.state.comments[event.targetId];
      const authorId = String(current?.authorId ?? record.authorId);
      return need('content.editOwn', { authorId: principalOf(ctx.state, authorId) });
    }
    case 'file': {
      const file = (ctx.state.files[event.targetId] ?? event.before) as FileRec | null;
      const uploader = file?.versions?.[0]?.uploadedBy ?? '';
      const allowed = can(ctx.authority, 'task.delete', { projectRole })
        || can(ctx.authority, 'content.editOwn', { projectRole, authorId: principalOf(ctx.state, uploader) });
      if (!allowed) throw forbidden('Only the uploader or the project leader can undo this.');
      return;
    }
    case 'tracker': {
      // Logging and deleting undo each other, so both follow the delete rule. Closing and editing follow the rule of posting.
      if (event.verb !== 'tracker.logged' && event.verb !== 'tracker.deleted') return need('content.post');
      const entry = (ctx.state.tracker?.[event.targetId] ?? event.before ?? event.after) as TrackerEntry;
      if (!mayDeleteTracker(ctx.state, ctx.authority, entry)) throw forbidden('Only the person who logged this, the project leader or the Admin can undo this.');
      return;
    }
    case 'payment':
      return need('payment.manage');
    case 'team':
      return need('people.manage');
    case 'stageTemplate': {
      // Undoing a save deletes the template, so every undo follows the delete rule: the person who saved it, or the Admin.
      if (event.verb === 'stageTemplate.created') need('project.create');
      const saved = (event.before ?? event.after) as { createdBy?: string } | null;
      if (ctx.authority.systemRole !== 'admin' && saved?.createdBy !== ctx.authority.id) throw forbidden('Only the person who saved it or the Admin can undo this.');
      return;
    }
    case 'taskTemplate': {
      // Undoing a save deletes the template, so every undo follows the delete rule: the person who saved it, or the Admin.
      const saved = (event.before ?? event.after) as { createdBy?: string } | null;
      if (ctx.authority.systemRole !== 'admin' && saved?.createdBy !== ctx.authority.id) throw forbidden('Only the person who saved it or the Admin can undo this.');
      return;
    }
    case 'client':
      return need(event.verb === 'client.created' ? 'project.create' : 'admin.manage');
    case 'user':
      if (event.verb === 'user.profile_changed' || event.verb === 'user.preferences_changed') {
        if (principalOf(ctx.state, event.targetId) !== ctx.authority.id) throw forbidden('You can undo changes to your own profile only.');
        return;
      }
      // Management may undo its own changes to people, but never a change that makes or touches an Admin.
      need('people.manage');
      if (ctx.authority.systemRole !== 'admin' && (record.systemRole === 'admin' || holdsAdminRights(ctx.state, ctx.state.users[event.targetId]))) {
        throw forbidden('Only an Admin can change an Admin or the agent of an Admin.');
      }
      return;
    default:
      return need('admin.manage');
  }
}

/** Who may undo this change at all: its own person (or their agent's), or the leader for an agent change. */
function assertUndoRight(ctx: Ctx, event: Event): void {
  // Your own changes and your agent's changes are yours to undo: the event names the person each acted for.
  const own = event.actingForId === ctx.authority.id;
  const agentChange = event.actorKind === 'agent' && event.projectId !== null
    && can(ctx.authority, 'event.undoAgent', { projectRole: roleIn(ctx, event.projectId) });
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
 * Undoes one event for the current person, under the rules of the original action.
 * A task that was done and opens again opens the done tasks that need it, on this path too.
 * "guard" is true for a single Undo: it may not finish a task whose prerequisite is open. A story brings every task back together, so it skips the guard.
 * "followOn" is true for a follow-on change in a story with the change that caused it: the person's right to that change covers it.
 */
function undoOne(ctx: Ctx, event: Event, guard: boolean, followOn = false): EventView {
  assertUndoRight(ctx, event);
  if (!followOn) assertMayUndo(ctx, event);
  const task = event.targetType === 'task' ? ctx.state.tasks[event.targetId] : undefined;
  const was = task?.status;
  if (guard && task && event.before !== null && event.after !== null) {
    const back = fieldsOf(event.before).status;
    if (back === 'done' || back === 'in_review') assertMayFinish(ctx.state, { ...task, status: String(back) as Task['status'] });
  }
  const undo = undoEvent(ctx, event.id);
  const now = event.targetType === 'task' ? ctx.state.tasks[event.targetId] : undefined;
  // The cause of these reopens is the Undo itself, which is never in a story, so a story Undo never relieves them (audit 2026-10-03, V-2).
  if (was === 'done' && now && now.status !== 'done') reopenDependents(ctx, now, undo.id);
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
    } catch {
      // A later change set the same fields. The tag still follows the tasks below.
    }
  }
  for (const projectId of new Set(events.map((event) => event.projectId))) if (projectId) resyncStage(ctx, projectId);
}

/** A story that is wholly taken back takes its notices with it, so no badge points at a change that did not happen (audit 2026-10-03, API-13). */
function dropNotices(ctx: Ctx, correlationId: string): void {
  const kept = Object.values(ctx.state.events).some((e) => e.correlationId === correlationId && e.verb !== 'undo' && !DERIVED.has(e.verb) && !e.undoneBy);
  if (kept) return;
  for (const [id, notice] of Object.entries(ctx.state.notifications)) if (notice.correlationId === correlationId) delete ctx.state.notifications[id];
}

export const eventsUndo = defineCall({
  input: z.object({ eventId: EventId }),
  output: EventView,
  run(input, ctx) {
    const event = ctx.state.events[input.eventId];
    if (!event) throw notFound('Event', input.eventId);
    const view = undoOne(ctx, event, true);
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
    const story = Object.values(ctx.state.events)
      .filter((e) => e.correlationId === input.correlationId && e.verb !== 'undo' && !DERIVED.has(e.verb))
      .sort((a, b) => b.seq - a.seq);
    if (story.length === 0) throw notFound('Story', input.correlationId);
    // A reopened task or a moved date rides on the change that caused it (audit 2026-10-03, API-1). The relief applies only
    // when the whole story is the person's own, and the cause still passes its full check (a refusal rolls the call back).
    // The cause must be a change of this story that this call takes back. A story ID comes from the caller, so a follow-on
    // change with its cause in another story, or with no cause, keeps its own rules (audit 2026-10-03, V-2).
    const mine = story.every((event) => event.actingForId === ctx.authority.id);
    const causes = new Set(story.filter((event) => !FOLLOW_ON.has(event.verb) && !event.undoneBy).map((event) => event.id));
    const relieved = (event: Event) => mine && FOLLOW_ON.has(event.verb) && event.causeEventId !== undefined && causes.has(event.causeEventId);
    const undone = story.map((event) => undoOne(ctx, event, false, relieved(event)));
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
