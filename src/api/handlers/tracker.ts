import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import {
  Day, FileId, MAX_ATTACHMENTS, ProjectId, TrackerDirection, TrackerId, TrackerType, TrackerWaiting, UserId, type Event, type Task, type TrackerEntry,
} from '../contract/entities';
import { TrackerExportRow, TrackerRow } from '../contract/views';
import { forbidden, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
import { mayFinish, stageTag, watchStage } from '../flow';
import { notifyIn } from '../notify';
import { projectRoleOf } from '../permissions';
import { nextId, trackerOf, type State } from '../store';
import { attachmentsOf, mayDeleteTracker, namesUnder, trackerRowOf } from '../views';
import { isOpen, sidesOf } from '../../lib/tracker';
import { assertFilesInProject } from './attach';
import { assertActive, assertCan, requireProject, requireUser, roleIn, touch } from './shared';
import { changeStatus } from './tasks';

const Title = z.string().trim().min(1).max(200);
const Note = z.string().trim().max(2000);
const PeopleIds = z.array(UserId).max(20);
const Files = z.array(FileId).max(MAX_ATTACHMENTS);
const ReplyBy = z.object({ userId: UserId, dueDate: Day });
type ReplyBy = z.infer<typeof ReplyBy>;

function requireEntry(ctx: Ctx, id: string): TrackerEntry {
  const entry = trackerOf(ctx.state)[id];
  if (!entry) throw notFound('Tracker entry', id);
  return entry;
}

/** The leader, the team and the Admin log, close and edit. Reading needs only the right to open the project. */
function assertMayPost(ctx: Ctx, projectId: string): void {
  assertCan(ctx, 'content.post', { projectRole: roleIn(ctx, projectId) });
}

function assertPeople(ctx: Ctx, peopleIds: string[]): void {
  for (const id of peopleIds) requireUser(ctx, id);
}

/** The side follows the type: a meeting has both sides, a Balady update comes from a third party, and only a message or a file goes from or to the client. */
function assertSide(type: TrackerEntry['type'], direction: TrackerEntry['direction']): void {
  if (!sidesOf(type).includes(direction)) throw invalid('direction', `A ${type} entry cannot have the side "${direction}".`, 'side_for_type');
}

/** The person who replies must be on the project team, as for any task, and still active. */
function assertReplier(ctx: Ctx, projectId: string, userId: string): void {
  assertActive(ctx, userId, 'userId');
  if (projectRoleOf(ctx.state, projectId, userId) === 'other') throw invalid('userId', 'The person who replies must be on the project team.', 'reply_not_on_team');
}

type NewEntry = Pick<TrackerEntry, 'projectId' | 'type' | 'direction' | 'title'>
  & Partial<Pick<TrackerEntry, 'note' | 'date' | 'waiting' | 'fileIds' | 'peopleIds' | 'auto'>>;

/** Writes one entry and its event. The calls that log by themselves (a file upload, "delivered") use this too. */
export function addTrackerEntry(ctx: Ctx, input: NewEntry): TrackerEntry {
  assertSide(input.type, input.direction);
  const id = nextId(ctx.state, 'trk');
  const entry: TrackerEntry = {
    id, projectId: input.projectId, type: input.type, direction: input.direction, title: input.title, note: input.note ?? '',
    date: input.date ?? ctx.today, waiting: input.waiting ?? null, closedAt: null, closedBy: null, fileIds: input.fileIds ?? [],
    peopleIds: input.peopleIds ?? [], auto: input.auto ?? null, createdBy: ctx.actor.id, createdAt: ctx.stamp,
  };
  trackerOf(ctx.state)[id] = entry;
  recordCreate(ctx, { projectId: entry.projectId, verb: 'tracker.logged', targetType: 'tracker', targetId: id, entity: entry });
  touch(ctx, entry.projectId);
  return entry;
}

function closeEntry(ctx: Ctx, entry: TrackerEntry, extra: Partial<TrackerEntry> = {}): void {
  applyPatch(ctx, entry, { closedAt: ctx.stamp, closedBy: ctx.actor.id, ...extra }, { projectId: entry.projectId, verb: 'tracker.closed', targetType: 'tracker', targetId: entry.id });
}

/** The task forgets the entry it answered, and stays the person's open task. */
function unlinkReply(ctx: Ctx, task: Task): void {
  applyPatch(ctx, task, { trackerEntryId: null }, { projectId: task.projectId, verb: 'task.reply_unlinked', targetType: 'task', targetId: task.id });
}

/** The reply task of the entry while it is open. */
function openReplyTaskOf(state: State, entry: TrackerEntry): Task | undefined {
  const task = entry.replyTaskId ? state.tasks[entry.replyTaskId] : undefined;
  return task && task.status !== 'done' ? task : undefined;
}

/**
 * The reply task and the loop never disagree: when the loop ends, the open reply task finishes too. It finishes by the task rules,
 * so what it needs must be done, and the stage tag follows (audit 2026-10-03, API-9).
 */
function finishReplyTask(ctx: Ctx, entry: TrackerEntry): void {
  const task = openReplyTaskOf(ctx.state, entry);
  if (!task) return;
  const watch = watchStage(ctx, task.projectId);
  changeStatus(ctx, task, 'done');
  watch.finish({ ask: false });
}

/** The open reply task of the entry when it may not finish yet, because a task or a stage it needs is open. */
function heldReplyTask(ctx: Ctx, entry: TrackerEntry): Task | undefined {
  const task = openReplyTaskOf(ctx.state, entry);
  return task && !mayFinish(ctx.state, task) ? task : undefined;
}

/**
 * Opens the task "Reply: <title>" for a person, in the current stage of the project, and links it both ways.
 * It needs no review: the reply is the person's own work, and the Tracker logs it when the task is done.
 * The stage is the tag, computed from the tasks, never a saved stage that is behind (audit 2026-10-03, API-9).
 */
function openReplyTask(ctx: Ctx, entry: TrackerEntry, reply: ReplyBy): void {
  const project = requireProject(ctx, entry.projectId);
  const watch = watchStage(ctx, project.id);
  const id = nextId(ctx.state, 'tsk');
  const task: Task = {
    id, projectId: project.id, stageId: stageTag(ctx.state, project.id)?.id ?? project.currentStageId, title: `Reply: ${entry.title}`.slice(0, 200), description: '', ownerId: reply.userId,
    status: 'todo', dueDate: reply.dueDate, startDate: null, schedule: 'static', durationDays: null, flagged: false, needsReview: false, checklist: [],
    createdBy: ctx.actor.id, createdAt: ctx.stamp, completedAt: null, trackerEntryId: entry.id,
  };
  ctx.state.tasks[id] = task;
  recordCreate(ctx, { projectId: project.id, verb: 'task.created', targetType: 'task', targetId: id, entity: task });
  notifyIn(ctx, { userIds: [reply.userId], trigger: 'task_assigned', targetType: 'task', targetId: id });
  applyPatch(ctx, entry, { replyTaskId: id }, { projectId: entry.projectId, verb: 'tracker.reply_assigned', targetType: 'tracker', targetId: entry.id });
  // A task in the tag stage never moves the tag back. The saved stage catches up when it is behind.
  watch.finish({ ask: false });
  touch(ctx, project.id);
}

/**
 * The one hook for the task calls: run it when a task becomes done, by any path. When the task answers an open entry,
 * Madar closes the loop and logs the reply as a message to the client with the same files. It writes under the story
 * of the call, so one Undo of the finish takes it all back.
 */
export function replyTaskDone(ctx: Ctx, task: Task): void {
  const entry = task.trackerEntryId ? trackerOf(ctx.state)[task.trackerEntryId] : undefined;
  if (!entry || entry.replyTaskId !== task.id || !isOpen(entry) || entry.waiting !== 'us') return;
  closeEntry(ctx, entry);
  addTrackerEntry(ctx, {
    projectId: entry.projectId, type: 'message', direction: 'out', title: `Reply: ${entry.title}`.slice(0, 200), auto: 'reply',
    fileIds: entry.fileIds.filter((id) => ctx.state.files[id]),
  });
  touch(ctx, entry.projectId);
}

const trackerList = defineCall({
  input: z.object({
    projectId: ProjectId,
    type: TrackerType.optional(),
    direction: TrackerDirection.optional(),
    openOnly: z.boolean().optional(),
  }),
  output: z.array(TrackerRow),
  readOnly: true,
  run(input, ctx) {
    requireProject(ctx, input.projectId);
    return Object.values(trackerOf(ctx.state))
      .filter((e) => e.projectId === input.projectId
        && (!input.type || e.type === input.type)
        && (!input.direction || e.direction === input.direction)
        && (!input.openOnly || (e.waiting !== null && e.closedAt === null)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map((e) => trackerRowOf(ctx.state, e, ctx.authority));
  },
});

const trackerLog = defineCall({
  input: z.object({
    projectId: ProjectId,
    type: TrackerType,
    direction: TrackerDirection,
    title: Title,
    note: Note.default(''),
    date: Day.optional(),
    waiting: TrackerWaiting.nullable().default(null),
    fileIds: Files.default([]),
    peopleIds: PeopleIds.default([]),
    /** Opens a reply task for this person, due on this day. Only an entry that waits for our reply may have one. */
    replyBy: ReplyBy.optional(),
  }),
  output: TrackerRow,
  run(input, ctx) {
    const project = requireProject(ctx, input.projectId);
    assertMayPost(ctx, project.id);
    assertFilesInProject(ctx, input.fileIds, project.id);
    assertPeople(ctx, input.peopleIds);
    assertSide(input.type, input.direction);
    const { replyBy, ...fields } = input;
    if (replyBy) {
      if (input.waiting !== 'us') throw invalid('replyBy', 'Only an entry that waits for our reply gets a reply task.', 'reply_needs_waiting_us');
      assertReplier(ctx, project.id, replyBy.userId);
    }
    const entry = addTrackerEntry(ctx, fields);
    if (replyBy) openReplyTask(ctx, entry, replyBy);
    return trackerRowOf(ctx.state, entry, ctx.authority);
  },
});

const trackerClose = defineCall({
  input: z.object({ id: TrackerId }),
  output: TrackerRow,
  run(input, ctx) {
    const entry = requireEntry(ctx, input.id);
    assertMayPost(ctx, entry.projectId);
    if (entry.waiting === null) throw invalid('id', 'This entry is not waiting for anything.', 'not_open');
    if (entry.closedAt !== null) throw invalid('id', 'This entry is already closed.', 'already_closed');
    // Ending the wait is never refused, the same as an edit that ends it: a reply task that waits for other work only forgets
    // the entry (audit 2026-10-03, V-13). The entry is closed first, so finishing the task logs no second reply.
    const held = heldReplyTask(ctx, entry);
    closeEntry(ctx, entry, held ? { replyTaskId: null } : {});
    if (held) unlinkReply(ctx, held);
    else finishReplyTask(ctx, entry);
    touch(ctx, entry.projectId);
    return trackerRowOf(ctx.state, entry, ctx.authority);
  },
});

const trackerUpdate = defineCall({
  input: z.object({
    id: TrackerId,
    type: TrackerType.optional(),
    direction: TrackerDirection.optional(),
    title: Title.optional(),
    note: Note.optional(),
    date: Day.optional(),
    waiting: TrackerWaiting.nullable().optional(),
    fileIds: Files.optional(),
    peopleIds: PeopleIds.optional(),
  }),
  output: TrackerRow,
  run(input, ctx) {
    const entry = requireEntry(ctx, input.id);
    assertMayPost(ctx, entry.projectId);
    if (input.fileIds) assertFilesInProject(ctx, input.fileIds, entry.projectId);
    if (input.peopleIds) assertPeople(ctx, input.peopleIds);
    const { type, direction, title, note, date, waiting, fileIds, peopleIds } = input;
    assertSide(type ?? entry.type, direction ?? entry.direction);
    // A new waiting value starts a new loop, so it is open again. Taking the value away ends the loop.
    const loop = waiting !== undefined && waiting !== entry.waiting ? { waiting, closedAt: null, closedBy: null } : {};
    const replyEnds = entry.waiting === 'us' && waiting !== undefined && waiting !== 'us';
    // Ending the wait is never refused. A reply task that waits for other work cannot finish yet, so it only forgets the entry
    // and stays the person's open task (audit 2026-10-03, V-13).
    const held = replyEnds ? heldReplyTask(ctx, entry) : undefined;
    const unlink = held ? { replyTaskId: null } : {};
    applyPatch(ctx, entry, { type, direction, title, note, date, fileIds, peopleIds, ...loop, ...unlink }, { projectId: entry.projectId, verb: 'tracker.edited', targetType: 'tracker', targetId: entry.id });
    if (held) unlinkReply(ctx, held);
    // The entry no longer waits for our reply, so its reply task leaves the person's list (audit 2026-10-03, API-9).
    else if (replyEnds) finishReplyTask(ctx, entry);
    touch(ctx, entry.projectId);
    return trackerRowOf(ctx.state, entry, ctx.authority);
  },
});

const trackerDelete = defineCall({
  input: z.object({ id: TrackerId }),
  output: z.object({ deleted: z.literal(true) }),
  run(input, ctx) {
    const entry = requireEntry(ctx, input.id);
    if (!mayDeleteTracker(ctx.state, ctx.authority, entry)) throw forbidden('Only the person who logged this, the project leader or the Admin can delete it.');
    // The reply task stays. It only forgets the entry, and Undo of the delete brings the link back.
    const task = entry.replyTaskId ? ctx.state.tasks[entry.replyTaskId] : undefined;
    if (task && task.trackerEntryId === entry.id) unlinkReply(ctx, task);
    recordDelete(ctx, { projectId: entry.projectId, verb: 'tracker.deleted', targetType: 'tracker', targetId: entry.id, entity: entry });
    delete trackerOf(ctx.state)[entry.id];
    touch(ctx, entry.projectId);
    return { deleted: true as const };
  },
});

const trackerAssignReply = defineCall({
  input: z.object({ id: TrackerId, userId: UserId, dueDate: Day }),
  output: TrackerRow,
  run(input, ctx) {
    const entry = requireEntry(ctx, input.id);
    assertMayPost(ctx, entry.projectId);
    if (!isOpen(entry) || entry.waiting !== 'us') throw invalid('id', 'Only an open entry that waits for our reply gets a reply task.', 'reply_not_open');
    // A finished reply task does not block a new one: the entry may have been opened again.
    const current = entry.replyTaskId ? ctx.state.tasks[entry.replyTaskId] : undefined;
    if (current && current.status !== 'done') throw invalid('id', 'This entry already has a reply task.', 'reply_exists');
    assertReplier(ctx, entry.projectId, input.userId);
    openReplyTask(ctx, entry, { userId: input.userId, dueDate: input.dueDate });
    return trackerRowOf(ctx.state, entry, ctx.authority);
  },
});

/** What an event on an entry means for the export. Null for an event that is not a line of the log. */
function exportKind(event: Event, shown: TrackerEntry): TrackerExportRow['event'] | null {
  const before = (event.before ?? {}) as Partial<TrackerEntry>;
  const after = (event.after ?? {}) as Partial<TrackerEntry>;
  switch (event.verb) {
    case 'tracker.logged': return shown.auto === 'reply' ? 'reply_logged' : 'logged';
    case 'tracker.edited': return before.closedAt && after.closedAt === null ? 'reopened' : 'edited';
    case 'tracker.closed': return 'closed';
    case 'tracker.deleted': return 'deleted';
    case 'tracker.reply_assigned': return 'reply_task';
    default: return null;
  }
}

/**
 * The Tracker log as rows, newest first: one row for every event on an entry of the project (logged, edited, closed, reopened,
 * deleted, a reply task opened, a reply logged). The time is exact, in office time. A change that was undone is not a row.
 * The title, the type and the side are the ones the entry had right after the event (for a delete, right before it).
 */
const trackerExport = defineCall({
  input: z.object({ projectId: ProjectId, type: TrackerType.optional(), side: TrackerDirection.optional() }),
  output: z.array(TrackerExportRow),
  readOnly: true,
  run(input, ctx) {
    requireProject(ctx, input.projectId);
    const events = Object.values(ctx.state.events)
      .filter((e) => e.targetType === 'tracker' && e.projectId === input.projectId)
      .sort((a, b) => a.seq - b.seq);
    // An undo changes the entry too, so the events are replayed in order to know the entry after each of them.
    const entries = new Map<string, TrackerEntry | null>();
    const rows: { event: Event; row: TrackerExportRow }[] = [];
    for (const event of events) {
      const known = entries.get(event.targetId) ?? null;
      const after = (event.before === null ? event.after : event.after === null ? null : { ...known, ...(event.after as object) }) as TrackerEntry | null;
      entries.set(event.targetId, after);
      const shown = after ?? (event.before as TrackerEntry | null);
      const kind = shown && !event.undoneBy && event.verb !== 'undo' ? exportKind(event, shown) : null;
      if (!shown || !kind) continue;
      if ((input.type && shown.type !== input.type) || (input.side && shown.direction !== input.side)) continue;
      // Every stamp is in office time, so the clock reads straight off the text: 2026-09-30T08:00:00.000+03:00.
      rows.push({ event, row: {
        date: event.createdAt.slice(0, 10), time: event.createdAt.slice(11, 19), event: kind, waiting: shown.waiting,
        ...namesUnder('by', ctx.state.users[event.actingForId]), byAgent: event.actorKind === 'agent',
        type: shown.type, direction: shown.direction, title: shown.title, note: shown.note,
        files: attachmentsOf(ctx.state, shown.fileIds).flatMap((file) => (file.name ? [file.name] : [])), auto: shown.auto,
      } });
    }
    // Newest first by the moment of the event. An entry saved before the export has its events written later, so the order of writing is not the order of time.
    return rows.sort((a, b) => b.event.createdAt.localeCompare(a.event.createdAt) || b.event.seq - a.event.seq).map((item) => item.row);
  },
});

export const trackerCalls = {
  'tracker.list': trackerList,
  'tracker.log': trackerLog,
  'tracker.close': trackerClose,
  'tracker.update': trackerUpdate,
  'tracker.delete': trackerDelete,
  'tracker.assignReply': trackerAssignReply,
  'tracker.export': trackerExport,
};
