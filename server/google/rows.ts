import type { User } from '../../src/api/contract/entities';
import type { OutboxRow } from '../core/effects';
import type { Query } from '../core/ports';
import type { SaveResult } from '../data/save';
import { eventPairsOf, liveConnection, meetingsOf, syncingPeople } from './store';

/**
 * The outbox rows of the Google Calendar sync (fbk_022): the producers that runCall asks after the save of GCAL_CALLS and of
 * users.remove. They run inside the transaction of the call, so a rollback writes no row.
 */

export const SYNC_EFFECT = 'gcal.sync';
export const REVOKE_EFFECT = 'gcal.revoke';

/**
 * One gcal.sync { userId, meetingId } for each pair: a person with a live connection (ok or not_synced) who is now the organizer or an
 * attendee of a meeting that the save inserted or changed, plus each person who has a Google event for a meeting that the save inserted,
 * changed or deleted (a person taken off, a cancelled or deleted meeting). It asks the database only when the save touched a meeting.
 */
export async function gcalRows(q: Query, saved: Pick<SaveResult, 'meetingIds'>): Promise<OutboxRow[]> {
  const ids = saved.meetingIds ?? [];
  if (ids.length === 0) return [];
  const meetings = await meetingsOf(q, ids);
  const people = [...new Set(meetings.flatMap((meeting) => [meeting.organizerId, ...meeting.attendeeIds]))].sort();
  const syncing = new Set(await syncingPeople(q, people));
  const pairs = new Map<string, { userId: string; meetingId: string }>();
  const add = (userId: string, meetingId: string) => pairs.set(`${meetingId}|${userId}`, { userId, meetingId });
  for (const meeting of meetings) {
    for (const userId of [meeting.organizerId, ...meeting.attendeeIds]) if (syncing.has(userId)) add(userId, meeting.id);
  }
  for (const pair of await eventPairsOf(q, ids)) add(pair.userId, pair.meetingId);
  return [...pairs.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, payload]) => ({ kind: SYNC_EFFECT, payload }));
}

/** One gcal.revoke for the live connection of a person who was removed (the output of users.remove is the User). */
export async function revokeRowsOf(q: Query, removed: Pick<User, 'id'>): Promise<OutboxRow[]> {
  const connection = await liveConnection(q, removed.id);
  return connection ? [{ kind: REVOKE_EFFECT, payload: { connectionId: connection.id } }] : [];
}
