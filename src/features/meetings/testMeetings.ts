import type { Meeting } from '../../api/contract/entities';
import { meetingsOf, type State } from '../../api/store';

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
