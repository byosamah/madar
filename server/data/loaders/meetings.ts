import type { Meeting, TrackerEntry } from '../../../src/api/contract/entities';
import { MEETING_LIMITS } from '../../../src/api/contract/limits';
import { addDays, diffDays, todayISO } from '../../../src/lib/dates';
import type { Cond } from './query';
import type { Load } from './build';
import { attachedFiles } from './steps';

/**
 * The meeting loaders (fbk_022). A meeting is not an office list: a call reads the rows of its own window.
 *
 * The view rule of a meeting is can('meeting.view') in src/api/permissions.ts: everyone reads a project meeting, and a meeting with no
 * project is read by its organizer and its attendees only. The Admin has no extra view (owner, 2026-10-19). meetingConds is that rule
 * in SQL, and the handler checks it again on the rows.
 */

type Input = Record<string, unknown>;
const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** The meetings that the person of the call sees, as one condition. A person who is not in the office, or is off, sees none. */
export function meetingConds(L: Load): Cond[] {
  if (!L.authority || !L.authority.active) return [{ col: 'id', in: [] }];
  const me = L.authority.id;
  return [{ or: [{ col: 'project_id', in: Object.keys(L.office.projects) }, { col: 'organizer_id', in: [me] }, { has: 'attendeeIds', value: me }] }];
}

/** The meetings of the person (organizer or attendee), as one condition. */
export function mineConds(L: Load): Cond[] {
  if (!L.authority) return [{ col: 'id', in: [] }];
  return [{ or: [{ col: 'organizer_id', in: [L.authority.id] }, { has: 'attendeeIds', value: L.authority.id }] }];
}

/**
 * The meetings with no project that the person takes part in, whole. A change of such a meeting shows only to them, the Admin too
 * only when invited (owner, 2026-10-19), so events.list and the notices read this set (fbk_022).
 */
export async function privateMeetingsOf(L: Load): Promise<Meeting[]> {
  return (await L.select({ c: 'meetings', where: [{ col: 'project_id', eq: null }, ...mineConds(L)] })) as Meeting[];
}

/**
 * The rows that a meeting names (wave 2): its Tracker line, by id, and the files of its minutes (on the meeting, and on the line). The
 * minutes task is gone (owner, 2026-10-19), so no task is read.
 */
async function named(L: Load, meetings: readonly Meeting[]): Promise<void> {
  await L.byKey('tracker', meetings.map((meeting) => meeting.trackerEntryId));
  const lines = meetings.map((meeting) => L.get<TrackerEntry>('tracker', meeting.trackerEntryId)).filter((line): line is TrackerEntry => line !== undefined);
  await L.byKey('files', [...meetings.flatMap((meeting) => meeting.minutes?.fileIds ?? []), ...lines.flatMap((line) => line.minutes?.fileIds ?? [])]);
}

/** meetings.list: the meetings that the person sees, whose start day is in the window, narrowed as the handler narrows them. */
export async function meetingsList(L: Load, input: Input): Promise<void> {
  if (!L.authority || !L.now) return;
  const from = str(input.from) ?? todayISO(L.now);
  const to = str(input.to) ?? addDays(from, MEETING_LIMITS.listDefaultDays);
  // The handler refuses a window that ends first or runs too long, so there is nothing to read.
  if (diffDays(from, to) < 0 || diffDays(from, to) + 1 > MEETING_LIMITS.windowDaysMax) return;
  const where: Cond[] = [
    ...meetingConds(L),
    { col: 'starts_at', atOrAfter: `${from}T00:00:00.000+03:00` },
    { col: 'starts_at', atBefore: `${addDays(to, 1)}T00:00:00.000+03:00` },
  ];
  const projectId = str(input.projectId);
  if (projectId) where.push({ col: 'project_id', in: [projectId] });
  if (input.mine !== false) where.push(...mineConds(L));
  // A row of the list holds no minutes and no Tracker line, so nothing else is read.
  await L.select({ c: 'meetings', where });
}

/** meetings.get, meetings.update, meetings.cancel and meetings.settle: the meeting by id, and the records it names. */
export async function meetingCall(L: Load, input: Input): Promise<void> {
  const id = str(input.id);
  if (!id) return;
  await L.byKey('meetings', [id]);
  const meeting = L.get<Meeting>('meetings', id);
  if (meeting) await named(L, [meeting]);
}

/**
 * meetings.saveMinutes (wave 2): the meeting and what it names, and the files that the new minutes carry (a file of a meeting with no
 * project brings its meeting, the view rule of a file reads it).
 */
export async function meetingMinutes(L: Load, input: Input): Promise<void> {
  await meetingCall(L, input);
  await attachedFiles(L, (input.fileIds as string[] | undefined) ?? []);
}
