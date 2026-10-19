import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCall } from '../core/runCall';
import type { RunResult } from '../core/types';
import { fakeGoogle, type FakeGoogle } from '../google/fakeGoogle';
import { googleKeysOf, openToken } from '../google/keys';
import { newBatch, startOffice, type ItOffice } from './runCallOffice';

/**
 * The Google Calendar connect on the local database, as madar_server (fbk_022, owner 2026-10-19): the migration
 * 20261021000200_google_calendar.sql, the SQL of the four calls and of the first backfill. Google is a stub (fakeGoogle), so
 * nothing leaves the Mac. It needs the local stack and the Docker lock; the merge lead runs it (the builder has no Docker).
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
    await office.sql('truncate google_connections, google_events, outbox');
    expect(okOf(await connect(person))).toMatchObject({ state: 'ok' });
    const [row] = await office.sql<{ user_id: string; sealed_token: string; calendar_id: string; state: string }>('select * from google_connections');
    expect(row).toMatchObject({ user_id: person, state: 'ok', calendar_id: 'cal-1@group.calendar.google.com' });
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
    await office.sql('truncate google_connections, google_events, outbox, meetings');
    const plan = async (as: string, day: string, attendeeIds: string[] = []) =>
      okOf<{ id: string }>(await call(as, 'meetings.create', { kind: 'meeting', title: 'Kickoff', startsAt: `${day}T10:00:00.000+03:00`, attendeeIds })).id;
    const mine = await plan(person, '2026-10-06');
    const attending = await plan(other, '2026-10-07', [person]);
    await plan(other, '2026-10-08');
    expect(okOf(await connect(person))).toEqual({ state: 'ok', meetings: 2 });
    const rows = await office.sql<{ payload: { userId: string; meetingId: string } }>("select payload from outbox where kind = 'gcal.sync' order by id");
    expect(rows.map((row) => row.payload.meetingId).sort()).toEqual([mine, attending].sort());
    expect(okOf(await connect(person))).toMatchObject({ state: 'ok' });
    expect((await office.sql<{ state: string }>('select state from google_connections order by connected_at')).map((row) => row.state)).toEqual(['revoking', 'ok']);
    expect(await office.sql("select payload from outbox where kind = 'gcal.revoke'")).toHaveLength(1);
  });

  it('disconnects: the row becomes revoking, the Google events of the person go, and the status says none', async () => {
    await office.sql('truncate google_connections, google_events, outbox');
    okOf(await connect(person));
    await office.sql("insert into google_events (user_id, meeting_id, event_id, synced_rev, synced_at) values ($1, 'mtg_x', 'ev1', 1, now()), ($2, 'mtg_x', 'ev2', 1, now())", [person, other]);
    expect(okOf(await call(person, 'google.disconnect', {}))).toEqual({ state: 'none' });
    expect((await office.sql<{ user_id: string }>('select user_id from google_events')).map((row) => row.user_id)).toEqual([other]);
    expect(okOf(await call(person, 'google.status', {}))).toMatchObject({ state: 'none' });
  });

  it('gives madar_server the rights and the browser roles none, with Row Level Security on', async () => {
    for (const table of ['google_connections', 'google_events']) {
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
