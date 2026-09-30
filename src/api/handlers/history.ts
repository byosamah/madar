import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { EventId, EventTarget, ProjectId, type Event, type FileRec, type TimeEntry } from '../contract/entities';
import { EventView } from '../contract/views';
import { ApiError, forbidden, notFound } from '../errors';
import { undoEvent } from '../events';
import { can, principalOf, type Action, type Resource } from '../permissions';
import { eventViewOf } from '../views';
import { weekStartOf } from '../../lib/dates';
import { assertCan, roleIn, touch } from './shared';
import { isWeekLocked } from './time';

type Fields = Record<string, unknown>;
const fieldsOf = (value: unknown): Fields => (value !== null && typeof value === 'object' ? (value as Fields) : {});

/** The person whose hours a time event is about. Patch events keep only the hours, so the other events of the entry tell. */
function hoursOwners(ctx: Ctx): Map<string, string> {
  const owners = new Map<string, string>();
  for (const e of Object.values(ctx.state.events)) {
    if (e.targetType !== 'time') continue;
    const userId = fieldsOf(e.after).userId ?? fieldsOf(e.before).userId;
    if (typeof userId === 'string') owners.set(e.targetId, userId);
  }
  for (const entry of Object.values(ctx.state.time)) owners.set(entry.id, entry.userId);
  return owners;
}

function canSeeHours(ctx: Ctx, event: Event, owners: Map<string, string>): boolean {
  const owner = owners.get(event.targetId);
  if (!owner) return false;
  return can(ctx.authority, 'time.viewPerson', { targetUserId: owner, projectRole: event.projectId ? roleIn(ctx, event.projectId) : 'other' });
}

export const eventsList = defineCall({
  input: z.object({
    projectId: ProjectId.optional(),
    targetType: EventTarget.optional(),
    targetId: z.string().optional(),
    correlationId: z.string().min(1).max(80).optional(),
    limit: z.number().int().min(1).max(500).default(50),
  }),
  output: z.array(EventView),
  readOnly: true,
  run(input, ctx) {
    const owners = hoursOwners(ctx);
    return Object.values(ctx.state.events)
      .filter((e) => (!input.projectId || e.projectId === input.projectId)
        && (!input.targetType || e.targetType === input.targetType)
        && (!input.targetId || e.targetId === input.targetId)
        && (!input.correlationId || e.correlationId === input.correlationId)
        // Hours are private: only the person, their project leader and Admins see them (spec 2.3).
        && (e.targetType !== 'time' || canSeeHours(ctx, e, owners)))
      .sort((a, b) => b.seq - a.seq)
      .slice(0, input.limit)
      .map((e) => eventViewOf(ctx.state, e));
  },
});

/** Hours stay the person's own, inside an open week, and inside 24 hours a day, also on undo. */
function assertHoursUndo(ctx: Ctx, event: Event): void {
  const current = ctx.state.time[event.targetId];
  const entry = (current ?? (event.after === null ? event.before : null)) as TimeEntry | null;
  if (!entry) throw new ApiError('conflict', 'This item changed after that edit. Undo is not available.');
  if (entry.userId !== ctx.authority.id) throw forbidden('Only the person can undo changes to their own hours.');
  assertCan(ctx, 'time.logOnProject', { projectRole: roleIn(ctx, entry.projectId) });
  if (isWeekLocked(ctx.state, entry.userId, weekStartOf(entry.date), ctx.today)) throw forbidden('This week is locked.', { reason: 'week_locked' });
  const restoredHours = event.before === null ? 0 : Number(fieldsOf(event.before).hours ?? entry.hours);
  const sameDay = Object.values(ctx.state.time).filter((e) => e.userId === entry.userId && e.date === entry.date && e.id !== entry.id);
  if (event.after === null && sameDay.some((e) => e.projectId === entry.projectId && e.stageId === entry.stageId && e.taskId === entry.taskId)) {
    throw new ApiError('conflict', 'This row has new hours for that day. Undo is not available.');
  }
  if (sameDay.reduce((sum, e) => sum + e.hours, 0) + restoredHours > 24) {
    throw new ApiError('conflict', 'This day would have more than 24 hours. Undo is not available.');
  }
}

/** Removing a member by undo follows the same rules as members.remove. */
function assertMemberUndo(ctx: Ctx, event: Event): void {
  if (event.before !== null) return;
  const userId = String(fieldsOf(event.after).userId);
  const project = event.projectId ? ctx.state.projects[event.projectId] : undefined;
  if (project?.leaderId === userId) throw new ApiError('conflict', 'This person now leads the project. Undo is not available.');
  const openTasks = Object.values(ctx.state.tasks).some((t) => t.projectId === event.projectId && t.ownerId === userId && t.status !== 'done');
  if (openTasks) throw new ApiError('conflict', 'This person now has open tasks here. Undo is not available.');
}

const ANY_TASK_FIELDS = ['ownerId', 'needsReview'];

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
      return need('project.edit');
    case 'member':
      need('project.edit');
      return assertMemberUndo(ctx, event);
    case 'stage':
    case 'deadline':
      return need('project.edit');
    case 'task': {
      if (event.verb === 'task.created' || event.verb === 'task.deleted') return need('task.delete');
      if (event.verb === 'task.approved') return need('task.review');
      if (Object.keys(fieldsOf(event.after)).some((field) => ANY_TASK_FIELDS.includes(field))) return need('task.updateAny');
      return need('task.updateOwn', { ownerId: ctx.state.tasks[event.targetId]?.ownerId });
    }
    case 'update':
    case 'comment': {
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
    case 'time':
      return assertHoursUndo(ctx, event);
    case 'client':
      return need(event.verb === 'client.created' ? 'project.create' : 'admin.manage');
    case 'user':
      if (event.verb === 'user.profile_changed' || event.verb === 'user.preferences_changed') {
        if (principalOf(ctx.state, event.targetId) !== ctx.authority.id) throw forbidden('You can undo changes to your own profile only.');
        return;
      }
      return need('admin.manage');
    default:
      return need('admin.manage');
  }
}

/** Undoes one event for the current person, under the rules of the original action. */
function undoOne(ctx: Ctx, event: Event): EventView {
  // Your own changes and your agent's changes are yours to undo: the event names the person each acted for.
  const own = event.actingForId === ctx.authority.id;
  const agentChange = event.actorKind === 'agent' && event.projectId !== null
    && can(ctx.authority, 'event.undoAgent', { projectRole: roleIn(ctx, event.projectId) });
  if (!own && !agentChange) throw forbidden('You can undo changes by you or your agent, and agent changes on a project you lead.');
  assertMayUndo(ctx, event);
  const undo = undoEvent(ctx, event.id);
  if (event.projectId && ctx.state.projects[event.projectId]) touch(ctx, event.projectId);
  return eventViewOf(ctx.state, undo);
}

export const eventsUndo = defineCall({
  input: z.object({ eventId: EventId }),
  output: EventView,
  run(input, ctx) {
    const event = ctx.state.events[input.eventId];
    if (!event) throw notFound('Event', input.eventId);
    return undoOne(ctx, event);
  },
});

/** Undoes every change of one story, newest first. The Undo toast calls it with the story ID of its action. */
export const eventsUndoStory = defineCall({
  input: z.object({ correlationId: z.string().min(1).max(80) }),
  output: z.object({ undone: z.array(EventView) }),
  run(input, ctx) {
    const story = Object.values(ctx.state.events)
      .filter((e) => e.correlationId === input.correlationId && e.verb !== 'undo')
      .sort((a, b) => b.seq - a.seq);
    if (story.length === 0) throw notFound('Story', input.correlationId);
    return { undone: story.map((event) => undoOne(ctx, event)) };
  },
});

export const historyCalls = {
  'events.list': eventsList,
  'events.undo': eventsUndo,
  'events.undoStory': eventsUndoStory,
};
