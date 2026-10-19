import { MEETING_LIMITS, type MeetingKindName } from '../api/contract/limits';
import { nowStamp, stampDay } from './dates';

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

/** The length of a new meeting, and whether its organizer writes the minutes by default. A team meeting has no minutes by default. */
export function kindDefaults(kind: MeetingKindName): { durationMin: number; minutesByOrganizer: boolean } {
  switch (kind) {
    case 'team':
      return { durationMin: 30, minutesByOrganizer: false };
    case 'site_visit':
      return { durationMin: 120, minutesByOrganizer: true };
    default:
      return { durationMin: 60, minutesByOrganizer: true };
  }
}

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
