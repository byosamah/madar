import type { Meeting } from '../../src/api/contract/entities';
import type { Deps, Query } from '../core/ports';
import { statementQuery } from '../data/dialect';
import { deleteEvent, GoogleError, insertEvent, patchEvent, refreshAccess, revokeToken, updateEvent, type EventBody, type GoogleClient } from './api';
import { googleOf, type GoogleReady } from './client';
import { openToken, SealBroken } from './keys';
import {
  connectionById, deleteConnection, deleteEventRow, deleteEventsOfUser, eventRow, liveConnection, markBroken, markNotSynced, markOk, meetingOf, personOf,
  saveEventRow, type Connection,
} from './store';

/**
 * The one-way sync of the meetings to Google Calendar (fbk_022, owner 2026-10-19). Madar writes each meeting to the calendar "Madar"
 * of each connected person who is its organizer or an attendee, and keeps it up to date: a create, a change and a cancel all end in
 * gcal.sync { userId, meetingId }. A change in Google never comes back.
 *
 * gcal.sync reads again when it runs, so a late or repeated row does no harm: the connection of the person, the person, the meeting,
 * and the Google event row. What Google gets is eventBodyOf: the title, the place and the time. Never the notes, the guests, the people,
 * the kind or the project (owner, Q2).
 *
 * Errors: a revoked grant, a seal that does not open, or a deleted calendar ends the connection (state broken, the token is deleted at
 * once) and the row is done. A timeout, a network error, a 5xx or a rate limit sets state not_synced and throws, so the outbox tries
 * again (5 times). Any other refusal sets not_synced with the code refused and does not retry. An error text, a log line and an outbox
 * error hold the code and the ids only, never a token, a code, a title or a Google answer.
 */

/** The calls whose save can change a meeting: each one writes gcal.sync rows (server/google/rows.ts). Wave 3 adds meetings.extend. */
export const GCAL_CALLS = ['meetings.create', 'meetings.update', 'meetings.cancel', 'events.undo', 'events.undoStory', 'projects.delete'] as const;

const TIME_ZONE = 'Asia/Riyadh';
const encoder = new TextEncoder();

/** The Google event id of a meeting: the hex of the bytes of "madar:<meeting id>" (base32hex, 5 to 1024 characters). The same in every calendar. */
export function eventIdOf(meetingId: string): string {
  return [...encoder.encode(`madar:${meetingId}`)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The body of the Google event: exactly five keys. The stamps are the stored +03:00 stamps. */
export function eventBodyOf(meeting: Pick<Meeting, 'title' | 'where' | 'startsAt' | 'endsAt'>): EventBody {
  return {
    summary: meeting.title,
    location: meeting.where,
    start: { dateTime: meeting.startsAt, timeZone: TIME_ZONE },
    end: { dateTime: meeting.endsAt, timeZone: TIME_ZONE },
    status: 'confirmed',
  };
}

// The access token of a connection, kept in memory for the life of the isolate, until 60 seconds before it ends. It is never stored.
const ACCESS_MARGIN_MS = 60_000;
const accessCache = new Map<string, { token: string; until: number }>();

/** For tests: forget every access token. */
export function resetAccessCache(): void {
  accessCache.clear();
}

async function accessOf(deps: Deps, ready: GoogleReady, connection: Connection, fresh: boolean): Promise<string> {
  const now = deps.clock.now().getTime();
  const kept = accessCache.get(connection.id);
  if (!fresh && kept && kept.until > now) return kept.token;
  const refreshToken = await openToken(await ready.keys(), connection.userId, connection.sealedToken as string);
  const got = await refreshAccess(ready.client, refreshToken);
  accessCache.set(connection.id, { token: got.accessToken, until: now + got.expiresIn * 1000 - ACCESS_MARGIN_MS });
  return got.accessToken;
}

/** Runs work with the access token. A 401 of the Calendar API drops the token and tries once more with a new one. */
async function withAccess<T>(deps: Deps, ready: GoogleReady, connection: Connection, work: (token: string) => Promise<T>): Promise<T> {
  try {
    return await work(await accessOf(deps, ready, connection, false));
  } catch (error) {
    if (!(error instanceof GoogleError) || error.code !== 'unauthorized') throw error;
    accessCache.delete(connection.id);
    return work(await accessOf(deps, ready, connection, true));
  }
}

/** Writes the event for the meeting: an insert with the event id, or a patch of the event that the row names. */
async function putEvent(client: GoogleClient, token: string, calendarId: string, meeting: Meeting, known: string | undefined): Promise<string> {
  const eventId = known ?? eventIdOf(meeting.id);
  const body = eventBodyOf(meeting);
  const insert = async () => {
    try {
      await insertEvent(client, token, calendarId, { id: eventId, ...body });
    } catch (error) {
      // The event id exists already (a deleted event keeps its id): a full update brings it back as confirmed.
      if (error instanceof GoogleError && error.code === 'conflict') await updateEvent(client, token, calendarId, eventId, body);
      else throw error;
    }
  };
  if (known === undefined) {
    await insert();
    return eventId;
  }
  try {
    await patchEvent(client, token, calendarId, eventId, body);
  } catch (error) {
    if (error instanceof GoogleError && error.code === 'not_found') await insert();
    else throw error;
  }
  return eventId;
}

/** A 404 or 410 of a delete counts as done: the event is gone. */
async function dropEvent(client: GoogleClient, token: string, calendarId: string, eventId: string): Promise<void> {
  try {
    await deleteEvent(client, token, calendarId, eventId);
  } catch (error) {
    if (!(error instanceof GoogleError) || error.code !== 'not_found') throw error;
  }
}

/** The connection ends: its token is deleted at once, its Google events are forgotten, and nobody retries. */
async function endConnection(deps: Deps, q: Query, connection: Connection, code: string): Promise<void> {
  accessCache.delete(connection.id);
  await markBroken(q, connection.id, code, deps.clock.now());
  await deleteEventsOfUser(q, connection.userId);
  deps.log.warn('A Google Calendar connection ended.', { code, userId: connection.userId });
}

/**
 * The state of the calendar of one person for one meeting. 'put' wrote the event, 'deleted' took it away, 'none' did nothing (no
 * connection, an off person, no event to take away, or an end that nobody retries).
 */
export async function syncOne(deps: Deps, userId: string, meetingId: string): Promise<'put' | 'deleted' | 'none'> {
  const ready = googleOf(deps);
  if (!ready) return 'none';
  // The primary, never a read copy: the row runs right after the commit that wrote the meeting.
  const q = statementQuery(deps.db, 'write');
  const connection = await liveConnection(q, userId);
  if (!connection || connection.state === 'broken' || connection.sealedToken === null || connection.calendarId === null) return 'none';
  const calendarId = connection.calendarId;
  const person = await personOf(q, userId);
  if (!person || !person.active || person.removed) return 'none';
  const meeting = await meetingOf(q, meetingId);
  const wanted = meeting !== undefined && meeting.status === 'scheduled' && (meeting.organizerId === userId || meeting.attendeeIds.includes(userId));
  const row = await eventRow(q, userId, meetingId);
  if (!wanted && !row) return 'none';

  try {
    let outcome: 'put' | 'deleted';
    if (wanted) {
      const eventId = await withAccess(deps, ready, connection, (token) => putEvent(ready.client, token, calendarId, meeting, row?.eventId));
      await saveEventRow(q, { userId, meetingId, eventId, rev: meeting.rev, at: deps.clock.now() });
      outcome = 'put';
    } else {
      await withAccess(deps, ready, connection, (token) => dropEvent(ready.client, token, calendarId, row!.eventId));
      await deleteEventRow(q, userId, meetingId);
      outcome = 'deleted';
    }
    // One statement less for each sync of a healthy connection: a write only when the state or the last error changes.
    if (connection.state !== 'ok' || connection.lastError !== null) await markOk(q, connection.id, deps.clock.now());
    return outcome;
  } catch (error) {
    if (error instanceof SealBroken) {
      await endConnection(deps, q, connection, 'seal_broken');
      return 'none';
    }
    if (error instanceof GoogleError) {
      // grant_gone: the person took Madar away at Google. not_found here is the calendar itself: a missing event is handled above.
      if (error.code === 'grant_gone' || error.code === 'not_found') {
        await endConnection(deps, q, connection, error.code === 'grant_gone' ? 'grant_gone' : 'calendar_gone');
        return 'none';
      }
      if (error.retry) {
        await markNotSynced(q, connection.id, error.code, deps.clock.now());
        deps.log.warn('A Google Calendar sync will be tried again.', { code: error.code, userId });
        throw error;
      }
      await markNotSynced(q, connection.id, 'refused', deps.clock.now());
      deps.log.warn('Google Calendar refused a sync. It is not tried again.', { code: error.code, userId });
      return 'none';
    }
    throw error;
  }
}

/**
 * gcal.revoke: takes the grant back at Google and deletes the row, so the sealed token leaves the database. A replaced row (the person
 * connected again) skips the call to Google: its grant is the grant of the new row. A text that does not open: the row goes. A timeout
 * or a server error throws, so the outbox tries again; the cleanup step deletes a revoking row after one day in any case.
 */
export async function revokeOne(deps: Deps, connectionId: string, o: { replaced?: boolean } = {}): Promise<void> {
  const q = statementQuery(deps.db, 'write');
  const connection = await connectionById(q, connectionId);
  if (!connection) return;
  accessCache.delete(connection.id);
  const ready = googleOf(deps);
  if (!o.replaced && ready && connection.sealedToken !== null) {
    let token: string | undefined;
    try {
      token = await openToken(await ready.keys(), connection.userId, connection.sealedToken);
    } catch (error) {
      if (!(error instanceof SealBroken)) throw error;
    }
    if (token !== undefined) {
      try {
        await revokeToken(ready.client, token);
      } catch (error) {
        if (error instanceof GoogleError && error.retry) throw error;
        // Any other answer is final: a later try gives the same one.
      }
    }
  }
  // A live row that goes (the person was removed) takes its Google events with it. A revoking row has none to take: disconnect and
  // connect again have cleared them, and the events now belong to the new row.
  if (connection.state !== 'revoking') await deleteEventsOfUser(q, connection.userId);
  await deleteConnection(q, connection.id);
}
