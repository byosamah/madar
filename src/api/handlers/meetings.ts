import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { Day, MEETING_LIMITS, Meeting, MeetingId, MeetingKind, ProjectId, Stamp, UserId } from '../contract/entities';
import { MeetingDetail, MeetingRow } from '../contract/views';
import { ApiError, invalid, notFound } from '../errors';
import { applyPatch, recordCreate } from '../events';
import { can, mayViewMeeting, mayViewTask, meetingResource, type Actor } from '../permissions';
import { meetingsOf, nextId, type State } from '../store';
import { cardOf } from '../views';
import { addDays, diffDays } from '../../lib/dates';
import { addMinutes, dayOf, earliestStart, kindDefaults, minutesBetween, officeStamp, onFiveMinutes, phaseOf } from '../../lib/meetings';
import { markOf } from '../../lib/projectMark';
import { visibleTextPattern } from '../../lib/projectCode';
import { assertActive, assertCan, requireProject, requireUser, roleIn } from './shared';

const L = MEETING_LIMITS;
const TITLE_PATTERN = visibleTextPattern(L.titleMax);

/** The text fields of a meeting. A trimmed text keeps its line breaks inside. */
const Title = z.string().trim().min(1).max(L.titleMax);
const Where = z.string().trim().max(L.whereMax);
const Guests = z.string().trim().max(L.guestsMax);
const Notes = z.string().trim().max(L.notesMax);
const Length = z.number().int().min(L.minMinutes).max(L.maxMinutes);

/** The fields that a new meeting and a change share. A change makes each of them optional. */
const Fields = {
  kind: MeetingKind,
  title: Title,
  projectId: ProjectId.nullable(),
  startsAt: Stamp,
  durationMin: Length,
  where: Where,
  guests: Guests,
  notes: Notes,
  attendeeIds: z.array(UserId).max(L.attendeesMax),
  minutesById: UserId.nullable(),
};

/** A meeting by id that the person of the call may see. A meeting that the person does not see reads as missing (owner, 2026-10-19). */
export function requireMeeting(ctx: Ctx, id: string): Meeting {
  const meeting = meetingsOf(ctx.state)[id];
  if (!meeting || !mayViewMeeting(ctx.state, ctx.authority, meeting)) throw notFound('Meeting', id);
  return meeting;
}

const conflict = (message: string, reason: string) => new ApiError('conflict', message, { reason });

/** True when the person is the organizer or an attendee. An agent counts as the person it acts for. */
const takesPart = (meeting: Pick<Meeting, 'organizerId' | 'attendeeIds'>, personId: string): boolean =>
  meeting.organizerId === personId || meeting.attendeeIds.includes(personId);

function viewerMayEdit(state: State, viewer: Actor, meeting: Meeting): boolean {
  return can(viewer, 'meeting.edit', meetingResource(state, meeting, viewer.id));
}

/** One meeting in a list. */
export function meetingRowOf(state: State, meeting: Meeting, viewer: Actor): MeetingRow {
  const project = meeting.projectId ? state.projects[meeting.projectId] : undefined;
  return {
    id: meeting.id, kind: meeting.kind, title: meeting.title, status: meeting.status, startsAt: meeting.startsAt, endsAt: meeting.endsAt,
    where: meeting.where, rev: meeting.rev,
    project: project ? { id: project.id, code: project.code, name: project.name, mark: markOf(project) } : null,
    organizer: cardOf(state, meeting.organizerId),
    attendeeCount: meeting.attendeeIds.length,
    mine: takesPart(meeting, viewer.id),
    ...(meeting.seriesId ? { seriesId: meeting.seriesId } : {}),
    ...(meeting.repeat ? { repeat: meeting.repeat } : {}),
  };
}

/** One meeting with its people, its notes, the records Madar made after it, and the rights of the viewer. */
export function meetingDetailOf(state: State, meeting: Meeting, viewer: Actor, at: Date): MeetingDetail {
  const task = meeting.minutesTaskId ? state.tasks[meeting.minutesTaskId] : undefined;
  const entry = meeting.trackerEntryId ? state.tracker?.[meeting.trackerEntryId] : undefined;
  const open = meeting.status === 'scheduled' && viewerMayEdit(state, viewer, meeting);
  return {
    ...meetingRowOf(state, meeting, viewer),
    guests: meeting.guests,
    notes: meeting.notes,
    attendees: meeting.attendeeIds.map((id) => cardOf(state, id)),
    minutesBy: meeting.minutesById ? cardOf(state, meeting.minutesById) : null,
    settledAt: meeting.settledAt ?? null,
    // A minutes task of a meeting with no project is an office task: only its people see it, so the reference follows its view rule.
    minutesTask: task && mayViewTask(state, viewer, task) ? { id: task.id, title: task.title, status: task.status, dueDate: task.dueDate } : null,
    trackerEntry: entry ? { id: entry.id, title: entry.title } : null,
    viewerCan: { edit: open, cancel: open && phaseOf(meeting, at) !== 'done' },
  };
}

/**
 * The attendees and the person for the minutes, checked. The organizer and a repeated person drop out of the attendees. An attendee
 * is an active person, never an agent. The person for the minutes is the organizer or an attendee, or nobody.
 */
function checkPeople(
  ctx: Ctx, organizerId: string, attendeeIds: readonly string[], minutesById: string | null, already: readonly string[] = [],
): string[] {
  const attendees = [...new Set(attendeeIds)].filter((id) => id !== organizerId);
  // A person who is on the list already may have left since. Only a new person must be active.
  for (const id of attendees.filter((one) => !already.includes(one))) {
    assertActive(ctx, id, 'attendeeIds');
    if (requireUser(ctx, id).kind === 'agent') throw invalid('attendeeIds', 'An agent cannot attend a meeting. Choose a person.', 'attendee_agent');
  }
  if (minutesById !== null && minutesById !== organizerId && !attendees.includes(minutesById)) {
    throw invalid('minutesById', 'The person for the minutes must be the organizer or an attendee.', 'minutes_not_attending');
  }
  return attendees;
}

function checkTitle(title: string): void {
  if (!TITLE_PATTERN.test(title)) throw invalid('title', 'Write the title on one line, with visible characters only.', 'title_hidden');
}

/** The start in office time. It must be on a multiple of 5 minutes, and a new start is at most 14 days ago. */
function checkStart(startsAt: string, at: Date, current?: string): string {
  const stamp = officeStamp(startsAt);
  if (!onFiveMinutes(stamp)) throw invalid('startsAt', 'A meeting starts on a multiple of 5 minutes.', 'start_not_on_five');
  if (stamp !== current && Date.parse(stamp) < earliestStart(at).getTime()) {
    throw invalid('startsAt', `A meeting cannot start more than ${L.pastDays} days ago.`, 'in_the_past');
  }
  return stamp;
}

/** The project of a new meeting must be open, and the person must be allowed to plan there. */
function assertMayPlan(ctx: Ctx, projectId: string | null): void {
  const people = { organizerId: ctx.authority.id, attendeeIds: [] as string[], noProject: projectId === null };
  if (projectId === null) {
    assertCan(ctx, 'meeting.create', { meeting: people });
    return;
  }
  const project = requireProject(ctx, projectId);
  assertCan(ctx, 'meeting.create', { projectRole: roleIn(ctx, projectId), meeting: people });
  if (project.status !== 'active' && project.status !== 'on_hold') throw invalid('projectId', 'This project is closed. A meeting goes only to an open project.', 'project_closed');
}

const meetingsCreate = defineCall({
  input: z.object({
    kind: Fields.kind,
    title: Fields.title,
    projectId: Fields.projectId.optional(),
    startsAt: Fields.startsAt,
    durationMin: Fields.durationMin.optional(),
    where: Fields.where.optional(),
    guests: Fields.guests.optional(),
    notes: Fields.notes.optional(),
    attendeeIds: Fields.attendeeIds.optional(),
    minutesById: Fields.minutesById.optional(),
  }),
  output: MeetingDetail,
  run(input, ctx) {
    const projectId = input.projectId ?? null;
    assertMayPlan(ctx, projectId);
    checkTitle(input.title);
    const startsAt = checkStart(input.startsAt, ctx.now);
    const defaults = kindDefaults(input.kind);
    const organizerId = ctx.authority.id;
    // A team meeting has nobody for the minutes unless the call names a person. Else the organizer writes them.
    const minutesById = input.minutesById !== undefined ? input.minutesById : defaults.minutesByOrganizer ? organizerId : null;
    const attendeeIds = checkPeople(ctx, organizerId, input.attendeeIds ?? [], minutesById);
    const id = nextId(ctx.state, 'mtg');
    const meeting: Meeting = {
      id, kind: input.kind, title: input.title, projectId, startsAt, endsAt: addMinutes(startsAt, input.durationMin ?? defaults.durationMin),
      where: input.where ?? '', guests: input.guests ?? '', notes: input.notes ?? '', organizerId, attendeeIds, minutesById,
      status: 'scheduled', rev: 1, createdBy: ctx.actor.id, createdAt: ctx.stamp,
    };
    meetingsOf(ctx.state)[id] = meeting;
    recordCreate(ctx, { projectId, verb: 'meeting.created', targetType: 'meeting', targetId: id, entity: meeting });
    return meetingDetailOf(ctx.state, meeting, ctx.authority, ctx.now);
  },
});

const meetingsUpdate = defineCall({
  input: z.object({
    id: MeetingId,
    kind: Fields.kind.optional(),
    title: Fields.title.optional(),
    projectId: Fields.projectId.optional(),
    startsAt: Fields.startsAt.optional(),
    durationMin: Fields.durationMin.optional(),
    where: Fields.where.optional(),
    guests: Fields.guests.optional(),
    notes: Fields.notes.optional(),
    attendeeIds: Fields.attendeeIds.optional(),
    minutesById: Fields.minutesById.optional(),
  }),
  output: MeetingDetail,
  run(input, ctx) {
    const meeting = requireMeeting(ctx, input.id);
    assertCan(ctx, 'meeting.edit', meetingResource(ctx.state, meeting, ctx.authority.id));
    if (meeting.status === 'cancelled') throw conflict('This meeting is cancelled. It cannot change.', 'meeting_cancelled');
    // A meeting stays in its project, or stays private. A call may repeat the project that the meeting has.
    if (input.projectId !== undefined && input.projectId !== meeting.projectId) {
      throw invalid('projectId', 'A meeting stays in its project. Cancel it and plan a new one.', 'project_fixed');
    }
    if (input.title !== undefined) checkTitle(input.title);
    const startsAt = input.startsAt === undefined ? meeting.startsAt : checkStart(input.startsAt, ctx.now, meeting.startsAt);
    const endsAt = input.startsAt === undefined && input.durationMin === undefined
      ? meeting.endsAt
      : addMinutes(startsAt, input.durationMin ?? minutesBetween(meeting.startsAt, meeting.endsAt));
    const minutesById = input.minutesById !== undefined ? input.minutesById : meeting.minutesById;
    const attendeeIds = input.attendeeIds !== undefined || input.minutesById !== undefined
      ? checkPeople(ctx, meeting.organizerId, input.attendeeIds ?? meeting.attendeeIds, minutesById, meeting.attendeeIds)
      : meeting.attendeeIds;
    const next: Partial<Meeting> = {
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      startsAt, endsAt,
      ...(input.where !== undefined ? { where: input.where } : {}),
      ...(input.guests !== undefined ? { guests: input.guests } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      attendeeIds, minutesById,
    };
    const changed = (Object.keys(next) as (keyof Meeting)[]).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(meeting[key]));
    // After the end only the notes change: the day, the place and the people are history (owner, 2026-10-19).
    if (phaseOf(meeting, ctx.now) === 'done' && changed.some((key) => key !== 'notes')) {
      throw conflict('This meeting is over. Only its notes change.', 'meeting_over');
    }
    const event = applyPatch(ctx, meeting, Object.fromEntries(changed.map((key) => [key, next[key]])) as Partial<Meeting>, {
      projectId: meeting.projectId, verb: 'meeting.updated', targetType: 'meeting', targetId: meeting.id,
    });
    // rev is not in the event: an Undo brings the time or the place back and raises rev again (history.ts), so it never goes down.
    if (event && changed.some((key) => key === 'startsAt' || key === 'endsAt' || key === 'where')) meeting.rev += 1;
    return meetingDetailOf(ctx.state, meeting, ctx.authority, ctx.now);
  },
});

const meetingsCancel = defineCall({
  input: z.object({ id: MeetingId }),
  output: MeetingDetail,
  run(input, ctx) {
    const meeting = requireMeeting(ctx, input.id);
    assertCan(ctx, 'meeting.edit', meetingResource(ctx.state, meeting, ctx.authority.id));
    // A second cancel changes nothing and writes no event.
    if (meeting.status === 'cancelled') return meetingDetailOf(ctx.state, meeting, ctx.authority, ctx.now);
    if (phaseOf(meeting, ctx.now) === 'done') throw conflict('This meeting is over. It cannot be cancelled.', 'meeting_over');
    applyPatch(ctx, meeting, { status: 'cancelled' }, { projectId: meeting.projectId, verb: 'meeting.cancelled', targetType: 'meeting', targetId: meeting.id });
    meeting.rev += 1;
    return meetingDetailOf(ctx.state, meeting, ctx.authority, ctx.now);
  },
});

const meetingsGet = defineCall({
  input: z.object({ id: MeetingId }),
  output: MeetingDetail,
  readOnly: true,
  run(input, ctx) {
    return meetingDetailOf(ctx.state, requireMeeting(ctx, input.id), ctx.authority, ctx.now);
  },
});

const meetingsList = defineCall({
  input: z.object({ from: Day.optional(), to: Day.optional(), projectId: ProjectId.optional(), mine: z.boolean().optional() }),
  output: z.array(MeetingRow),
  readOnly: true,
  run(input, ctx) {
    const from = input.from ?? ctx.today;
    const to = input.to ?? addDays(from, L.listDefaultDays);
    if (diffDays(from, to) < 0) throw invalid('to', 'The end of the window comes before its start.', 'window_reversed');
    if (diffDays(from, to) + 1 > L.windowDaysMax) throw invalid('to', `A list covers at most ${L.windowDaysMax} days.`, 'window_too_long');
    const mine = input.mine ?? true;
    if (!mine && !input.projectId) throw invalid('projectId', 'A list of meetings that are not yours needs a project.', 'project_needed');
    if (input.projectId) requireProject(ctx, input.projectId);
    const me = ctx.authority.id;
    return Object.values(meetingsOf(ctx.state))
      .filter((m) => mayViewMeeting(ctx.state, ctx.authority, m))
      .filter((m) => !input.projectId || m.projectId === input.projectId)
      .filter((m) => !mine || takesPart(m, me))
      .filter((m) => dayOf(m) >= from && dayOf(m) <= to)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, L.listMax)
      .map((m) => meetingRowOf(ctx.state, m, ctx.authority));
  },
});

/** create comes first: the sweep of the call tests (server/core/everyCall.ts) runs the calls in this order, and the others need a meeting. */
export const meetingCalls = {
  'meetings.create': meetingsCreate,
  'meetings.list': meetingsList,
  'meetings.get': meetingsGet,
  'meetings.update': meetingsUpdate,
  'meetings.cancel': meetingsCancel,
};
