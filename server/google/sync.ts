import type { Meeting } from '../../src/api/contract/entities';
import { nowStamp } from '../../src/lib/dates';
import type { Deps, Query } from '../core/ports';
import { statementQuery } from '../data/dialect';
import { deleteEvent, GoogleError, insertEvent, listEvents, patchEvent, refreshAccess, revokeToken, updateEvent, type EventBody, type GoogleClient } from './api';
import { googleOf, type GoogleReady } from './client';
import { openToken, SealBroken } from './keys';
import {
  connectionById, deleteConnection, deleteEventRow, deleteEventsOfUser, eventIdsOfUser, eventRow, liveConnection, markBroken, markNotSynced, markOk, meetingOf, personOf,
  saveEventRow, upcomingMeetingIds, type Connection,
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
 *
 * gcal.tidy (one calendar for each person, owner test 2026-10-20): a connect that reuses the calendar of the person leaves the old events
 * of Madar in it. The tidy deletes each event of Madar that no meeting of the backfill needs and that gcal.sync did not write, and no other event.
 */

/** The calls whose save can change a meeting: each one writes gcal.sync rows (server/google/rows.ts). Wave 3 adds meetings.extend. */
export const GCAL_CALLS = ['meetings.create', 'meetings.update', 'meetings.cancel', 'events.undo', 'events.undoStory', 'projects.delete'] as const;

const TIME_ZONE = 'Asia/Riyadh';
const encoder = new TextEncoder();
const DAY_MS = 24 * 60 * 60 * 1000;

/** The meetings of a new connection: those that start from now to 60 days later, at most 200 (the first backfill, and the set that the tidy keeps). */
export const BACKFILL_DAYS = 60;
export const BACKFILL_MAX = 200;

/** The meetings that a connect sends to Google at once: the scheduled meetings of the person from `now` to 60 days later, at most 200. */
export function backfillMeetingIds(q: Query, userId: string, now: Date): Promise<string[]> {
  return upcomingMeetingIds(q, userId, nowStamp(now), nowStamp(new Date(now.getTime() + BACKFILL_DAYS * DAY_MS)), BACKFILL_MAX);
}

/** The Google event id of a meeting: the hex of the bytes of "madar:<meeting id>" (base32hex, 5 to 1024 characters). The same in every calendar. */
export function eventIdOf(meetingId: string): string {
  return [...encoder.encode(`madar:${meetingId}`)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Every event id that Madar makes starts with this text, the hex of "madar:mtg_". The tidy deletes only events whose id starts with it. */
export const MADAR_EVENT_PREFIX = eventIdOf('mtg_');

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
 * gcal.tidy: takes the stale events of Madar out of a calendar that a connect reused. It lists the events of the calendar from now on,
 * keeps those whose id is the event id of a meeting in the backfill set of the person (the meetings the connect sends) and those that
 * have a row in google_events (gcal.sync wrote them since the connect, for example for a meeting made while the tidy ran), and deletes
 * every other event whose id starts with MADAR_EVENT_PREFIX. An event of the person, or any id without the prefix, is never touched.
 * The keep set is read after the list, so an event that sync writes while the tidy runs is never taken for a stale one. It gives the
 * number of events it took away.
 *
 * It writes no row: the event rows of google_events come only from gcal.sync. A revoked grant, a seal that does not open, a calendar that
 * is gone or a refusal ends the work quietly: the next gcal.sync finds the same fault and ends the connection as it does today. A
 * timeout, a network error, a 5xx or a rate limit throws, so the outbox tries again (the delete of an event is safe to repeat).
 */
export async function tidyOne(deps: Deps, userId: string): Promise<number> {
  const ready = googleOf(deps);
  if (!ready) return 0;
  const q = statementQuery(deps.db, 'write');
  const connection = await liveConnection(q, userId);
  if (!connection || connection.state === 'broken' || connection.sealedToken === null || connection.calendarId === null) return 0;
  const calendarId = connection.calendarId;
  const person = await personOf(q, userId);
  if (!person || !person.active || person.removed) return 0;
  const now = deps.clock.now();
  try {
    return await withAccess(deps, ready, connection, async (token) => {
      const listed = (await listEvents(ready.client, token, calendarId, now.toISOString())).filter((id) => id.startsWith(MADAR_EVENT_PREFIX));
      if (listed.length === 0) return 0;
      const keep = new Set([...(await backfillMeetingIds(q, userId, now)).map(eventIdOf), ...(await eventIdsOfUser(q, userId))]);
      const stale = listed.filter((id) => !keep.has(id));
      for (const id of stale) await dropEvent(ready.client, token, calendarId, id);
      return stale.length;
    });
  } catch (error) {
    if (error instanceof GoogleError && error.retry) {
      deps.log.warn('A Google Calendar tidy will be tried again.', { code: error.code, userId });
      throw error;
    }
    if (error instanceof SealBroken || error instanceof GoogleError) {
      deps.log.warn('A Google Calendar tidy ended. The next sync decides about the connection.', { code: error instanceof GoogleError ? error.code : 'seal_broken', userId });
      return 0;
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
  // A live row that goes takes its Google events with it (a revoke row that a build before 2026-10-19 queued for a removed person). A
  // revoking row has none to take: disconnect, connect again and users.remove have cleared them in their own transaction.
  if (connection.state !== 'revoking') await deleteEventsOfUser(q, connection.userId);
  await deleteConnection(q, connection.id);
}
