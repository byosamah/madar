import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import {
  Day, FileId, MAX_ATTACHMENTS, ProjectId, TrackerDirection, TrackerId, TrackerType, TrackerWaiting, UserId, type TrackerEntry,
} from '../contract/entities';
import { TrackerRow } from '../contract/views';
import { forbidden, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
import { nextId, trackerOf } from '../store';
import { mayDeleteTracker, trackerRowOf } from '../views';
import { assertFilesInProject } from './attach';
import { assertCan, requireProject, requireUser, roleIn, touch } from './shared';

const Title = z.string().trim().min(1).max(200);
const Note = z.string().trim().max(2000);
const PeopleIds = z.array(UserId).max(20);
const Files = z.array(FileId).max(MAX_ATTACHMENTS);

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

type NewEntry = Pick<TrackerEntry, 'projectId' | 'type' | 'direction' | 'title'>
  & Partial<Pick<TrackerEntry, 'note' | 'date' | 'waiting' | 'fileIds' | 'peopleIds' | 'auto'>>;

/** Writes one entry and its event. The calls that log by themselves (a file upload, "delivered") use this too. */
export function addTrackerEntry(ctx: Ctx, input: NewEntry): TrackerEntry {
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
  }),
  output: TrackerRow,
  run(input, ctx) {
    const project = requireProject(ctx, input.projectId);
    assertMayPost(ctx, project.id);
    assertFilesInProject(ctx, input.fileIds, project.id);
    assertPeople(ctx, input.peopleIds);
    return trackerRowOf(ctx.state, addTrackerEntry(ctx, input), ctx.authority);
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
    applyPatch(ctx, entry, { closedAt: ctx.stamp, closedBy: ctx.actor.id }, { projectId: entry.projectId, verb: 'tracker.closed', targetType: 'tracker', targetId: entry.id });
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
    // A new waiting value starts a new loop, so it is open again. Taking the value away ends the loop.
    const loop = waiting !== undefined && waiting !== entry.waiting ? { waiting, closedAt: null, closedBy: null } : {};
    applyPatch(ctx, entry, { type, direction, title, note, date, fileIds, peopleIds, ...loop }, { projectId: entry.projectId, verb: 'tracker.edited', targetType: 'tracker', targetId: entry.id });
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
    recordDelete(ctx, { projectId: entry.projectId, verb: 'tracker.deleted', targetType: 'tracker', targetId: entry.id, entity: entry });
    delete trackerOf(ctx.state)[entry.id];
    touch(ctx, entry.projectId);
    return { deleted: true as const };
  },
});

export const trackerCalls = {
  'tracker.list': trackerList,
  'tracker.log': trackerLog,
  'tracker.close': trackerClose,
  'tracker.update': trackerUpdate,
  'tracker.delete': trackerDelete,
};
