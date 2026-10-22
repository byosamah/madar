import type { User } from '../../src/api/contract/entities';
import type { OutboxRow } from '../core/effects';
import type { Query } from '../core/ports';
import type { SaveResult } from '../data/save';
import { deleteEventsOfUser, eventPairsOf, forgetCalendar, meetingIdsOfProjects, meetingsOf, projectEventPairs, startRevoking, syncingPeople } from './store';

/**
 * The outbox rows of the Google Calendar sync (fbk_022): the producers that runCall asks after the save of GCAL_CALLS and of
 * users.remove. They run inside the transaction of the call, so a rollback writes no row.
 */

export const SYNC_EFFECT = 'gcal.sync';
export const REVOKE_EFFECT = 'gcal.revoke';
/** The tidy of a calendar that a new connect reuses (payload { userId }): it takes away the stale events of Madar. */
export const TIDY_EFFECT = 'gcal.tidy';

/**
 * One gcal.sync { userId, meetingId } for each pair: a person with a live connection (ok or not_synced) who is now the organizer or an
 * attendee of a meeting that the save inserted or changed, plus each person who has a Google event for a meeting that the save inserted,
 * changed or deleted (a person taken off, a cancelled or deleted meeting). It asks the database only when the save touched a meeting.
 *
 * A save that touched a project that not every active person views (hidden projects, owner 2026-10-22: a change of who sees the project, a
 * person taken off the team, a new leader) also names the scheduled meetings of that project, with the meetings it touched: gcal.sync
 * checks again whether each person still views the project, and takes the Google event away when the person does not.
 */
export async function gcalRows(q: Query, saved: Pick<SaveResult, 'meetingIds' | 'hiddenProjects'>): Promise<OutboxRow[]> {
  // The meetings that the save touched, and the meetings of the projects that not every active person views and that it touched.
  const ids = [...new Set([...(saved.meetingIds ?? []), ...((saved.hiddenProjects?.length ?? 0) > 0 ? await meetingIdsOfProjects(q, saved.hiddenProjects!) : [])])];
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

/**
 * The producer of the calls that change who views a project through a role (hidden projects, owner 2026-10-22): roles.update, roles.delete and
 * users.update. A role that loses "See every project", a person who moves to another role, and a role that is deleted with a move can take the view
 * of an open project from people. The wide road: one gcal.sync { userId, meetingId } for each Google event row of a meeting of a project (of
 * the one person for users.update, of everyone for a role call), so gcal.sync checks the view again and takes the event away when the person no
 * longer views the project. A person with no event row of a project meeting costs nothing.
 */
export async function gcalViewRows(q: Query, userId?: string): Promise<OutboxRow[]> {
  const pairs = await projectEventPairs(q, userId);
  return pairs
    .sort((a, b) => (`${a.meetingId}|${a.userId}` < `${b.meetingId}|${b.userId}` ? -1 : 1))
    .map((payload) => ({ kind: SYNC_EFFECT, payload }));
}

/**
 * The producer of users.remove (the output is the User): in the transaction of the call, the live connection of the person becomes
 * revoking (at the time of the call) and the Google events of the person are deleted, then one gcal.revoke row goes out for it. So a
 * revoke that fails, or a Google that never answers, leaves no live token of a removed person: the cleanup step deletes a revoking row
 * after one day (security fix, 2026-10-19). A person who is only turned off keeps the connection (decision 11 of the plan). The same
 * transaction deletes the remembered calendar id of the person (google_calendars): a disconnect keeps it, a removal does not.
 */
export async function revokeRowsOf(q: Query, removed: Pick<User, 'id'>, at: Date): Promise<OutboxRow[]> {
  const ids = await startRevoking(q, removed.id, at);
  await deleteEventsOfUser(q, removed.id);
  await forgetCalendar(q, removed.id);
  return ids.map((connectionId) => ({ kind: REVOKE_EFFECT, payload: { connectionId } }));
}
