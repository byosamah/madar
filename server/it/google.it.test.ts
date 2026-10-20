import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCall } from '../core/runCall';
import type { RunResult } from '../core/types';
import { cleanup, GOOGLE_REVOKING_KEEP_MS } from '../jobs/steps/cleanup';
// It registers the Google effects and their producers, as server/core/deps.ts does for the entries.
import '../google/effects';
import { fakeGoogle, type FakeGoogle } from '../google/fakeGoogle';
import { eventIdOf, resetAccessCache } from '../google/sync';
import { googleKeysOf, openToken } from '../google/keys';
import { newBatch, startOffice, type ItOffice } from './runCallOffice';

/**
 * The Google Calendar connect on the local database, as madar_server (fbk_022, owner 2026-10-19): the migration
 * 20261021000200_google_calendar.sql and 20261021000300_google_calendars.sql (the calendar id of each person), the SQL of the four calls,
 * of the first backfill and of the reuse of a calendar (the tidy). Google is a stub (fakeGoogle), so nothing leaves the Mac. It needs the local stack and the Docker lock; the merge lead runs it (the builder has no Docker).
 */

const KEY = Buffer.alloc(32, 11).toString('base64');
const GOOGLE = { clientId: 'id-made-up.apps.googleusercontent.com', clientSecret: 'cs-SECRET', key: KEY };

type Live = ReturnType<ItOffice['isolate']>;

function okOf<T>(result: RunResult): T {
  if (!result.ok) throw new Error(`The call failed: ${result.error.code} ${result.error.message}`);
  return result.output as T;
}

describe('Google Calendar on the local database, as madar_server', () => {
  let office: ItOffice;
  let deps: Live;
  let google: FakeGoogle;
  let person: string;
  let other: string;

  const call = (as: string, name: string, input: unknown) => runCall(deps, { principal: { userId: as }, name, input, batch: newBatch() });
  const connect = async (as: string) => {
    const url = new URL(okOf<{ url: string }>(await call(as, 'google.connectStart', {})).url);
    google.state.challenge = url.searchParams.get('code_challenge') ?? undefined;
    return call(as, 'google.connect', { code: google.state.code, state: url.searchParams.get('state') });
  };

  beforeAll(async () => {
    office = await startOffice('google');
    google = fakeGoogle({ clientId: GOOGLE.clientId, clientSecret: GOOGLE.clientSecret });
    const isolate = office.isolate();
    deps = Object.assign(isolate, { config: { ...isolate.config, appUrl: 'https://madar.example', google: GOOGLE }, googleFetch: google.fetch });
    const humans = Object.values(office.seed.users).filter((user) => user.kind === 'human' && user.active);
    person = humans[1].id;
    other = humans[2].id;
  }, 60_000);

  afterAll(async () => {
    await office?.close();
  });

  it('connects: stores a sealed token and the calendar id, and the status says ok', async () => {
    await office.sql('truncate google_connections, google_events, google_calendars, outbox');
    expect(okOf(await connect(person))).toMatchObject({ state: 'ok' });
    const [row] = await office.sql<{ user_id: string; sealed_token: string; calendar_id: string; state: string }>('select * from google_connections');
    expect(row).toMatchObject({ user_id: person, state: 'ok', calendar_id: 'cal-1@group.calendar.google.com' });
    // The first connect remembers the calendar id of the person, and writes no gcal.tidy row (it made the calendar).
    expect(await office.sql('select user_id, calendar_id from google_calendars')).toEqual([{ user_id: person, calendar_id: 'cal-1@group.calendar.google.com' }]);
    expect(await office.sql("select * from outbox where kind = 'gcal.tidy'")).toEqual([]);
    expect(row.sealed_token).not.toContain('rt-SECRET');
    expect(await openToken(await googleKeysOf(KEY), person, row.sealed_token)).toBe('rt-SECRET');
    expect(okOf(await call(person, 'google.status', {}))).toMatchObject({ ready: true, state: 'ok' });
    expect(okOf(await call(other, 'google.status', {}))).toEqual({ ready: true, state: 'none', connectedAt: null });
  });

  it('keeps one live row for each person: the unique index refuses a second one, and a revoking row lives beside a live one', async () => {
    await office.sql('truncate google_connections');
    const insert = (id: string, state: string) =>
      office.sql("insert into google_connections (id, user_id, state, connected_at, changed_at) values ($1, $2, $3, now(), now())", [id, person, state]);
    await insert('c1', 'ok');
    await expect(insert('c2', 'not_synced')).rejects.toMatchObject({ code: '23505' });
    await insert('c3', 'revoking');
    await insert('c4', 'revoking');
    await expect(insert('c5', 'not_a_state')).rejects.toMatchObject({ code: '23514' });
    await office.sql("update google_connections set state = 'revoking' where id = 'c1'");
    await insert('c6', 'broken');
  });

  it('writes the backfill rows for the upcoming meetings of the person, and the second connect makes the old row revoking', async () => {
    await office.sql('truncate google_connections, google_events, google_calendars, outbox, meetings');
    const plan = async (as: string, day: string, attendeeIds: string[] = []) =>
      okOf<{ id: string }>(await call(as, 'meetings.create', { kind: 'meeting', title: 'Kickoff', startsAt: `${day}T10:00:00.000+03:00`, attendeeIds })).id;
    const mine = await plan(person, '2026-10-06');
    const attending = await plan(other, '2026-10-07', [person]);
    await plan(other, '2026-10-08');
    expect(okOf(await connect(person))).toEqual({ state: 'ok', meetings: 2 });
    const rows = await office.sql<{ payload: { userId: string; meetingId: string } }>("select payload from outbox where kind = 'gcal.sync' order by id");
    expect(rows.map((row) => row.payload.meetingId).sort()).toEqual([mine, attending].sort());
    const [first] = await office.sql<{ id: string }>('select id from google_connections');
    google.requests.length = 0;
    const calendars = google.calendars.size;
    expect(okOf(await connect(person))).toMatchObject({ state: 'ok' });
    // The second connect uses the calendar of the first one: no second calendar, and one gcal.tidy row that ran.
    expect(google.calendars.size).toBe(calendars);
    expect(google.requests.some((request) => request.method === 'POST' && request.path === '/calendar/v3/calendars')).toBe(false);
    expect(await office.sql<{ payload: unknown; done: boolean }>("select payload, done_at is not null as done from outbox where kind = 'gcal.tidy'")).toEqual([{ payload: { userId: person }, done: true }]);
    // The connect makes the old row revoking in its own transaction. Here no request host keeps work after the answer, so gcal.revoke
    // runs right after the commit: it skips Google for a replaced row and deletes it. Only the new live row stays.
    const live = await office.sql<{ id: string; state: string }>('select id, state from google_connections');
    expect(live.map((row) => row.state)).toEqual(['ok']);
    expect(live[0].id).not.toBe(first.id);
    const revokes = await office.sql<{ payload: unknown; done: boolean }>("select payload, done_at is not null as done from outbox where kind = 'gcal.revoke'");
    expect(revokes).toEqual([{ payload: { connectionId: first.id, replaced: true }, done: true }]);
    expect(google.requests.some((request) => request.path === '/revoke')).toBe(false);
  });

  it('disconnects: the row becomes revoking, the Google events of the person go, and the status says none', async () => {
    await office.sql('truncate google_connections, google_events, google_calendars, outbox');
    okOf(await connect(person));
    await office.sql("insert into google_events (user_id, meeting_id, event_id, synced_rev, synced_at) values ($1, 'mtg_x', 'ev1', 1, now()), ($2, 'mtg_x', 'ev2', 1, now())", [person, other]);
    expect(okOf(await call(person, 'google.disconnect', {}))).toEqual({ state: 'none' });
    // A disconnect keeps the remembered calendar id on purpose.
    expect((await office.sql<{ user_id: string }>('select user_id from google_calendars')).map((row) => row.user_id)).toEqual([person]);
    expect((await office.sql<{ user_id: string }>('select user_id from google_events')).map((row) => row.user_id)).toEqual([other]);
    expect(okOf(await call(person, 'google.status', {}))).toMatchObject({ state: 'none' });
  });

  it('connects, disconnects and connects again: one calendar in Google, the row kept, the meeting once, and the stale event of Madar taken out (owner test 2026-10-20)', async () => {
    await office.sql('truncate google_connections, google_events, google_calendars, outbox, meetings');
    resetAccessCache();
    const calendars = google.calendars.size;
    const id = okOf<{ id: string }>(await call(person, 'meetings.create', { kind: 'meeting', title: 'Kickoff', startsAt: '2026-10-06T10:00:00.000+03:00' })).id;
    okOf(await connect(person));
    const [kept] = await office.sql<{ user_id: string; calendar_id: string; changed_at: Date }>('select user_id, calendar_id, changed_at from google_calendars');
    expect(google.calendars.size - calendars).toBe(1);
    // An event of Madar that no meeting needs, and an event of the person: only the first one goes.
    const calendar = google.events.get(kept.calendar_id)!;
    const stale = eventIdOf('mtg_old');
    for (const eventId of [stale, 'k3j2h1g0f9d8s7a6']) calendar.set(eventId, { id: eventId, status: 'confirmed', summary: 'Old', start: { dateTime: '2026-12-01T10:00:00.000+03:00' }, end: { dateTime: '2026-12-01T11:00:00.000+03:00' } });
    okOf(await call(person, 'google.disconnect', {}));
    expect(await office.sql('select user_id, calendar_id, changed_at from google_calendars')).toEqual([kept]);
    google.requests.length = 0;
    expect(okOf(await connect(person))).toEqual({ state: 'ok', meetings: 1 });
    expect(google.calendars.size - calendars).toBe(1);
    expect(google.requests.filter((request) => request.method === 'POST' && request.path === '/calendar/v3/calendars')).toEqual([]);
    expect(await office.sql('select user_id, calendar_id, changed_at from google_calendars')).toEqual([kept]);
    expect((await office.sql<{ calendar_id: string }>("select calendar_id from google_connections where state <> 'revoking'")).map((row) => row.calendar_id)).toEqual([kept.calendar_id]);
    expect(calendar.get(eventIdOf(id))?.status).toBe('confirmed');
    expect(calendar.get(stale)?.status).toBe('cancelled');
    expect(calendar.get('k3j2h1g0f9d8s7a6')?.status).toBe('confirmed');
    expect(await office.sql<{ meeting_id: string }>('select meeting_id from google_events')).toEqual([{ meeting_id: id }]);
    expect(await office.sql<{ done: boolean; error: string | null }>("select done_at is not null as done, error from outbox where kind = 'gcal.tidy'")).toEqual([{ done: true, error: null }]);
  });

  it('makes a new calendar and updates the row when the remembered calendar is gone in Google (404)', async () => {
    await office.sql('truncate google_connections, google_events, google_calendars, outbox, meetings');
    resetAccessCache();
    okOf(await connect(person));
    const [first] = await office.sql<{ calendar_id: string }>('select calendar_id from google_calendars');
    okOf(await call(person, 'google.disconnect', {}));
    google.deleteCalendar(first.calendar_id);
    const calendars = google.calendars.size;
    okOf(await connect(person));
    expect(google.calendars.size - calendars).toBe(1);
    const [now] = await office.sql<{ calendar_id: string }>('select calendar_id from google_calendars');
    expect(now.calendar_id).not.toBe(first.calendar_id);
    expect((await office.sql<{ calendar_id: string }>("select calendar_id from google_connections where state <> 'revoking'")).map((row) => row.calendar_id)).toEqual([now.calendar_id]);
    expect(await office.sql("select * from outbox where kind = 'gcal.tidy'")).toEqual([]);
  });

  it('fails the connect and makes no second calendar when Google fails on the remembered calendar, and the next connect works', async () => {
    await office.sql('truncate google_connections, google_events, google_calendars, outbox, meetings');
    resetAccessCache();
    okOf(await connect(person));
    const kept = await office.sql<{ user_id: string; calendar_id: string }>('select user_id, calendar_id from google_calendars');
    okOf(await call(person, 'google.disconnect', {}));
    const calendars = google.calendars.size;
    google.failAll((request) => request.method === 'GET' && /^\/calendar\/v3\/calendars\/[^/]+$/.test(request.path), 503);
    try {
      const failed = await connect(person);
      expect(failed).toMatchObject({ ok: false, error: { code: 'failed', details: { reason: 'google_unreachable' } } });
    } finally {
      google.clearRules();
    }
    expect(google.calendars.size).toBe(calendars);
    expect(await office.sql('select user_id, calendar_id from google_calendars')).toEqual(kept);
    expect(await office.sql('select * from google_connections')).toEqual([]);
    okOf(await connect(person));
    expect(google.calendars.size).toBe(calendars);
    expect((await office.sql<{ calendar_id: string }>("select calendar_id from google_connections where state <> 'revoking'")).map((row) => row.calendar_id)).toEqual([kept[0].calendar_id]);
  });

  it('syncs a meeting to the calendar of the connected organizer and attendee: insert, patch, take off, cancel', async () => {
    await office.sql('truncate google_connections, google_events, google_calendars, outbox, meetings');
    resetAccessCache();
    google.requests.length = 0;
    okOf(await connect(person));
    okOf(await connect(other));
    google.requests.length = 0;
    const id = okOf<{ id: string }>(await call(person, 'meetings.create', { kind: 'meeting', title: 'Kickoff', where: 'Room 4', startsAt: '2026-10-06T10:00:00.000+03:00', attendeeIds: [other] })).id;
    expect(google.eventRequests().map((request) => request.method)).toEqual(['POST', 'POST']);
    expect(await office.sql('select user_id, meeting_id, event_id, synced_rev from google_events order by user_id')).toHaveLength(2);
    okOf(await call(person, 'meetings.update', { id, title: 'Kickoff 2', attendeeIds: [] }));
    const events = await office.sql<{ user_id: string }>('select user_id from google_events');
    expect(events.map((row) => row.user_id)).toEqual([person]);
    expect([...google.events.values()].some((calendar) => calendar.get(eventIdOf(id))?.summary === 'Kickoff 2')).toBe(true);
    okOf(await call(person, 'meetings.cancel', { id }));
    expect(await office.sql('select * from google_events')).toEqual([]);
    const rows = await office.sql<{ done: boolean; error: string | null }>("select done_at is not null as done, error from outbox where kind = 'gcal.sync' order by id");
    expect(rows.every((row) => row.done && row.error === null)).toBe(true);
  });

  it('deletes the live row and the remembered calendar of a person who was removed, with a revoke at Google', async () => {
    await office.sql('truncate google_connections, google_events, google_calendars, outbox');
    google.requests.length = 0;
    okOf(await connect(other));
    okOf(await connect(person));
    const admin = Object.values(office.seed.users).find((user) => user.systemRole === 'admin' && user.kind === 'human')!.id;
    okOf(await call(admin, 'users.deactivate', { id: other }));
    expect((await office.sql<{ user_id: string }>('select user_id from google_calendars order by user_id')).map((row) => row.user_id).sort()).toEqual([other, person].sort());
    okOf(await call(admin, 'users.remove', { id: other }));
    // Only the calendar of the removed person goes.
    expect(await office.sql<{ user_id: string }>('select user_id from google_calendars')).toEqual([{ user_id: person }]);
    expect(await office.sql<{ user_id: string }>("select user_id from google_connections where state <> 'revoking'")).toEqual([{ user_id: person }]);
    expect(google.requests.filter((request) => request.path === '/revoke')).toHaveLength(1);
  });

  it('sets the row of a removed person to revoking in the transaction of users.remove when Google fails, and the cleanup deletes it after one day (security fix)', async () => {
    await office.sql('truncate google_connections, google_events, google_calendars, outbox');
    resetAccessCache();
    const humans = Object.values(office.seed.users).filter((user) => user.kind === 'human' && user.active && user.systemRole !== 'admin');
    const third = humans.find((user) => user.id !== person && user.id !== other)!.id;
    const admin = Object.values(office.seed.users).find((user) => user.systemRole === 'admin' && user.kind === 'human')!.id;
    okOf(await connect(third));
    okOf(await call(third, 'meetings.create', { kind: 'meeting', title: 'Kickoff', startsAt: '2026-10-07T10:00:00.000+03:00' }));
    expect((await office.sql<{ user_id: string }>('select distinct user_id from google_events')).map((row) => row.user_id)).toEqual([third]);
    google.failAll((request) => request.path === '/revoke', 503);
    try {
      // Turned off only: the connection stays (decision 11 of the plan).
      okOf(await call(admin, 'users.deactivate', { id: third }));
      expect(await office.sql('select state from google_connections')).toEqual([{ state: 'ok' }]);
      okOf(await call(admin, 'users.remove', { id: third }));
    } finally {
      google.clearRules();
    }
    const [row] = await office.sql<{ state: string; changed_at: Date | string }>('select state, changed_at from google_connections');
    expect(row.state).toBe('revoking');
    expect(await office.sql('select * from google_events')).toEqual([]);
    const changed = new Date(row.changed_at).getTime();
    expect(await cleanup(deps, new Date(changed + GOOGLE_REVOKING_KEEP_MS - 60_000))).toMatchObject({ googleRevoking: 0 });
    expect(await cleanup(deps, new Date(changed + GOOGLE_REVOKING_KEEP_MS + 60_000))).toMatchObject({ googleRevoking: 1 });
    expect(await office.sql('select * from google_connections')).toEqual([]);
  });

  it('deletes a revoking row after one day and keeps a younger one and a live one (the cleanup step)', async () => {
    await office.sql('truncate google_connections');
    const insert = (id: string, user: string, state: string, hours: number) =>
      office.sql("insert into google_connections (id, user_id, state, connected_at, changed_at) values ($1, $2, $3, $4::timestamptz, $4::timestamptz)", [id, user, state, new Date(Date.parse('2026-10-04T06:00:00Z') - hours * 3_600_000).toISOString()]);
    await insert('old', person, 'revoking', 25);
    await insert('recent', other, 'revoking', 23);
    await insert('live', person, 'ok', 90);
    expect(await cleanup(deps, new Date('2026-10-04T06:00:00Z'))).toMatchObject({ googleRevoking: 1 });
    expect((await office.sql<{ id: string }>('select id from google_connections order by id')).map((row) => row.id)).toEqual(['live', 'recent']);
  });

  it('gives madar_server the rights and the browser roles none, with Row Level Security on', async () => {
    for (const table of ['google_connections', 'google_events', 'google_calendars']) {
      const [rights] = await office.sql<{ server: boolean; anon: boolean; authenticated: boolean; secured: boolean }>(
        `select has_table_privilege('madar_server', $1, 'select, insert, update, delete') as server,
                has_table_privilege('anon', $1, 'select') or has_table_privilege('anon', $1, 'insert') as anon,
                has_table_privilege('authenticated', $1, 'select') or has_table_privilege('authenticated', $1, 'insert') as authenticated,
                (select relrowsecurity from pg_class where relname = $1 and relnamespace = (select oid from pg_namespace where nspname = current_schema())) as secured`,
        [table],
      );
      expect({ table, ...rights }).toEqual({ table, server: true, anon: false, authenticated: false, secured: true });
    }
  });
});
