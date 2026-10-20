import { describe, expect, it } from 'vitest';
import { nowStamp } from '../../src/lib/dates';
import { googleKeysOf, openToken } from '../google/keys';
import { GOOGLE_KEY, googleOffice, outboxRows, planMeeting, stateOwner, type GoogleOffice } from '../google/testOffice';
import { challengeOf } from '../google/state';

/**
 * The four Google calls (fbk_022, owner 2026-10-19) on the sample office on node:sqlite, with fakeGoogle behind the Google fetch.
 * server/it/google.it.test.ts runs the same SQL on Postgres. Reem is usr_003, Omar usr_004, the agent usr_009 acts for the Admin usr_001.
 */

const AGENT = { userId: 'usr_009', agent: { clientId: 'client-1' } };
const ok = (result: Awaited<ReturnType<GoogleOffice['call']>>) => {
  if (!result.ok) throw new Error(`The call failed: ${JSON.stringify(result.error)}`);
  return result.output as Record<string, unknown>;
};
const days = (n: number) => `2026-10-${String(21 + n).padStart(2, '0')}T10:00:00.000+03:00`;
const rowsOf = (t: GoogleOffice, text: string, values: unknown[] = []) => t.db.statement('read', text, values) as Promise<Record<string, unknown>[]>;

describe('an agent', () => {
  it('gets forbidden from all four calls, also when Google is on', async () => {
    const t = await googleOffice();
    for (const name of ['google.status', 'google.connectStart', 'google.connect', 'google.disconnect']) {
      const input = name === 'google.connect' ? { code: 'code-SECRET', state: 'state-made-up' } : {};
      expect(await t.callAs(AGENT, name, input), name).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    }
    expect(await rowsOf(t, 'select * from google_connections')).toEqual([]);
  });

  it('gets forbidden before the answer that Google is off', async () => {
    const t = await googleOffice({ google: false });
    expect(await t.callAs(AGENT, 'google.status', {})).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});

describe('a copy with no Google values', () => {
  it('says ready false in google.status, and refuses the other three with google_not_ready', async () => {
    const t = await googleOffice({ google: false });
    expect(ok(await t.call('usr_003', 'google.status', {}))).toEqual({ ready: false, state: 'none', connectedAt: null });
    for (const [name, input] of [['google.connectStart', {}], ['google.connect', { code: 'code-SECRET', state: 'state-made-up' }], ['google.disconnect', {}]] as const) {
      expect(await t.call('usr_003', name, input), name).toMatchObject({ ok: false, error: { code: 'invalid_input', details: { reason: 'google_not_ready' } } });
    }
    expect(t.google.requests).toEqual([]);
  });
});

describe('google.status', () => {
  it('has exactly the keys ready, state and connectedAt, and says none before a connect', async () => {
    const t = await googleOffice();
    const status = ok(await t.call('usr_003', 'google.status', {}));
    expect(status).toEqual({ ready: true, state: 'none', connectedAt: null });
    ok(await t.connect('usr_003'));
    const after = ok(await t.call('usr_003', 'google.status', {}));
    expect(Object.keys(after).sort()).toEqual(['connectedAt', 'ready', 'state']);
    expect(after).toMatchObject({ ready: true, state: 'ok', connectedAt: nowStamp(new Date('2026-10-21T06:00:00Z')) });
  });

  it('reads only the row of the person, and never a revoking row', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    expect(ok(await t.call('usr_004', 'google.status', {}))).toMatchObject({ state: 'none' });
    await t.db.statement('write', "update google_connections set state = 'revoking' where user_id = 'usr_003'");
    expect(ok(await t.call('usr_003', 'google.status', {}))).toMatchObject({ state: 'none', connectedAt: null });
    await t.db.statement('write', "update google_connections set state = 'not_synced' where user_id = 'usr_003'");
    expect(ok(await t.call('usr_003', 'google.status', {}))).toMatchObject({ state: 'not_synced' });
    await t.db.statement('write', "update google_connections set state = 'broken' where user_id = 'usr_003'");
    expect(ok(await t.call('usr_003', 'google.status', {}))).toMatchObject({ state: 'broken' });
  });
});

describe('google.connectStart', () => {
  it('gives the Google address with a signed state of this person, the work email as hint, and the redirect address of the copy', async () => {
    const t = await googleOffice();
    const url = new URL(ok(await t.call('usr_003', 'google.connectStart', {})).url as string);
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('redirect_uri')).toBe('https://madar.example/api/google/callback');
    expect(url.searchParams.get('login_hint')).toBe('reem.al.ghamdi@madar.test');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.app.created');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(await stateOwner(url.searchParams.get('state')!, t.deps.clock.now())).toBe('usr_003');
    expect(url.toString()).not.toContain('cs-SECRET');
  });

  it('writes nothing: no row, no outbox row, no event, no signal, no call to Google', async () => {
    const t = await googleOffice();
    const events = await rowsOf(t, 'select count(*) as n from events');
    ok(await t.call('usr_003', 'google.connectStart', {}));
    expect(await rowsOf(t, 'select * from google_connections')).toEqual([]);
    expect(await rowsOf(t, 'select * from outbox')).toEqual([]);
    expect(await rowsOf(t, 'select count(*) as n from events')).toEqual(events);
    expect(t.deps.signal.sent).toEqual([]);
    expect(t.google.requests).toEqual([]);
  });
});

describe('google.connect', () => {
  it('stores a sealed token (no column holds the plain token), the calendar id, and answers ok with the number of meetings on their way', async () => {
    const t = await googleOffice();
    await planMeeting(t, 'usr_003', { startsAt: days(2) });
    const answer = ok(await t.connect('usr_003'));
    expect(answer).toEqual({ state: 'ok', meetings: 1 });
    const [row] = await rowsOf(t, 'select * from google_connections');
    expect(row).toMatchObject({ user_id: 'usr_003', state: 'ok', calendar_id: 'cal-1@group.calendar.google.com', last_error: null });
    expect(String(row.sealed_token)).toMatch(/^v1\./);
    for (const value of Object.values(row)) expect(String(value)).not.toContain('rt-SECRET');
    expect(await openToken(await googleKeysOf(GOOGLE_KEY), 'usr_003', String(row.sealed_token))).toBe('rt-SECRET');
  });

  it('exchanges the code with the verifier of the state and the redirect address, and makes the calendar Madar', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    const token = t.google.requests.find((request) => request.path === '/token')!;
    expect(token.body).toMatchObject({ grant_type: 'authorization_code', code: 'code-SECRET', redirect_uri: 'https://madar.example/api/google/callback' });
    expect(await challengeOf((token.body as { code_verifier: string }).code_verifier)).toBe(t.google.state.challenge);
    const calendar = t.google.requests.find((request) => request.path === '/calendar/v3/calendars')!;
    expect(calendar.body).toEqual({ summary: 'Madar', timeZone: 'Asia/Riyadh' });
  });

  it('writes one gcal.sync row for each upcoming meeting of the person, and none for the meetings of other people, a cancelled one, a past one and one 61 days ahead', async () => {
    const t = await googleOffice();
    const mine = await planMeeting(t, 'usr_003', { startsAt: days(2) });
    const attending = await planMeeting(t, 'usr_004', { startsAt: days(3), attendeeIds: ['usr_003'] });
    await planMeeting(t, 'usr_004', { startsAt: days(4) });
    const cancelled = await planMeeting(t, 'usr_003', { startsAt: days(5) });
    ok(await t.call('usr_003', 'meetings.cancel', { id: cancelled }));
    await planMeeting(t, 'usr_003', { startsAt: '2026-10-21T08:00:00.000+03:00' });
    await planMeeting(t, 'usr_003', { startsAt: '2026-12-21T10:00:00.000+03:00' });
    const far = await planMeeting(t, 'usr_003', { startsAt: '2026-12-19T10:00:00.000+03:00' });
    expect(ok(await t.connect('usr_003'))).toEqual({ state: 'ok', meetings: 3 });
    const rows = await outboxRows(t, 'gcal.sync');
    const sorted = (list: { userId: string; meetingId: unknown }[]) => [...list].sort((a, b) => String(a.meetingId).localeCompare(String(b.meetingId)));
    expect(sorted(rows.map((row) => row.payload as { userId: string; meetingId: string }))).toEqual(
      sorted([{ userId: 'usr_003', meetingId: mine }, { userId: 'usr_003', meetingId: attending }, { userId: 'usr_003', meetingId: far }]),
    );
  });

  it('writes at most 200 sync rows', async () => {
    const t = await googleOffice();
    const start = new Date('2026-10-22T07:00:00Z');
    await t.db.tx('write', async (q) => {
      for (let i = 0; i < 230; i += 1) {
        const at = nowStamp(new Date(start.getTime() + i * 3_600_000));
        const doc = {
          id: `mtg_9${String(i).padStart(3, '0')}`, kind: 'meeting', title: `Meeting ${i}`, projectId: null, startsAt: at, endsAt: at, where: '', guests: '', notes: '', organizerId: 'usr_003',
          attendeeIds: [], minutesById: null, status: 'scheduled', rev: 1, createdBy: 'usr_003', createdAt: at,
        };
        await q('insert into meetings (id, doc, project_id, organizer_id, starts_at, ends_at, status) values (?1, ?2, null, ?3, ?4, ?4, ?5)', [doc.id, doc, 'usr_003', at, 'scheduled']);
      }
    });
    expect(ok(await t.connect('usr_003'))).toEqual({ state: 'ok', meetings: 200 });
  });

  it('replaces the old row at a second connect: one live row, one revoke row that says replaced, no call to revoke at Google, and no old Google events', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    const [first] = await rowsOf(t, 'select id from google_connections');
    await t.db.statement('write', "insert into google_events (user_id, meeting_id, event_id, synced_rev, synced_at) values ('usr_003', 'mtg_001', 'ev1', 1, '2026-10-21T06:00:00.000Z')");
    t.deps.clock.advance(60_000);
    // The unique index allows one live row for each person, so the second connect works only when the same transaction made the old row revoking.
    expect(ok(await t.connect('usr_003'))).toMatchObject({ state: 'ok' });
    const rows = await rowsOf(t, 'select id, state, calendar_id from google_connections');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'ok', calendar_id: 'cal-2@group.calendar.google.com' });
    expect(rows[0].id).not.toBe(first.id);
    // The revoke row says replaced: the grant at Google is the grant of the new row, so the effect only deletes the old row.
    expect((await outboxRows(t, 'gcal.revoke')).map((row) => [row.payload, row.done])).toEqual([[{ connectionId: first.id, replaced: true }, true]]);
    expect(t.google.requests.filter((request) => request.path === '/revoke')).toEqual([]);
    // The Google events belong to the old calendar, so the new connection starts with none.
    expect(await rowsOf(t, 'select * from google_events')).toEqual([]);
  });

  it('gives forbidden google_link_person for the state of another person, and does not use the code', async () => {
    const t = await googleOffice();
    const start = ok(await t.call('usr_003', 'google.connectStart', {}));
    const state = new URL(start.url as string).searchParams.get('state')!;
    expect(await t.call('usr_004', 'google.connect', { code: 'code-SECRET', state })).toMatchObject({ ok: false, error: { code: 'forbidden', details: { reason: 'google_link_person' } } });
    expect(t.google.requests).toEqual([]);
    expect(await rowsOf(t, 'select * from google_connections')).toEqual([]);
  });

  it('gives google_link_old for a changed state and for a state older than 10 minutes, before any call to Google', async () => {
    const t = await googleOffice();
    const state = new URL(ok(await t.call('usr_003', 'google.connectStart', {})).url as string).searchParams.get('state')!;
    expect(await t.call('usr_003', 'google.connect', { code: 'code-SECRET', state: `${state}x` })).toMatchObject({ ok: false, error: { details: { reason: 'google_link_old' } } });
    t.deps.clock.advance(11 * 60_000);
    expect(await t.call('usr_003', 'google.connect', { code: 'code-SECRET', state })).toMatchObject({ ok: false, error: { code: 'invalid_input', details: { reason: 'google_link_old' } } });
    expect(t.google.requests).toEqual([]);
  });

  it('gives google_link_old when Google says invalid_grant (a used code), and google_unreachable when Google fails', async () => {
    const t = await googleOffice();
    expect(await t.connect('usr_003', 'a-used-code')).toMatchObject({ ok: false, error: { details: { reason: 'google_link_old' } } });
    const down = await googleOffice();
    down.google.failAll((request) => request.path === '/token', 503);
    expect(await down.connect('usr_003')).toMatchObject({ ok: false, error: { code: 'failed', details: { reason: 'google_unreachable' } } });
    const lost = await googleOffice();
    lost.deps.googleFetch = (async () => { throw new TypeError('connect ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await lost.connect('usr_003')).toMatchObject({ ok: false, error: { details: { reason: 'google_unreachable' } } });
    for (const office of [t, down, lost]) expect(await rowsOf(office, 'select * from google_connections')).toEqual([]);
  });

  it('revokes what came back and gives google_denied when there is no refresh token', async () => {
    const t = await googleOffice({ fake: { noRefreshToken: true } });
    expect(await t.connect('usr_003')).toMatchObject({ ok: false, error: { code: 'invalid_input', details: { reason: 'google_denied' } } });
    expect(t.google.requests.filter((request) => request.path === '/revoke').map((request) => request.body)).toEqual([{ token: 'at-SECRET' }]);
    expect(await rowsOf(t, 'select * from google_connections')).toEqual([]);
    expect(await rowsOf(t, 'select * from outbox')).toEqual([]);
  });

  it('revokes the refresh token and gives google_denied when the calendar scope is absent', async () => {
    const t = await googleOffice({ fake: { scope: 'openid email' } });
    expect(await t.connect('usr_003')).toMatchObject({ ok: false, error: { details: { reason: 'google_denied' } } });
    expect(t.google.requests.filter((request) => request.path === '/revoke').map((request) => request.body)).toEqual([{ token: 'rt-SECRET' }]);
    expect(t.google.requests.some((request) => request.path.startsWith('/calendar/'))).toBe(false);
    expect(await rowsOf(t, 'select * from google_connections')).toEqual([]);
  });

  it('writes nothing and revokes the grant when the calendar cannot be made', async () => {
    const t = await googleOffice();
    t.google.failAll((request) => request.path === '/calendar/v3/calendars', 500);
    expect(await t.connect('usr_003')).toMatchObject({ ok: false, error: { code: 'failed', details: { reason: 'google_unreachable' } } });
    expect(t.google.requests.filter((request) => request.path === '/revoke').map((request) => request.body)).toEqual([{ token: 'rt-SECRET' }]);
    expect(await rowsOf(t, 'select * from google_connections')).toEqual([]);
  });

  it('writes no event and sends no signal', async () => {
    const t = await googleOffice();
    const events = await rowsOf(t, 'select count(*) as n from events');
    ok(await t.connect('usr_003'));
    ok(await t.call('usr_003', 'google.disconnect', {}));
    expect(await rowsOf(t, 'select count(*) as n from events')).toEqual(events);
    expect(t.deps.signal.sent).toEqual([]);
  });

  it('gives the stored answer for the same idempotency key, and uses the code once', async () => {
    const t = await googleOffice();
    const url = new URL(ok(await t.call('usr_003', 'google.connectStart', {})).url as string);
    t.google.state.challenge = url.searchParams.get('code_challenge') ?? undefined;
    const input = { code: 'code-SECRET', state: url.searchParams.get('state')! };
    const first = await t.callAs({ userId: 'usr_003' }, 'google.connect', input, 'key-1');
    const second = await t.callAs({ userId: 'usr_003' }, 'google.connect', input, 'key-1');
    expect(first).toMatchObject({ ok: true, output: { state: 'ok', meetings: 0 } });
    expect(second).toEqual(first);
    expect(t.google.requests.filter((request) => request.path === '/token')).toHaveLength(1);
    expect(await rowsOf(t, 'select * from google_connections')).toHaveLength(1);
  });
});

describe('google.disconnect', () => {
  it('gives none, removes the Google event rows of the person, and writes one revoke row; the row stays revoking while Google is down', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    await t.db.statement('write', "insert into google_events (user_id, meeting_id, event_id, synced_rev, synced_at) values ('usr_003', 'mtg_001', 'ev1', 1, '2026-10-21T06:00:00.000Z'), ('usr_004', 'mtg_001', 'ev2', 1, '2026-10-21T06:00:00.000Z')");
    const [connection] = await rowsOf(t, 'select id from google_connections');
    t.google.failAll((request) => request.path === '/revoke', 503);
    expect(ok(await t.call('usr_003', 'google.disconnect', {}))).toEqual({ state: 'none' });
    expect(await rowsOf(t, 'select user_id from google_events')).toEqual([{ user_id: 'usr_004' }]);
    expect(await rowsOf(t, 'select state from google_connections')).toEqual([{ state: 'revoking' }]);
    expect((await outboxRows(t, 'gcal.revoke')).map((row) => [row.payload, row.done])).toEqual([[{ connectionId: connection.id }, false]]);
    expect(ok(await t.call('usr_003', 'google.status', {}))).toMatchObject({ state: 'none' });
  });

  it('takes the grant back at Google and deletes the row when Google answers', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    expect(ok(await t.call('usr_003', 'google.disconnect', {}))).toEqual({ state: 'none' });
    expect(await rowsOf(t, 'select * from google_connections')).toEqual([]);
    expect(t.google.requests.filter((request) => request.path === '/revoke').map((request) => request.body)).toEqual([{ token: 'rt-SECRET' }]);
  });

  it('gives the same answer to a person with no row, and changes nothing', async () => {
    const t = await googleOffice();
    expect(ok(await t.call('usr_003', 'google.disconnect', {}))).toEqual({ state: 'none' });
    expect(await rowsOf(t, 'select * from outbox')).toEqual([]);
  });

  it('leaves the row and the events of another person', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    ok(await t.connect('usr_004'));
    await t.db.statement('write', "insert into google_events (user_id, meeting_id, event_id, synced_rev, synced_at) values ('usr_004', 'mtg_001', 'ev2', 1, '2026-10-21T06:00:00.000Z')");
    ok(await t.call('usr_003', 'google.disconnect', {}));
    expect(await rowsOf(t, 'select user_id, state from google_connections order by user_id')).toEqual([{ user_id: 'usr_004', state: 'ok' }]);
    expect(await rowsOf(t, 'select user_id from google_events')).toEqual([{ user_id: 'usr_004' }]);
  });
});
