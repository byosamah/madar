import { describe, expect, it, vi } from 'vitest';
import { nowStamp } from '../../src/lib/dates';
import { googleKeysOf, openToken } from '../google/keys';
import { GOOGLE_SCOPE } from '../google/api';
import { KNOWN_SECRETS } from '../google/fakeGoogle';
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

  it('replaces the old row at a second connect: one live row on the same calendar, one revoke row that says replaced, no call to revoke at Google, and no old Google events', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    const [first] = await rowsOf(t, 'select id from google_connections');
    await t.db.statement('write', "insert into google_events (user_id, meeting_id, event_id, synced_rev, synced_at) values ('usr_003', 'mtg_001', 'ev1', 1, '2026-10-21T06:00:00.000Z')");
    t.deps.clock.advance(60_000);
    // The unique index allows one live row for each person, so the second connect works only when the same transaction made the old row revoking.
    expect(ok(await t.connect('usr_003'))).toMatchObject({ state: 'ok' });
    const rows = await rowsOf(t, 'select id, state, calendar_id from google_connections');
    expect(rows).toHaveLength(1);
    // The calendar of the person is the one that Madar made at the first connect (owner test 2026-10-20): no second calendar.
    expect(rows[0]).toMatchObject({ state: 'ok', calendar_id: 'cal-1@group.calendar.google.com' });
    expect(t.google.calendars.size).toBe(1);
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

const CAL1 = 'cal-1@group.calendar.google.com';
const CAL2 = 'cal-2@group.calendar.google.com';
const isGetCalendar = (request: { method: string; path: string }) => request.method === 'GET' && /^\/calendar\/v3\/calendars\/[^/]+$/.test(request.path);
const makes = (t: GoogleOffice) => t.google.requests.filter((request) => request.method === 'POST' && request.path === '/calendar/v3/calendars');
const remembered = (t: GoogleOffice) => rowsOf(t, 'select user_id, calendar_id, changed_at from google_calendars order by user_id');
const liveCalendar = (t: GoogleOffice) => rowsOf(t, "select calendar_id from google_connections where state <> 'revoking'");

describe('one calendar for each person (owner test 2026-10-20: a second calendar after Disconnect and Connect)', () => {
  it('makes the calendar at the first connect, remembers its id, reads no calendar first, and writes no gcal.tidy row', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    expect(makes(t)).toHaveLength(1);
    expect(t.google.requests.filter(isGetCalendar)).toEqual([]);
    expect(await remembered(t)).toEqual([{ user_id: 'usr_003', calendar_id: CAL1, changed_at: '2026-10-21T06:00:00.000Z' }]);
    expect(await outboxRows(t, 'gcal.tidy')).toEqual([]);
  });

  it('uses the same calendar at a connect after a disconnect: no second calendar, the row unchanged, one gcal.tidy row', async () => {
    const t = await googleOffice();
    await planMeeting(t, 'usr_003', { startsAt: days(2) });
    ok(await t.connect('usr_003'));
    const first = await remembered(t);
    ok(await t.call('usr_003', 'google.disconnect', {}));
    // The disconnect keeps the id on purpose.
    expect(await remembered(t)).toEqual(first);
    t.deps.clock.advance(60_000);
    t.google.requests.length = 0;
    expect(ok(await t.connect('usr_003'))).toEqual({ state: 'ok', meetings: 1 });
    expect(makes(t)).toEqual([]);
    expect(t.google.calendars.size).toBe(1);
    expect(t.google.state.calendars).toBe(1);
    // It asked Google for the remembered calendar with the new access token.
    const asked = t.google.requests.filter(isGetCalendar);
    expect(asked.map((request) => decodeURIComponent(request.path))).toEqual([`/calendar/v3/calendars/${CAL1}`]);
    expect(asked[0].headers.authorization).toBe('Bearer at-SECRET');
    expect(await remembered(t)).toEqual(first);
    expect(await liveCalendar(t)).toEqual([{ calendar_id: CAL1 }]);
    expect((await outboxRows(t, 'gcal.tidy')).map((row) => [row.payload, row.done])).toEqual([[{ userId: 'usr_003' }, true]]);
    // The meeting is in the one calendar, once.
    expect([...t.google.eventsOf(CAL1).values()].filter((event) => event.status === 'confirmed')).toHaveLength(1);
  });

  it('writes the gcal.tidy row after the sync rows, so the tidy runs when the backfill is done', async () => {
    const t = await googleOffice();
    await planMeeting(t, 'usr_003', { startsAt: days(2) });
    ok(await t.connect('usr_003'));
    ok(await t.call('usr_003', 'google.disconnect', {}));
    ok(await t.connect('usr_003'));
    const order = (await rowsOf(t, "select id, kind from outbox where kind in ('gcal.sync', 'gcal.tidy', 'gcal.revoke') order by id")).map((row) => row.kind);
    expect(order.at(-1)).toBe('gcal.tidy');
    expect(order.filter((kind) => kind === 'gcal.tidy')).toHaveLength(1);
    expect(order.lastIndexOf('gcal.sync')).toBeLessThan(order.indexOf('gcal.tidy'));
  });

  it('reuses the calendar of a person whose connection ended (broken) as well, and keeps the id of another person apart', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    ok(await t.connect('usr_004'));
    await t.db.statement('write', "update google_connections set state = 'broken', sealed_token = null where user_id = 'usr_003'");
    ok(await t.connect('usr_003'));
    expect(t.google.calendars.size).toBe(2);
    expect(await remembered(t)).toEqual([
      expect.objectContaining({ user_id: 'usr_003', calendar_id: CAL1 }),
      expect.objectContaining({ user_id: 'usr_004', calendar_id: CAL2 }),
    ]);
    expect((await outboxRows(t, 'gcal.tidy')).map((row) => row.payload)).toEqual([{ userId: 'usr_003' }]);
  });

  it('makes a new calendar and remembers it when Google says 404 for the remembered one (the person deleted it), with no gcal.tidy row', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    ok(await t.call('usr_003', 'google.disconnect', {}));
    t.google.deleteCalendar(CAL1);
    t.deps.clock.advance(60_000);
    ok(await t.connect('usr_003'));
    expect(t.google.requests.filter(isGetCalendar)).toHaveLength(1);
    expect(makes(t)).toHaveLength(2);
    expect(await remembered(t)).toEqual([{ user_id: 'usr_003', calendar_id: CAL2, changed_at: '2026-10-21T06:01:00.000Z' }]);
    expect(await liveCalendar(t)).toEqual([{ calendar_id: CAL2 }]);
    expect(await outboxRows(t, 'gcal.tidy')).toEqual([]);
  });

  it('makes a new calendar for a 410 as well', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    ok(await t.call('usr_003', 'google.disconnect', {}));
    t.google.failAll(isGetCalendar, 410);
    ok(await t.connect('usr_003'));
    expect(makes(t)).toHaveLength(2);
    expect(await remembered(t)).toEqual([expect.objectContaining({ user_id: 'usr_003', calendar_id: CAL2 })]);
  });

  it('fails the connect and makes no second calendar for a timeout, a network error, a 5xx, a 429, a 401 or a 403 on the remembered calendar', async () => {
    const answers: [string, (t: GoogleOffice) => void][] = [
      ['500', (t) => t.google.failAll(isGetCalendar, 500)],
      ['503', (t) => t.google.failAll(isGetCalendar, 503)],
      ['429', (t) => t.google.failAll(isGetCalendar, 429)],
      ['401', (t) => t.google.failAll(isGetCalendar, 401)],
      ['403', (t) => t.google.failAll(isGetCalendar, 403)],
      ['network', (t) => t.google.on(isGetCalendar, () => { throw new TypeError('connect ECONNREFUSED 10.0.0.1'); })],
    ];
    for (const [name, fail] of answers) {
      const t = await googleOffice();
      ok(await t.connect('usr_003'));
      const first = await remembered(t);
      ok(await t.call('usr_003', 'google.disconnect', {}));
      fail(t);
      t.google.requests.length = 0;
      expect(await t.connect('usr_003'), name).toMatchObject({ ok: false, error: { code: 'failed', details: { reason: 'google_unreachable' } } });
      expect(makes(t), name).toEqual([]);
      expect(t.google.calendars.size, name).toBe(1);
      // The new grant goes back at once (as at a calendar that cannot be made), nothing is stored, and the remembered id stays.
      expect(t.google.requests.filter((request) => request.path === '/revoke').map((request) => request.body), name).toEqual([{ token: 'rt-SECRET' }]);
      expect(await rowsOf(t, 'select * from google_connections'), name).toEqual([]);
      expect(await remembered(t), name).toEqual(first);
      expect(await outboxRows(t, 'gcal.tidy'), name).toEqual([]);
    }
  });

  it('lets the person press Connect again after a failure: the next connect reuses the calendar', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    ok(await t.call('usr_003', 'google.disconnect', {}));
    t.google.failAll(isGetCalendar, 503);
    expect(await t.connect('usr_003')).toMatchObject({ ok: false });
    t.google.clearRules();
    ok(await t.connect('usr_003'));
    expect(t.google.calendars.size).toBe(1);
    expect(await liveCalendar(t)).toEqual([{ calendar_id: CAL1 }]);
  });

  it('keeps the remembered id when the connect fails before the calendar step (a used code)', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    ok(await t.call('usr_003', 'google.disconnect', {}));
    expect(await t.connect('usr_003', 'a-used-code')).toMatchObject({ ok: false, error: { details: { reason: 'google_link_old' } } });
    expect((await remembered(t)).map((row) => row.calendar_id)).toEqual([CAL1]);
  });

  it('reads the remembered calendar of the person who connects and no other person', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_004'));
    ok(await t.call('usr_004', 'google.disconnect', {}));
    t.google.requests.length = 0;
    ok(await t.connect('usr_003'));
    expect(t.google.requests.filter(isGetCalendar)).toEqual([]);
    expect(makes(t)).toHaveLength(1);
    expect((await remembered(t)).map((row) => [row.user_id, row.calendar_id])).toEqual([['usr_003', CAL2], ['usr_004', CAL1]]);
  });
});

// fbk_033 (2026-10-20): 3 of the 4 connects on production failed with google_unreachable. Each failed call ran 3.5 to 3.7 s, and the one
// that worked ran 3.3 s: a Google step of the connect needed about 3 s, and the limit of 3 s cut it.
describe('the time limit of a connect (fbk_033)', () => {
  const isMake = (request: { method: string; path: string }) => request.method === 'POST' && request.path === '/calendar/v3/calendars';
  const isToken = (request: { path: string }) => request.path === '/token';
  const TOKENS = { access_token: 'at-SECRET', refresh_token: 'rt-SECRET', expires_in: 3600, scope: GOOGLE_SCOPE };
  const late = (t: GoogleOffice, ms: number, body: unknown) => (): Promise<Response> =>
    new Promise((resolve) => { setTimeout(() => resolve(t.google.reply(body)), ms); });
  const failures = (t: GoogleOffice) => t.deps.logs.filter((line) => line.message === 'A Google Calendar connect failed.').map((line) => line.fields);
  // The crypto of the connect runs outside the fake clock, so the clock moves in small steps until the call answers.
  async function settle<T>(pending: Promise<T>): Promise<T> {
    let done = false;
    void pending.finally(() => { done = true; });
    for (let step = 0; step < 400 && !done; step += 1) {
      await vi.advanceTimersByTimeAsync(100);
      await new Promise((resolve) => { setImmediate(resolve); });
    }
    return pending;
  }
  async function connectWithClock(t: GoogleOffice) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      return await settle(t.connect('usr_003'));
    } finally {
      vi.useRealTimers();
    }
  }

  it('waits more than 3 s for Google: a calendar that comes after 4 s connects', async () => {
    const t = await googleOffice();
    t.google.on(isMake, late(t, 4000, { id: 'cal-slow@group.calendar.google.com' }));
    expect(ok(await connectWithClock(t))).toMatchObject({ state: 'ok' });
    expect((await rowsOf(t, 'select calendar_id from google_connections')).map((row) => row.calendar_id)).toEqual(['cal-slow@group.calendar.google.com']);
  });

  it('gives the code swap, the first call to Google, up to 10 s', async () => {
    const t = await googleOffice();
    t.google.on(isToken, late(t, 8000, TOKENS));
    expect(ok(await connectWithClock(t))).toMatchObject({ state: 'ok' });
    expect(failures(t)).toEqual([]);
  });

  it('stops one call at 10 s, takes the grant back, stores nothing, and logs a timeout of the calendar step', async () => {
    const t = await googleOffice();
    t.google.on(isMake, late(t, 11_000, { id: 'cal-late@group.calendar.google.com' }));
    expect(await connectWithClock(t)).toMatchObject({ ok: false, error: { details: { reason: 'google_unreachable' } } });
    expect(t.google.requests.filter((request) => request.path === '/revoke')).toHaveLength(1);
    expect(await rowsOf(t, 'select * from google_connections')).toEqual([]);
    expect(failures(t)).toEqual([{ userId: 'usr_003', step: 'calendar_make', code: 'timeout' }]);
  });

  it('shares one budget of 15 s: after a code swap of 9 s, a calendar that comes after 7 s is too late', async () => {
    const t = await googleOffice();
    t.google.on(isToken, late(t, 9000, TOKENS));
    t.google.on(isMake, late(t, 7000, { id: 'cal-late@group.calendar.google.com' }));
    expect(await connectWithClock(t)).toMatchObject({ ok: false, error: { details: { reason: 'google_unreachable' } } });
    expect(failures(t)).toEqual([{ userId: 'usr_003', step: 'calendar_make', code: 'timeout' }]);
    expect(await rowsOf(t, 'select * from google_connections')).toEqual([]);
  });
});


// fbk_033 (2026-10-20): a connect on production answered google_unreachable, and no log line said which Google call failed or how.
describe('the log of a failed connect (fbk_033)', () => {
  const lineOf = (t: GoogleOffice) => t.deps.logs.filter((line) => line.message === 'A Google Calendar connect failed.');

  it('names the step, the code and the HTTP status of the Google call that failed, and nothing more', async () => {
    const token = await googleOffice();
    token.google.failAll((request) => request.path === '/token', 503);
    expect(await token.connect('usr_003')).toMatchObject({ ok: false, error: { details: { reason: 'google_unreachable' } } });
    expect(lineOf(token)).toEqual([{ level: 'warn', message: 'A Google Calendar connect failed.', fields: { userId: 'usr_003', step: 'token', code: 'server', status: 503 } }]);

    const make = await googleOffice();
    make.google.failAll((request) => request.path === '/calendar/v3/calendars', 500);
    await make.connect('usr_003');
    expect(lineOf(make).map((line) => line.fields)).toEqual([{ userId: 'usr_003', step: 'calendar_make', code: 'server', status: 500 }]);

    const read = await googleOffice();
    ok(await read.connect('usr_003'));
    ok(await read.call('usr_003', 'google.disconnect', {}));
    read.google.failAll(isGetCalendar, 403);
    expect(await read.connect('usr_003')).toMatchObject({ ok: false, error: { details: { reason: 'google_unreachable' } } });
    expect(lineOf(read).map((line) => line.fields)).toEqual([{ userId: 'usr_003', step: 'calendar_read', code: 'refused', status: 403 }]);

    // A network error has no status. The text of the error never reaches the line.
    const lost = await googleOffice();
    lost.deps.googleFetch = (async () => { throw new TypeError('connect ECONNREFUSED 10.0.0.1'); }) as unknown as typeof fetch;
    await lost.connect('usr_003');
    expect(lineOf(lost).map((line) => line.fields)).toEqual([{ userId: 'usr_003', step: 'token', code: 'unreachable' }]);
    expect(JSON.stringify(lost.deps.logs)).not.toContain('ECONNREFUSED');
  });

  it('logs a refusal of Google as well (google_denied), and holds no secret', async () => {
    const t = await googleOffice();
    t.google.failAll((request) => request.path === '/calendar/v3/calendars', 403, { error: { message: 'rt-SECRET cs-SECRET' } });
    expect(await t.connect('usr_003')).toMatchObject({ ok: false, error: { details: { reason: 'google_denied' } } });
    expect(lineOf(t).map((line) => line.fields)).toEqual([{ userId: 'usr_003', step: 'calendar_make', code: 'refused', status: 403 }]);
    for (const secret of KNOWN_SECRETS) expect(JSON.stringify(t.deps.logs)).not.toContain(secret);
  });

  it('names a grant with no refresh token or with no calendar scope', async () => {
    const none = await googleOffice({ fake: { noRefreshToken: true } });
    await none.connect('usr_003');
    expect(lineOf(none).map((line) => line.fields)).toEqual([{ userId: 'usr_003', step: 'token', code: 'no_refresh_token' }]);
    const narrow = await googleOffice({ fake: { scope: 'openid email' } });
    await narrow.connect('usr_003');
    expect(lineOf(narrow).map((line) => line.fields)).toEqual([{ userId: 'usr_003', step: 'token', code: 'scope_missing' }]);
  });

  it('writes no line for a connect that works, also when the remembered calendar is gone (404)', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    expect(lineOf(t)).toEqual([]);
    ok(await t.call('usr_003', 'google.disconnect', {}));
    t.google.failAll(isGetCalendar, 404);
    ok(await t.connect('usr_003'));
    expect(lineOf(t)).toEqual([]);
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

  it('keeps the remembered calendar id of the person (a new connect uses the same calendar)', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    ok(await t.call('usr_003', 'google.disconnect', {}));
    expect(await rowsOf(t, 'select user_id, calendar_id from google_calendars')).toEqual([{ user_id: 'usr_003', calendar_id: 'cal-1@group.calendar.google.com' }]);
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
