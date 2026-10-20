import type { Meeting, MeetingMinutes, TrackerEntry } from '../../api/contract/entities';
import { meetingsOf, trackerOf, type State } from '../../api/store';

/**
 * A meeting for the screen tests (fbk_022). The test office has "now" at 2026-09-30 09:00 in Riyadh (a Wednesday). In the sample
 * office usr_002 (Faisal) leads prj_001 with the team usr_005, usr_006 and usr_008, and usr_001 (Hala) is the Admin.
 * By default the meeting is a client meeting of prj_001 today at 14:00, organized by Faisal.
 */
export function withMeeting(state: State, over: Partial<Meeting> & { id: string }): void {
  meetingsOf(state)[over.id] = {
    kind: 'client', title: 'Review the facade', projectId: 'prj_001', startsAt: '2026-09-30T14:00:00.000+03:00', endsAt: '2026-09-30T15:00:00.000+03:00',
    where: '', guests: '', notes: '', organizerId: 'usr_002', attendeeIds: [], status: 'scheduled', rev: 1,
    createdBy: 'usr_002', createdAt: '2026-09-29T09:00:00.000+03:00', ...over,
  };
  state.counters.mtg = Math.max(state.counters.mtg ?? 0, Number(over.id.slice(4)));
}

/** Makes a person the current person of the test office. */
export const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

/** A meeting that ended yesterday in the test office, 14:00 to 15:00. "Now" is Wednesday 2026-09-30 09:00 in Riyadh. */
export const ENDED = { startsAt: '2026-09-29T14:00:00.000+03:00', endsAt: '2026-09-29T15:00:00.000+03:00' } as const;

/** The minutes of a test, written by Faisal (usr_002) the day after the meeting ended. */
export const SOME_MINUTES: MeetingMinutes = {
  text: 'We agreed on the facade.\nFaisal sends the drawings on Sunday.', fileIds: [], updatedBy: 'usr_002', updatedAt: '2026-09-29T16:00:00.000+03:00',
};

/**
 * The Tracker line that Madar makes for a project meeting that ended (wave 2): trk_900, of meeting mtg_001. The meeting gets its mark
 * and names the line. Call it after withMeeting.
 */
export function withLine(state: State, over: Partial<TrackerEntry> = {}): void {
  trackerOf(state).trk_900 = {
    id: 'trk_900', projectId: 'prj_001', type: 'meeting', direction: 'both', title: 'Review the facade', note: '', date: '2026-09-29', waiting: null, closedAt: null,
    closedBy: null, fileIds: [], peopleIds: ['usr_002', 'usr_005'], auto: 'meeting', createdBy: 'usr_002', createdAt: '2026-09-29T15:05:00.000+03:00',
    meetingId: 'mtg_001', minutes: null, ...over,
  };
  Object.assign(meetingsOf(state).mtg_001, { settledAt: '2026-09-29T15:05:00.000+03:00', trackerEntryId: 'trk_900' });
}


/**
 * A weekly series of "count" meetings (wave 3): mtg_001 is the first, today at 14:00 in the test office, and each next one is a week later.
 * "Now" is Wednesday 2026-09-30 09:00, so the first is today. Each meeting has the same title, rule and series.
 */
export function withSeries(state: State, count = 4, over: Partial<Meeting> = {}, every: 'day' | 'week' | 'two_weeks' = 'week'): void {
  const days = ['2026-09-30', '2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04', '2026-11-11', '2026-11-18'];
  for (let n = 0; n < count; n += 1) {
    withMeeting(state, {
      id: `mtg_${String(n + 1).padStart(3, '0')}`, startsAt: `${days[n]}T14:00:00.000+03:00`, endsAt: `${days[n]}T15:00:00.000+03:00`,
      seriesId: 'mtg_001', repeat: { every, until: null }, ...over,
    });
  }
}
