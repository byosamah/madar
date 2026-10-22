import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { Day, FileId, MAX_ATTACHMENTS, MEETING_LIMITS, Meeting, MeetingId, MeetingKind, MeetingRepeat, ProjectId, Stamp, TrackerId, UserId, type MeetingMinutes, type TrackerEntry } from '../contract/entities';
import { MeetingDetail, MeetingRow } from '../contract/views';
import { ApiError, forbidden, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete, writeEvent } from '../events';
import { mayViewMeeting, mayViewProject, meetingResource, type Actor } from '../permissions';
import { mayEditMeeting, mayWriteMinutes } from '../meetingGates';
import { notifyIn } from '../notify';
import { meetingsOf, nextId, type State } from '../store';
import { cardOf, minutesViewOf } from '../views';
import { addDays, diffDays, maxDay, todayISO } from '../../lib/dates';
import {
  addMinutes, clockOf, dayOf, earliestStart, hasTrackerLine, kindDefaults, minutesBetween, occurrencesOf, officeStamp, onFiveMinutes, phaseOf, REPEAT_MAX_DAYS, SERIES_AHEAD,
  SETTLE_BACK_DAYS, stampOn,
} from '../../lib/meetings';
import { isLive } from '../../lib/overview';
import { markOf } from '../../lib/projectMark';
import { visibleTextPattern } from '../../lib/projectCode';
import { assertFilesForMeeting, assertFilesInProject } from './attach';
import { addTrackerEntry } from './tracker';
import { assertActive, assertCan, requireProject, requireUser, roleIn, touch } from './shared';

const L = MEETING_LIMITS;
const TITLE_PATTERN = visibleTextPattern(L.titleMax);

/** The text fields of a meeting. A trimmed text keeps its line breaks inside. */
const Title = z.string().trim().min(1).max(L.titleMax);
const Where = z.string().trim().max(L.whereMax);
const Guests = z.string().trim().max(L.guestsMax);
const Notes = z.string().trim().max(L.notesMax);
const Length = z.number().int().min(L.minMinutes).max(L.maxMinutes);

/**
 * The scope of a change or a cancel in a series (fbk_022, wave 3): "one" is this meeting alone (the default), "later" is this meeting and
 * every scheduled meeting after it. A meeting in no series is one meeting whatever the scope.
 */
const Scope = z.enum(['one', 'later']);

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
};

/** A meeting by id that the person of the call may see. A meeting that the person does not see reads as missing (owner, 2026-10-19). */
export function requireMeeting(ctx: Ctx, id: string): Meeting {
  const meeting = meetingsOf(ctx.state)[id];
  if (!meeting || !mayViewMeeting(ctx.state, ctx.authority, meeting)) throw notFound('Meeting', id);
  return meeting;
}

const conflict = (message: string, reason: string) => new ApiError('conflict', message, { reason });

/**
 * What stops a person from writing the minutes of a meeting now, or null when nothing does (fbk_022, wave 2). The same rule serves
 * the upload of a meeting file and the save of the minutes. In this order: a meeting that the person does not see reads as missing;
 * a cancelled meeting has none; none before the end; the person must be one who writes them (meeting.minutesOwn or meeting.minutesAny); and a project meeting
 * whose Tracker line is gone waits until someone brings the line back, because its minutes live on that line.
 */
export function minutesRefusal(state: State, meeting: Meeting, viewer: Actor, at: Date): ApiError | null {
  if (!mayViewMeeting(state, viewer, meeting)) return notFound('Meeting', meeting.id);
  if (meeting.status === 'cancelled') return conflict('This meeting is cancelled. It has no minutes.', 'meeting_cancelled');
  if (phaseOf(meeting, at) !== 'done') return conflict('You can write the minutes after the meeting ends.', 'minutes_not_yet');
  if (!mayWriteMinutes(viewer, meetingResource(state, meeting, viewer.id))) return forbidden('You cannot do this.', { action: 'meeting.minutesOwn' });
  if (hasTrackerLine(meeting) && meeting.settledAt && !(meeting.trackerEntryId && state.tracker?.[meeting.trackerEntryId])) {
    return conflict('Someone deleted the Tracker line of this meeting. Undo the delete in the History first.', 'minutes_line_gone');
  }
  return null;
}

/** True when the person is the organizer or an attendee. An agent counts as the person it acts for. */
const takesPart = (meeting: Pick<Meeting, 'organizerId' | 'attendeeIds'>, personId: string): boolean =>
  meeting.organizerId === personId || meeting.attendeeIds.includes(personId);

function viewerMayEdit(state: State, viewer: Actor, meeting: Meeting): boolean {
  return mayEditMeeting(viewer, meetingResource(state, meeting, viewer.id));
}

/** The change, cancel, delete and extend of a meeting: meeting.editOwn for its organizer, meeting.any for the leader or every project. */
function assertMayEdit(ctx: Ctx, meeting: Meeting): void {
  if (!viewerMayEdit(ctx.state, ctx.authority, meeting)) throw forbidden('You cannot do this.', { action: 'meeting.editOwn' });
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

/**
 * One meeting with its people, its notes, the Tracker line that Madar made after it ended, and the rights of the viewer. "minutesBy"
 * and "minutesTask" stay in the answer for an old tab and are always null: any attendee writes the minutes, and there is no minutes
 * task (owner, 2026-10-19).
 */
export function meetingDetailOf(state: State, meeting: Meeting, viewer: Actor, at: Date): MeetingDetail {
  const entry = meeting.trackerEntryId ? state.tracker?.[meeting.trackerEntryId] : undefined;
  const open = meeting.status === 'scheduled' && viewerMayEdit(state, viewer, meeting);
  const held = minutesOf(state, meeting);
  return {
    ...meetingRowOf(state, meeting, viewer),
    guests: meeting.guests,
    notes: meeting.notes,
    attendees: meeting.attendeeIds.map((id) => cardOf(state, id)),
    minutesBy: null,
    settledAt: meeting.settledAt ?? null,
    minutesTask: null,
    trackerEntry: entry ? { id: entry.id, title: entry.title } : null,
    viewerCan: {
      edit: open, cancel: open && phaseOf(meeting, at) !== 'done', minutes: minutesRefusal(state, meeting, viewer, at) === null,
      // A cancelled meeting that the person may change can be deleted (owner, 2026-10-23).
      delete: meeting.status === 'cancelled' && viewerMayEdit(state, viewer, meeting),
    },
    minutes: held.minutes ? minutesViewOf(state, held.minutes, viewer) : null,
    minutesPlace: held.place,
  };
}

/**
 * Where the minutes of a meeting live and what they hold now (wave 2): on the Tracker line of a project meeting that is not a team meeting,
 * else on the meeting itself. A cancelled meeting has none. Before the line exists, or when it is gone, the minutes read as empty.
 */
export function minutesOf(state: State, meeting: Meeting): { place: 'tracker' | 'meeting' | null; minutes: MeetingMinutes | null; entry?: TrackerEntry } {
  if (meeting.status === 'cancelled') return { place: null, minutes: null };
  if (!hasTrackerLine(meeting)) return { place: 'meeting', minutes: meeting.minutes ?? null };
  const entry = meeting.trackerEntryId ? state.tracker?.[meeting.trackerEntryId] : undefined;
  return { place: 'tracker', minutes: entry?.minutes ?? null, ...(entry ? { entry } : {}) };
}

/**
 * A notice meeting_invited for these people (fbk_022). The actor and the person of an agent actor get none, an agent gets none, a person
 * who left gets none, and a person with the switch off gets none (notify). A person who cannot see the meeting gets none either, so a
 * meeting with no project tells only its people. The notice joins the story of the call, so an Undo of the story takes it back.
 */
function tell(ctx: Ctx, meeting: Meeting, userIds: readonly string[], change: 'new' | 'moved' | 'cancelled', dedupeKey?: string): void {
  if (userIds.length === 0) return;
  notifyIn(ctx, { userIds: [...userIds], trigger: 'meeting_invited', targetType: 'meeting', targetId: meeting.id, meeting: { change }, ...(dedupeKey ? { dedupeKey } : {}) });
}

/** The last day of a repeat: not before the first meeting, and at most REPEAT_MAX_DAYS days after it. */
function checkRepeat(repeat: MeetingRepeat, firstDay: string): void {
  if (repeat.until === null) return;
  if (repeat.until < firstDay) throw invalid('repeat', 'The last day of a repeat cannot come before the first meeting.', 'until_before_start');
  if (diffDays(firstDay, repeat.until) > REPEAT_MAX_DAYS) throw invalid('repeat', `A repeat ends at most ${REPEAT_MAX_DAYS} days after the first meeting.`, 'until_too_far');
}

const byStart = (a: Meeting, b: Meeting): number => Date.parse(a.startsAt) - Date.parse(b.startsAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The other meetings that a "later" write changes: the scheduled meetings of the same series that start after this one and are not over.
 * A past meeting and a cancelled meeting stay as they are. A meeting in no series has none.
 */
function laterOf(ctx: Ctx, meeting: Meeting): Meeting[] {
  if (!meeting.seriesId) return [];
  const from = Date.parse(meeting.startsAt);
  return Object.values(meetingsOf(ctx.state))
    .filter((m) => m.seriesId === meeting.seriesId && m.id !== meeting.id && Date.parse(m.startsAt) > from && m.status === 'scheduled' && phaseOf(m, ctx.now) !== 'done')
    .sort(byStart);
}

/** True when the patch that an event holds moves the meeting for a calendar: the start, the end or the place. */
const movesCalendar = (event: { after: unknown } | null): boolean =>
  event !== null && Object.keys((event.after ?? {}) as object).some((key) => key === 'startsAt' || key === 'endsAt' || key === 'where');

/**
 * The attendees, checked. The organizer and a repeated person drop out of the attendees. An attendee is an active person, never an
 * agent. A person who is on the list already may have left since, so only a new person must be active.
 */
function checkPeople(ctx: Ctx, organizerId: string, attendeeIds: readonly string[], already: readonly string[] = [], projectId: string | null = null): string[] {
  const attendees = [...new Set(attendeeIds)].filter((id) => id !== organizerId);
  for (const id of attendees.filter((one) => !already.includes(one))) {
    assertActive(ctx, id, 'attendeeIds');
    if (requireUser(ctx, id).kind === 'agent') throw invalid('attendeeIds', 'An agent cannot attend a meeting. Choose a person.', 'attendee_agent');
    // The people of a project meeting must see the project (hidden projects, owner 2026-10-22), or the invitation would show them a meeting
    // that they could not read.
    const project = projectId === null ? undefined : ctx.state.projects[projectId];
    if (project && !mayViewProject(ctx.state, project, ctx.state.users[id])) {
      throw invalid('attendeeIds', 'This person does not see the project of the meeting. Choose a person who sees it.', 'not_in_project_audience');
    }
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
    assertCan(ctx, 'meeting.plan', { meeting: people });
    return;
  }
  const project = requireProject(ctx, projectId);
  assertCan(ctx, 'meeting.plan', { projectRole: roleIn(ctx, projectId), meeting: people });
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
    /** Every day (Sunday to Thursday), every week or every 2 weeks, up to the day "until" (wave 3). Madar makes the first 8 meetings. */
    repeat: MeetingRepeat.nullable().optional(),
  }),
  output: MeetingDetail,
  run(input, ctx) {
    const projectId = input.projectId ?? null;
    assertMayPlan(ctx, projectId);
    checkTitle(input.title);
    const startsAt = checkStart(input.startsAt, ctx.now);
    const repeat = input.repeat ? { every: input.repeat.every, until: input.repeat.until } : null;
    const firstDay = dayOf({ startsAt });
    if (repeat) checkRepeat(repeat, firstDay);
    const defaults = kindDefaults(input.kind);
    const minutes = input.durationMin ?? defaults.durationMin;
    const organizerId = ctx.authority.id;
    const attendeeIds = checkPeople(ctx, organizerId, input.attendeeIds ?? [], [], projectId);
    const id = nextId(ctx.state, 'mtg');
    const meeting: Meeting = {
      id, kind: input.kind, title: input.title, projectId, startsAt, endsAt: addMinutes(startsAt, minutes),
      where: input.where ?? '', guests: input.guests ?? '', notes: input.notes ?? '', organizerId, attendeeIds,
      status: 'scheduled', rev: 1, ...(repeat ? { seriesId: id, repeat } : {}), createdBy: ctx.actor.id, createdAt: ctx.stamp,
    };
    meetingsOf(ctx.state)[id] = meeting;
    const created = recordCreate(ctx, { projectId, verb: 'meeting.created', targetType: 'meeting', targetId: id, entity: meeting });
    if (repeat) {
      // The next meetings of the series, one row for each. Their events are not in the project feed (one line is enough), and each one
      // names the first as its cause. All of them are in the story of this call, so one Undo takes the whole series back.
      const clock = clockOf(startsAt);
      for (const day of occurrencesOf(repeat, firstDay, firstDay, SERIES_AHEAD - 1)) {
        const next: Meeting = { ...structuredClone(meeting), id: nextId(ctx.state, 'mtg'), startsAt: stampOn(day, clock) };
        next.endsAt = addMinutes(next.startsAt, minutes);
        meetingsOf(ctx.state)[next.id] = next;
        recordCreate(ctx, { projectId, verb: 'meeting.added', targetType: 'meeting', targetId: next.id, causeEventId: created.id, entity: next });
      }
    }
    // One notice for the whole series (owner, 2026-10-19): the dedupe key holds the series.
    tell(ctx, meeting, attendeeIds, 'new', repeat ? `meeting_invited:${id}` : undefined);
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
    scope: Scope.optional(),
  }),
  output: MeetingDetail,
  run(input, ctx) {
    const meeting = requireMeeting(ctx, input.id);
    assertMayEdit(ctx, meeting);
    if (meeting.status === 'cancelled') throw conflict('This meeting is cancelled. It cannot change.', 'meeting_cancelled');
    const later = input.scope === 'later' && meeting.seriesId ? laterOf(ctx, meeting) : [];
    // A meeting stays in its project, or stays private. A call may repeat the project that the meeting has.
    if (input.projectId !== undefined && input.projectId !== meeting.projectId) {
      throw invalid('projectId', 'A meeting stays in its project. Cancel it and plan a new one.', 'project_fixed');
    }
    if (input.title !== undefined) checkTitle(input.title);
    const startsAt = input.startsAt === undefined ? meeting.startsAt : checkStart(input.startsAt, ctx.now, meeting.startsAt);
    // The time of day applies to the later meetings, each on its own day. A new day would put them all on one day, so it is for one meeting.
    if (input.scope === 'later' && meeting.seriesId && dayOf({ startsAt }) !== dayOf(meeting)) {
      throw invalid('startsAt', 'A change for this and later meetings keeps the day. Move one meeting to another day at a time.', 'series_day_one_only');
    }
    const endsAt = input.startsAt === undefined && input.durationMin === undefined
      ? meeting.endsAt
      : addMinutes(startsAt, input.durationMin ?? minutesBetween(meeting.startsAt, meeting.endsAt));
    const attendeeIds = input.attendeeIds !== undefined ? checkPeople(ctx, meeting.organizerId, input.attendeeIds, meeting.attendeeIds, meeting.projectId) : meeting.attendeeIds;
    const next: Partial<Meeting> = {
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      startsAt, endsAt,
      ...(input.where !== undefined ? { where: input.where } : {}),
      ...(input.guests !== undefined ? { guests: input.guests } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      attendeeIds,
    };
    const changed = (Object.keys(next) as (keyof Meeting)[]).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(meeting[key]));
    // After the end only the notes change: the day, the place and the people are history (owner, 2026-10-19).
    if (phaseOf(meeting, ctx.now) === 'done' && changed.some((key) => key !== 'notes')) {
      throw conflict('This meeting is over. Only its notes change.', 'meeting_over');
    }
    const wasOn = [...meeting.attendeeIds];
    // What a "later" write gives the other meetings, worked out before the patch changes this meeting: a new time of day, a new
    // length, and the fields that this change moved. A field that did not change here stays as each later meeting has it.
    const clockChanged = clockOf(startsAt) !== clockOf(meeting.startsAt);
    const lengthChanged = input.durationMin !== undefined && input.durationMin !== minutesBetween(meeting.startsAt, meeting.endsAt);
    const event = applyPatch(ctx, meeting, Object.fromEntries(changed.map((key) => [key, next[key]])) as Partial<Meeting>, {
      projectId: meeting.projectId, verb: 'meeting.updated', targetType: 'meeting', targetId: meeting.id,
    });
    // rev is not in the event: an Undo brings the time or the place back and raises rev again (history.ts), so it never goes down.
    const moved = changed.some((key) => key === 'startsAt' || key === 'endsAt' || key === 'where');
    if (event && moved) meeting.rev += 1;
    if (event) {
      for (const other of later) {
        const patch: Partial<Meeting> = Object.fromEntries(changed.filter((key) => key !== 'startsAt' && key !== 'endsAt').map((key) => [key, next[key]]));
        if (clockChanged || lengthChanged) {
          const start = clockChanged ? stampOn(dayOf(other), clockOf(startsAt)) : other.startsAt;
          patch.startsAt = start;
          patch.endsAt = addMinutes(start, lengthChanged ? (input.durationMin as number) : minutesBetween(other.startsAt, other.endsAt));
        }
        const done = applyPatch(ctx, other, patch, {
          projectId: other.projectId, verb: 'meeting.series_updated', targetType: 'meeting', targetId: other.id, causeEventId: event.id,
        });
        if (movesCalendar(done)) other.rev += 1;
      }
    }
    // A person added to the list hears "new". The people who stay hear "moved" when the day, the time or the place changes: the
    // attendees, and the organizer when another person moved it. A person taken off hears nothing.
    const added = meeting.attendeeIds.filter((id) => !wasOn.includes(id));
    if (moved) tell(ctx, meeting, [meeting.organizerId, ...meeting.attendeeIds].filter((id) => !added.includes(id)), 'moved');
    tell(ctx, meeting, added, 'new');
    return meetingDetailOf(ctx.state, meeting, ctx.authority, ctx.now);
  },
});

const meetingsCancel = defineCall({
  input: z.object({ id: MeetingId, scope: Scope.optional() }),
  output: MeetingDetail,
  run(input, ctx) {
    const meeting = requireMeeting(ctx, input.id);
    assertMayEdit(ctx, meeting);
    // A second cancel changes nothing and writes no event.
    if (meeting.status === 'cancelled') return meetingDetailOf(ctx.state, meeting, ctx.authority, ctx.now);
    if (phaseOf(meeting, ctx.now) === 'done') throw conflict('This meeting is over. It cannot be cancelled.', 'meeting_over');
    const later = input.scope === 'later' && meeting.seriesId ? laterOf(ctx, meeting) : [];
    // A cancel for "this and later meetings" is the choice of the person to stop the series here (owner, 2026-10-23): the rule of the series
    // records it. Every meeting of the series that the person sees, the earlier ones too (cancelled or not), gets the last day "the day before
    // this meeting". An earlier last day stays. Madar never ends or restarts a series by itself.
    const dayBefore = addDays(dayOf(meeting), -1);
    const ended = (m: Meeting): { repeat?: MeetingRepeat } => {
      if (input.scope !== 'later' || !m.repeat) return {};
      return { repeat: { every: m.repeat.every, until: m.repeat.until !== null && m.repeat.until < dayBefore ? m.repeat.until : dayBefore } };
    };
    const event = applyPatch(ctx, meeting, { status: 'cancelled', ...ended(meeting) }, { projectId: meeting.projectId, verb: 'meeting.cancelled', targetType: 'meeting', targetId: meeting.id });
    meeting.rev += 1;
    for (const other of later) {
      applyPatch(ctx, other, { status: 'cancelled', ...ended(other) }, {
        projectId: other.projectId, verb: 'meeting.series_cancelled', targetType: 'meeting', targetId: other.id, ...(event ? { causeEventId: event.id } : {}),
      });
      other.rev += 1;
    }
    if (input.scope === 'later' && meeting.seriesId) {
      const changed = new Set([meeting.id, ...later.map((m) => m.id)]);
      for (const kept of Object.values(meetingsOf(ctx.state)).filter((m) => m.seriesId === meeting.seriesId && !changed.has(m.id) && mayViewMeeting(ctx.state, ctx.authority, m)).sort(byStart)) {
        applyPatch(ctx, kept, ended(kept), {
          projectId: kept.projectId, verb: 'meeting.series_updated', targetType: 'meeting', targetId: kept.id, ...(event ? { causeEventId: event.id } : {}),
        });
      }
    }
    tell(ctx, meeting, [meeting.organizerId, ...meeting.attendeeIds], 'cancelled');
    return meetingDetailOf(ctx.state, meeting, ctx.authority, ctx.now);
  },
});

/**
 * Deletes a cancelled meeting (owner, 2026-10-23). The right is the right to change the meeting. A meeting that is not cancelled stays
 * (`meeting_not_cancelled`). One event `meeting.deleted` keeps the whole record in `before`, so the Undo of the toast brings the meeting
 * back. With the scope "later" it deletes this meeting and every later meeting of the same series that is cancelled and that the person
 * sees, never a scheduled one. It tells nobody: the cancel told the attendees, and a notice of a deleted meeting reads as gone.
 * A delete changes no repeat rule: the users decide if a meeting repeats, not the platform (owner, 2026-10-23). The cancel for "this and
 * later meetings" already recorded the last day of the series on every meeting.
 */
const meetingsDelete = defineCall({
  input: z.object({ id: MeetingId, scope: Scope.optional() }),
  output: z.object({ deleted: z.number().int().min(1) }),
  run(input, ctx) {
    const meeting = requireMeeting(ctx, input.id);
    assertMayEdit(ctx, meeting);
    if (meeting.status !== 'cancelled') throw conflict('Only a cancelled meeting can be deleted. Cancel it first.', 'meeting_not_cancelled');
    const from = Date.parse(meeting.startsAt);
    const later = input.scope === 'later' && meeting.seriesId
      ? Object.values(meetingsOf(ctx.state))
        .filter((m) => m.seriesId === meeting.seriesId && m.id !== meeting.id && Date.parse(m.startsAt) > from && m.status === 'cancelled' && mayViewMeeting(ctx.state, ctx.authority, m))
        .sort(byStart)
      : [];
    const first = recordDelete(ctx, { projectId: meeting.projectId, verb: 'meeting.deleted', targetType: 'meeting', targetId: meeting.id, entity: meeting });
    delete meetingsOf(ctx.state)[meeting.id];
    for (const other of later) {
      recordDelete(ctx, { projectId: other.projectId, verb: 'meeting.deleted', targetType: 'meeting', targetId: other.id, entity: other, causeEventId: first.id });
      delete meetingsOf(ctx.state)[other.id];
    }
    return { deleted: 1 + later.length };
  },
});

/**
 * The one settle rule (fbk_022, wave 2). Madar marks the meeting as over (meeting.settled, once, never undone) and, for a project meeting
 * that is not a team meeting, makes its Tracker line with no minutes yet. The line names the mark as its cause, so the History shows that
 * Madar made it because the meeting ended. No notice, no push and no mail. The caller checks that the meeting is scheduled, over and
 * not settled yet.
 */
export function settleMeeting(ctx: Ctx, meeting: Meeting, o: { ownStory?: boolean } = {}): void {
  // A call that settles on the way (the minutes) gives the mark and the line a story of their own. An Undo of that call then takes back
  // the minutes only: the mark has no Undo, and it would refuse the whole story.
  const sc: Ctx = o.ownStory ? { ...ctx, correlationId: `cor_settle_${meeting.id}` } : ctx;
  // The id of the line comes first, so the mark can hold it and the line can name the mark.
  const lineId = hasTrackerLine(meeting) ? nextId(sc.state, 'trk') : null;
  const mark = applyPatch(
    sc, meeting, { settledAt: sc.stamp, ...(lineId ? { trackerEntryId: lineId } : {}) },
    { projectId: meeting.projectId, verb: 'meeting.settled', targetType: 'meeting', targetId: meeting.id },
  );
  if (lineId === null || meeting.projectId === null) return;
  // The author of the line is the organizer, whoever settles: the 15-minute job, the first minutes save, or any person who sees the
  // meeting (security fix, 2026-10-19). So the person who settles gets no author rights on the line (mayDeleteTracker).
  addTrackerEntry(sc, {
    id: lineId, projectId: meeting.projectId, type: 'meeting', direction: 'both', title: meeting.title, note: meeting.notes, date: dayOf(meeting),
    peopleIds: [meeting.organizerId, ...meeting.attendeeIds].slice(0, 20), auto: 'meeting', meetingId: meeting.id, createdBy: meeting.organizerId,
    ...(mark ? { causeEventId: mark.id } : {}),
  });
}

/** The meetings that the job settles at this moment: scheduled, not settled, ended in the last 14 days. By end, then id. */
export function dueToSettle(state: State, at: Date): Meeting[] {
  const now = at.getTime();
  const oldest = now - SETTLE_BACK_DAYS * 24 * 60 * 60_000;
  return Object.values(meetingsOf(state))
    .filter((m) => m.status === 'scheduled' && !m.settledAt && Date.parse(m.endsAt) <= now && Date.parse(m.endsAt) >= oldest)
    .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The series that the prototype timer extends (the prototype has no job). The same rule as the read of the job (server/jobs/steps/meetings.ts):
 * a series whose last meeting starts today or later, with fewer than SERIES_AHEAD scheduled meetings that are not over,
 * and a day left in its rule, and whose project (if any) is active or paused. The fewest ahead first, then by series, at most 20.
 */
export function seriesToExtend(state: State, at: Date): string[] {
  const today = todayISO(at);
  const bySeries = new Map<string, Meeting[]>();
  for (const m of Object.values(meetingsOf(state))) {
    if (m.seriesId && dayOf(m) >= today) bySeries.set(m.seriesId, [...(bySeries.get(m.seriesId) ?? []), m]);
  }
  const short: { seriesId: string; ahead: number }[] = [];
  for (const [seriesId, list] of bySeries) {
    const last = [...list].sort(byStart).at(-1) as Meeting;
    if (!last.repeat || (last.projectId !== null && !seriesProjectIsOpen(state, last.projectId))) continue;
    const ahead = list.filter((m) => m.status === 'scheduled' && phaseOf(m, at) !== 'done').length;
    if (ahead >= SERIES_AHEAD || occurrencesOf(last.repeat, dayOf(last), maxDay(dayOf(last), today), 1).length === 0) continue;
    short.push({ seriesId, ahead });
  }
  return short.sort((a, b) => a.ahead - b.ahead || (a.seriesId < b.seriesId ? -1 : a.seriesId > b.seriesId ? 1 : 0)).slice(0, 20).map((one) => one.seriesId);
}

const meetingsSettle = defineCall({
  input: z.object({ id: MeetingId }),
  output: z.object({ settledAt: Stamp.nullable(), trackerEntryId: TrackerId.nullable() }),
  run(input, ctx) {
    const meeting = requireMeeting(ctx, input.id);
    // Before the end, for a cancelled meeting and after the first settle, the call writes nothing and gives the stored values.
    if (meeting.status === 'scheduled' && !meeting.settledAt && phaseOf(meeting, ctx.now) === 'done') settleMeeting(ctx, meeting);
    return { settledAt: meeting.settledAt ?? null, trackerEntryId: meeting.trackerEntryId ?? null };
  },
});

/** True while the project of a series is active or paused. A series of a completed or archived project is not extended. */
const seriesProjectIsOpen = (state: State, projectId: string): boolean => {
  const project = state.projects[projectId];
  return project !== undefined && isLive(project.status);
};

/**
 * Keeps a series full (fbk_022, wave 3; the 15-minute job and the prototype timer call it, as they call meetings.settle). It adds meetings
 * after the last one until SERIES_AHEAD scheduled meetings are ahead (a meeting that is not over counts), or until the last day of the rule.
 * It adds by the rule only: a cancelled last meeting does not end a series, because the users decide if a meeting repeats, not the platform
 * (owner, 2026-10-23); a cancel for "this and later meetings" records the last day on the series. The new meetings copy the last one (title,
 * place, people, length, time of day) and start the day after it, or after today when the series ran dry. One mark, meeting.extended, names
 * the series; each new meeting has the event meeting.added with that mark as its cause. No notice: the people heard of the series when it
 * was planned. A second call adds nothing. The call counts every meeting of the series, also those that the caller does not see, and the
 * caller must see the last one and may change it (the organizer, or the leader and the Admin of a project meeting; review 2026-10-20):
 * a person taken off the later meetings, or an attendee who only reads them, never adds meetings from the ones they still see.
 */
const meetingsExtend = defineCall({
  input: z.object({ seriesId: MeetingId }),
  output: z.object({ added: z.number().int().min(0) }),
  run(input, ctx) {
    // The meetings from today on are the ones that matter (the loader reads the same window): the last one and the ones ahead.
    const rows = Object.values(meetingsOf(ctx.state))
      .filter((m) => m.seriesId === input.seriesId && dayOf(m) >= ctx.today)
      .sort(byStart);
    const last = rows[rows.length - 1];
    // A series that the caller cannot see reads as missing, with the text of an unknown id.
    if (!last || !mayViewMeeting(ctx.state, ctx.authority, last)) throw notFound('Meeting', input.seriesId);
    assertMayEdit(ctx, last);
    if (!last.repeat) return { added: 0 };
    // A project that is completed or archived holds no new meeting: its series stops (a paused project goes on).
    if (last.projectId !== null && !seriesProjectIsOpen(ctx.state, last.projectId)) return { added: 0 };
    const ahead = rows.filter((m) => m.status === 'scheduled' && phaseOf(m, ctx.now) !== 'done').length;
    const lastDay = dayOf(last);
    const days = occurrencesOf(last.repeat, lastDay, maxDay(lastDay, ctx.today), SERIES_AHEAD - ahead);
    if (days.length === 0) return { added: 0 };
    const mark = writeEvent(ctx, {
      projectId: last.projectId, verb: 'meeting.extended', targetType: 'meeting', targetId: last.id, before: { ahead }, after: { ahead: ahead + days.length },
    });
    const clock = clockOf(last.startsAt);
    const minutes = minutesBetween(last.startsAt, last.endsAt);
    for (const day of days) {
      const startsAt = stampOn(day, clock);
      const id = nextId(ctx.state, 'mtg');
      const next: Meeting = {
        id, kind: last.kind, title: last.title, projectId: last.projectId, startsAt, endsAt: addMinutes(startsAt, minutes), where: last.where, guests: last.guests,
        notes: last.notes, organizerId: last.organizerId, attendeeIds: [...last.attendeeIds], status: 'scheduled', rev: 1, seriesId: last.seriesId,
        repeat: { every: last.repeat.every, until: last.repeat.until }, createdBy: ctx.actor.id, createdAt: ctx.stamp,
      };
      meetingsOf(ctx.state)[id] = next;
      recordCreate(ctx, { projectId: next.projectId, verb: 'meeting.added', targetType: 'meeting', targetId: id, causeEventId: mark.id, entity: next });
    }
    return { added: days.length };
  },
});

const Minutes = {
  id: MeetingId,
  /** Trimmed, with the line breaks inside kept. Empty text with no files clears the minutes. */
  text: z.string().trim().max(L.minutesMax),
  fileIds: z.array(FileId).max(MAX_ATTACHMENTS).default([]),
  /**
   * The value of updatedAt that the screen opened, or null for no minutes yet. A save with another value is refused (minutes_changed), so a
   * person never replaces what another attendee wrote since. Left out: no check.
   */
  since: Stamp.nullable().optional(),
};

const sameMinutes = (a: MeetingMinutes | null, b: MeetingMinutes | null): boolean =>
  (a === null && b === null) || (a !== null && b !== null && a.text === b.text && JSON.stringify(a.fileIds) === JSON.stringify(b.fileIds));

/**
 * Any attendee writes the minutes (fbk_022, wave 2, owner 2026-10-19). One text with files, replaced as a whole. A project meeting that is
 * not a team meeting keeps them on its Tracker line; every other meeting keeps them on the meeting. The rights and the phase come from
 * minutesRefusal. A meeting with a Tracker line that the job did not settle yet is settled in this call, so the person never waits for the job.
 * One event (tracker.minutes_saved, or meeting.minutes_saved), and no notice, no push and no badge. The same text and files write nothing.
 */
const meetingsSaveMinutes = defineCall({
  input: z.object(Minutes),
  output: MeetingDetail,
  run(input, ctx) {
    const meeting = requireMeeting(ctx, input.id);
    const refusal = minutesRefusal(ctx.state, meeting, ctx.authority, ctx.now);
    if (refusal) throw refusal;
    if (meeting.projectId === null) assertFilesForMeeting(ctx, input.fileIds, meeting.id);
    else assertFilesInProject(ctx, input.fileIds, meeting.projectId);
    if (hasTrackerLine(meeting) && !meeting.settledAt) settleMeeting(ctx, meeting, { ownStory: true });
    const held = minutesOf(ctx.state, meeting);
    if (held.place === null) throw conflict('This meeting is cancelled. It has no minutes.', 'meeting_cancelled');
    if (input.since !== undefined && input.since !== (held.minutes?.updatedAt ?? null)) {
      throw conflict('Someone saved the minutes after you opened them. Copy your text, then open them again.', 'minutes_changed');
    }
    const next: MeetingMinutes | null = input.text === '' && input.fileIds.length === 0
      ? null
      : { text: input.text, fileIds: input.fileIds, updatedBy: ctx.authority.id, updatedAt: ctx.stamp };
    if (!sameMinutes(held.minutes, next)) {
      if (held.entry) {
        applyPatch(ctx, held.entry, { minutes: next }, { projectId: held.entry.projectId, verb: 'tracker.minutes_saved', targetType: 'tracker', targetId: held.entry.id });
        touch(ctx, held.entry.projectId);
      } else {
        applyPatch(ctx, meeting, { minutes: next }, { projectId: meeting.projectId, verb: 'meeting.minutes_saved', targetType: 'meeting', targetId: meeting.id });
      }
    }
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
  'meetings.delete': meetingsDelete,
  'meetings.settle': meetingsSettle,
  'meetings.extend': meetingsExtend,
  'meetings.saveMinutes': meetingsSaveMinutes,
};
