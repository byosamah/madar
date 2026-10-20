import type { Meeting } from '../../src/api/contract/entities';
import type { Query } from '../core/ports';
import { sqlFor } from '../data/dialect';

/**
 * The three server-only tables of the Google Calendar connect (fbk_022; supabase/migrations/20261021000200_google_calendar.sql and
 * 20261021000300_google_calendars.sql): google_connections (one live row for each person, and revoking rows on their way out),
 * google_events (the Google event of a meeting in the calendar of a person) and google_calendars (the id of the calendar that Madar made
 * for a person, kept after a disconnect so a new connect uses the same calendar). No State collection reads them, so no handler,
 * loader, event, signal or export of the office ever sees them. Each statement has a Postgres text and a SQLite twin, picked with sqlFor from the query that runs it.
 *
 * A time reads back as a Date from Postgres and as ISO text from SQLite; every function here gives a Date.
 */

export type ConnectionState = 'ok' | 'not_synced' | 'broken' | 'revoking';
export type Connection = {
  id: string;
  userId: string;
  sealedToken: string | null;
  calendarId: string | null;
  state: ConnectionState;
  connectedAt: Date;
  lastError: string | null;
};

type ConnectionRow = {
  id: string; user_id: string; sealed_token: string | null; calendar_id: string | null; state: ConnectionState;
  connected_at: Date | string; last_error: string | null;
};

const COLUMNS = 'id, user_id, sealed_token, calendar_id, state, connected_at, last_error';

const LIVE_SQL = `select ${COLUMNS} from google_connections where user_id = $1 and state <> 'revoking'`;
const LIVE_LITE = `select ${COLUMNS} from google_connections where user_id = ?1 and state <> 'revoking'`;
const BY_ID_SQL = `select ${COLUMNS} from google_connections where id = $1`;
const BY_ID_LITE = `select ${COLUMNS} from google_connections where id = ?1`;

const connectionOf = (row: ConnectionRow): Connection => ({
  id: row.id, userId: row.user_id, sealedToken: row.sealed_token, calendarId: row.calendar_id, state: row.state,
  connectedAt: new Date(row.connected_at), lastError: row.last_error,
});

/** The live connection of a person (ok, not_synced or broken), never a revoking one. */
export async function liveConnection(q: Query, userId: string): Promise<Connection | undefined> {
  const [row] = await q<ConnectionRow>(sqlFor(q, LIVE_SQL, LIVE_LITE), [userId]);
  return row ? connectionOf(row) : undefined;
}

export async function connectionById(q: Query, id: string): Promise<Connection | undefined> {
  const [row] = await q<ConnectionRow>(sqlFor(q, BY_ID_SQL, BY_ID_LITE), [id]);
  return row ? connectionOf(row) : undefined;
}

const INSERT_SQL =
  "insert into google_connections (id, user_id, sealed_token, calendar_id, state, connected_at, changed_at) values ($1, $2, $3, $4, 'ok', $5, $5)";
const INSERT_LITE =
  "insert into google_connections (id, user_id, sealed_token, calendar_id, state, connected_at, changed_at) values (?1, ?2, ?3, ?4, 'ok', ?5, ?5)";

export async function insertConnection(q: Query, c: { id: string; userId: string; sealedToken: string; calendarId: string; at: Date }): Promise<void> {
  await q(sqlFor(q, INSERT_SQL, INSERT_LITE), [c.id, c.userId, c.sealedToken, c.calendarId, c.at]);
}

const CALENDAR_SQL = 'select calendar_id from google_calendars where user_id = $1';
const CALENDAR_LITE = 'select calendar_id from google_calendars where user_id = ?1';

/** The id of the calendar that Madar made for the person, or undefined when Madar made none. A disconnect keeps it. */
export async function rememberedCalendar(q: Query, userId: string): Promise<string | undefined> {
  const [row] = await q<{ calendar_id: string }>(sqlFor(q, CALENDAR_SQL, CALENDAR_LITE), [userId]);
  return row?.calendar_id;
}

// The row changes only when the id changes, so changed_at tells when Madar made the calendar that the row names.
const REMEMBER_SQL =
  'insert into google_calendars (user_id, calendar_id, changed_at) values ($1, $2, $3) '
  + 'on conflict (user_id) do update set calendar_id = excluded.calendar_id, changed_at = excluded.changed_at where google_calendars.calendar_id <> excluded.calendar_id';
const REMEMBER_LITE =
  'insert into google_calendars (user_id, calendar_id, changed_at) values (?1, ?2, ?3) '
  + 'on conflict (user_id) do update set calendar_id = excluded.calendar_id, changed_at = excluded.changed_at where google_calendars.calendar_id <> excluded.calendar_id';

/** Keeps the calendar id of the person. It runs in the transaction that inserts the connection. */
export async function rememberCalendar(q: Query, userId: string, calendarId: string, at: Date): Promise<void> {
  await q(sqlFor(q, REMEMBER_SQL, REMEMBER_LITE), [userId, calendarId, at]);
}

/** Forgets the calendar id of the person. Only users.remove calls it: a disconnect keeps the id on purpose. */
export async function forgetCalendar(q: Query, userId: string): Promise<void> {
  await q(sqlFor(q, 'delete from google_calendars where user_id = $1', 'delete from google_calendars where user_id = ?1'), [userId]);
}

const REVOKING_SQL = "update google_connections set state = 'revoking', changed_at = $2 where user_id = $1 and state <> 'revoking' returning id";
const REVOKING_LITE = "update google_connections set state = 'revoking', changed_at = ?2 where user_id = ?1 and state <> 'revoking' returning id";

/** The live row of a person becomes revoking. It gives the ids that changed (none, or one). */
export async function startRevoking(q: Query, userId: string, at: Date): Promise<string[]> {
  return (await q<{ id: string }>(sqlFor(q, REVOKING_SQL, REVOKING_LITE), [userId, at])).map((row) => row.id);
}

const OK_SQL = "update google_connections set state = 'ok', last_error = null, last_error_at = null, changed_at = $2 where id = $1 and state in ('ok', 'not_synced') and (state <> 'ok' or last_error is not null)";
const OK_LITE = "update google_connections set state = 'ok', last_error = null, last_error_at = null, changed_at = ?2 where id = ?1 and state in ('ok', 'not_synced') and (state <> 'ok' or last_error is not null)";
const NOT_SYNCED_SQL = "update google_connections set state = 'not_synced', last_error = $2, last_error_at = $3, changed_at = $3 where id = $1 and state in ('ok', 'not_synced')";
const NOT_SYNCED_LITE = "update google_connections set state = 'not_synced', last_error = ?2, last_error_at = ?3, changed_at = ?3 where id = ?1 and state in ('ok', 'not_synced')";
const BROKEN_SQL = "update google_connections set state = 'broken', sealed_token = null, last_error = $2, last_error_at = $3, changed_at = $3 where id = $1 and state <> 'revoking'";
const BROKEN_LITE = "update google_connections set state = 'broken', sealed_token = null, last_error = ?2, last_error_at = ?3, changed_at = ?3 where id = ?1 and state <> 'revoking'";

/** A success: state ok, no error. It writes only when something changes, and never brings a broken or revoking row back. */
export async function markOk(q: Query, id: string, at: Date): Promise<void> {
  await q(sqlFor(q, OK_SQL, OK_LITE), [id, at]);
}

/** A failure that may work later. The code is one of the codes of GoogleError, nothing more. */
export async function markNotSynced(q: Query, id: string, code: string, at: Date): Promise<void> {
  await q(sqlFor(q, NOT_SYNCED_SQL, NOT_SYNCED_LITE), [id, code, at]);
}

/** The grant is gone, or the seal does not open, or the calendar is gone: the token is deleted at once, so the privacy page stays true. */
export async function markBroken(q: Query, id: string, code: string, at: Date): Promise<void> {
  await q(sqlFor(q, BROKEN_SQL, BROKEN_LITE), [id, code, at]);
}

export async function deleteConnection(q: Query, id: string): Promise<void> {
  await q(sqlFor(q, 'delete from google_connections where id = $1', 'delete from google_connections where id = ?1'), [id]);
}

/** The people (of those named) who have a live connection that can sync (ok or not_synced). */
export async function syncingPeople(q: Query, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await q<{ user_id: string }>(
    sqlFor(q, "select user_id from google_connections where user_id = any($1::text[]) and state in ('ok', 'not_synced')", "select user_id from google_connections where user_id in (select value from json_each(?1)) and state in ('ok', 'not_synced')"),
    [userIds],
  );
  return rows.map((row) => row.user_id);
}

export type EventRow = { eventId: string; syncedRev: number };

export async function eventRow(q: Query, userId: string, meetingId: string): Promise<EventRow | undefined> {
  const [row] = await q<{ event_id: string; synced_rev: number }>(
    sqlFor(q, 'select event_id, synced_rev from google_events where user_id = $1 and meeting_id = $2', 'select event_id, synced_rev from google_events where user_id = ?1 and meeting_id = ?2'),
    [userId, meetingId],
  );
  return row ? { eventId: row.event_id, syncedRev: Number(row.synced_rev) } : undefined;
}

const UPSERT_SQL =
  'insert into google_events (user_id, meeting_id, event_id, synced_rev, synced_at) values ($1, $2, $3, $4, $5) '
  + 'on conflict (user_id, meeting_id) do update set event_id = excluded.event_id, synced_rev = excluded.synced_rev, synced_at = excluded.synced_at';
const UPSERT_LITE =
  'insert into google_events (user_id, meeting_id, event_id, synced_rev, synced_at) values (?1, ?2, ?3, ?4, ?5) '
  + 'on conflict (user_id, meeting_id) do update set event_id = excluded.event_id, synced_rev = excluded.synced_rev, synced_at = excluded.synced_at';

export async function saveEventRow(q: Query, o: { userId: string; meetingId: string; eventId: string; rev: number; at: Date }): Promise<void> {
  await q(sqlFor(q, UPSERT_SQL, UPSERT_LITE), [o.userId, o.meetingId, o.eventId, o.rev, o.at]);
}

export async function deleteEventRow(q: Query, userId: string, meetingId: string): Promise<void> {
  await q(sqlFor(q, 'delete from google_events where user_id = $1 and meeting_id = $2', 'delete from google_events where user_id = ?1 and meeting_id = ?2'), [userId, meetingId]);
}

/** The Google event ids that Madar believes it has in the calendar of the person (the rows that only gcal.sync writes). */
export async function eventIdsOfUser(q: Query, userId: string): Promise<string[]> {
  const rows = await q<{ event_id: string }>(sqlFor(q, 'select event_id from google_events where user_id = $1', 'select event_id from google_events where user_id = ?1'), [userId]);
  return rows.map((row) => row.event_id);
}

export async function deleteEventsOfUser(q: Query, userId: string): Promise<void> {
  await q(sqlFor(q, 'delete from google_events where user_id = $1', 'delete from google_events where user_id = ?1'), [userId]);
}

/** The people who have a Google event for one of these meetings: (user, meeting) pairs. */
export async function eventPairsOf(q: Query, meetingIds: string[]): Promise<{ userId: string; meetingId: string }[]> {
  if (meetingIds.length === 0) return [];
  const rows = await q<{ user_id: string; meeting_id: string }>(
    sqlFor(q, 'select user_id, meeting_id from google_events where meeting_id = any($1::text[])', 'select user_id, meeting_id from google_events where meeting_id in (select value from json_each(?1))'),
    [meetingIds],
  );
  return rows.map((row) => ({ userId: row.user_id, meetingId: row.meeting_id }));
}

/** The meetings that exist, of these ids. A deleted meeting is not in the answer. */
export async function meetingsOf(q: Query, ids: string[]): Promise<Meeting[]> {
  if (ids.length === 0) return [];
  const rows = await q<{ doc: Meeting }>(
    sqlFor(q, 'select doc from meetings where id = any($1::text[])', 'select doc from meetings where id in (select value from json_each(?1))'),
    [ids],
  );
  return rows.map((row) => row.doc);
}

export async function meetingOf(q: Query, id: string): Promise<Meeting | undefined> {
  const [row] = await q<{ doc: Meeting }>(sqlFor(q, 'select doc from meetings where id = $1', 'select doc from meetings where id = ?1'), [id]);
  return row?.doc;
}

/** The part of the record of a person that the sync reads: whether the person may still get events. */
export async function personOf(q: Query, id: string): Promise<{ active: boolean; removed: boolean } | undefined> {
  const [row] = await q<{ doc: { active?: boolean; removed?: boolean } }>(sqlFor(q, 'select doc from users where id = $1', 'select doc from users where id = ?1'), [id]);
  return row ? { active: row.doc.active === true, removed: row.doc.removed === true } : undefined;
}

const UPCOMING_SQL =
  "select id from meetings where status = 'scheduled' and starts_at collate \"C\" >= $2 and starts_at collate \"C\" <= $3 "
  + "and (organizer_id = $1::text or doc->'attendeeIds' ? $1::text) order by starts_at collate \"C\", id limit $4";
const UPCOMING_LITE =
  "select id from meetings where status = 'scheduled' and starts_at >= ?2 and starts_at <= ?3 "
  + "and (organizer_id = ?1 or exists (select 1 from json_each(meetings.doc, '$.attendeeIds') where value = ?1)) order by starts_at, id limit ?4";

/** The scheduled meetings of a person (as organizer or attendee) that start from `from` to `to`, at most `limit`. Both stamps are in office time. */
export async function upcomingMeetingIds(q: Query, userId: string, from: string, to: string, limit: number): Promise<string[]> {
  return (await q<{ id: string }>(sqlFor(q, UPCOMING_SQL, UPCOMING_LITE), [userId, from, to, limit])).map((row) => row.id);
}
