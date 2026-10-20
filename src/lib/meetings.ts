import { MEETING_LIMITS, type MeetingKindName } from '../api/contract/limits';
import { addDays, diffDays, nowStamp, stampDay } from './dates';
import { isWorkingDay } from './workdays';

/**
 * The plain rules of a meeting (fbk_022). The screens and the handlers share them. Time is office time (+03:00, the same all year),
 * and a meeting starts on a multiple of 5 minutes.
 */

export type MeetingPhase = 'upcoming' | 'now' | 'done' | 'cancelled';

type Timed = { startsAt: string; endsAt: string };

/** The office day of the start of a meeting. A start at 23:30 Riyadh is on that day, whatever offset the stamp has. */
export function dayOf(meeting: Pick<Timed, 'startsAt'>): string {
  return stampDay(meeting.startsAt);
}

/** Where a meeting is in time. A cancelled meeting is "cancelled" at any time. The end itself counts as done. */
export function phaseOf(meeting: Timed & { status: 'scheduled' | 'cancelled' }, at: Date): MeetingPhase {
  if (meeting.status === 'cancelled') return 'cancelled';
  const time = at.getTime();
  if (time >= Date.parse(meeting.endsAt)) return 'done';
  if (time >= Date.parse(meeting.startsAt)) return 'now';
  return 'upcoming';
}

/** The length of a new meeting in minutes, by its kind. */
export function kindDefaults(kind: MeetingKindName): { durationMin: number } {
  switch (kind) {
    case 'team':
      return { durationMin: 30 };
    case 'site_visit':
      return { durationMin: 120 };
    default:
      return { durationMin: 60 };
  }
}

/**
 * True when Madar makes a Tracker line for the meeting after its end, and keeps the minutes on that line (owner, 2026-10-19): a project
 * meeting that is not a team meeting. A team meeting never writes to the Tracker (owner, 2026-10-02), and a meeting with no project has
 * no Tracker. Those two keep their minutes on the meeting itself.
 */
export function hasTrackerLine(meeting: { projectId: string | null; kind: MeetingKindName }): boolean {
  return meeting.projectId !== null && meeting.kind !== 'team';
}

/** The job settles a meeting that ended in the last SETTLE_BACK_DAYS days. An older meeting waits for a person to open it. */
export const SETTLE_BACK_DAYS = 14;

/** The same moment as a stamp in office time (+03:00). Every stored stamp of a meeting has this form. */
export function officeStamp(stamp: string): string {
  return nowStamp(new Date(stamp));
}

/** The stamp that is a number of minutes after a stamp, in office time. */
export function addMinutes(stamp: string, minutes: number): string {
  return nowStamp(new Date(Date.parse(stamp) + minutes * 60_000));
}

/** The length of a meeting in minutes. */
export function minutesBetween(startsAt: string, endsAt: string): number {
  return Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000);
}

/** True when the stamp is on a multiple of 5 minutes, with no seconds. Offices of other zones count in office time. */
export function onFiveMinutes(stamp: string): boolean {
  const ms = Date.parse(officeStamp(stamp));
  return ms % 300_000 === 0;
}

/** The first moment that a new start may have: MEETING_LIMITS.pastDays days before now. */
export function earliestStart(at: Date): Date {
  return new Date(at.getTime() - MEETING_LIMITS.pastDays * 24 * 60 * 60_000);
}

/** The address that opens the sheet of a meeting on the Meetings view of Tasks (fbk_022). */
export function meetingLink(meetingId: string): string {
  return `/meetings?meeting=${meetingId}`;
}

/** A series keeps this many scheduled meetings ahead (fbk_022, wave 3). A new series makes this many, and the job adds the rest later. */
export const SERIES_AHEAD = 8;

/** The last day of a series is at most this many days after its first day. */
export const REPEAT_MAX_DAYS = 400;

type RepeatRule = { every: 'day' | 'week' | 'two_weeks'; until: string | null };

/**
 * The next days of a repeat rule after a day, at most "count" of them, in order (fbk_022, wave 3, owner 2026-10-19, Q7).
 * - "day" means every working day, Sunday to Thursday, whatever the first day is.
 * - "week" and "two_weeks" keep the weekday of "first", also a Friday: the days are first plus 7 or 14 days, again and again.
 * - Nothing after "until" (the last day, kept), and nothing at or before "after".
 */
export function occurrencesOf(rule: RepeatRule, first: string, after: string, count: number): string[] {
  const out: string[] = [];
  if (count <= 0) return out;
  const within = (day: string) => rule.until === null || day <= rule.until;
  if (rule.every === 'day') {
    // A working week has 5 days in 7, so a window of 2 weeks for each wanted day always ends this loop.
    for (let day = addDays(after, 1), left = count * 7 + 14; left > 0 && out.length < count && within(day); day = addDays(day, 1), left -= 1) {
      if (isWorkingDay(day)) out.push(day);
    }
    return out;
  }
  const step = rule.every === 'week' ? 7 : 14;
  // The first step that lands after "after". A day before "first" starts at "first" itself.
  const ahead = Math.max(0, Math.floor(diffDays(first, after) / step) + 1);
  for (let k = ahead; out.length < count; k += 1) {
    const day = addDays(first, k * step);
    if (!within(day)) break;
    out.push(day);
  }
  return out;
}

/** The time of day of a stamp in office time, as HH:MM. A stamp in another offset gives the office clock. */
export function clockOf(stamp: string): string {
  return officeStamp(stamp).slice(11, 16);
}

/** The stamp of a time of day (HH:MM) on an office day. */
export function stampOn(day: string, clock: string): string {
  return officeStamp(`${day}T${clock}:00+03:00`);
}
