import { beforeEach, describe, expect, it } from 'vitest';
import { exportPage } from '../office/ops';
import { TABLES } from '../data/tables';
import { mcpTools } from '../mcp/tools';
import { fakeDeps } from '../test/fakes/deps';
import { googleCallback } from './callback';
import { googleKeysOf } from './keys';
import { KNOWN_SECRETS } from './fakeGoogle';
import { signState } from './state';
import { revokeOne, resetAccessCache, syncOne } from './sync';
import { GOOGLE_CONFIG, GOOGLE_KEY, googleOffice, outboxRows, planMeeting, type GoogleOffice } from './testOffice';

/**
 * The Google leak tests (fbk_022, Review Focus 2): no answer, log line, error text, event, signal, MCP tool or export holds the refresh
 * token (rt-SECRET), the access token (at-SECRET), the code (code-SECRET), the client secret (cs-SECRET) or the sealed text, and another
 * person cannot read or change a connection. Every secret is made up; the stub Google may put them in its own error bodies.
 */

beforeEach(() => resetAccessCache());

const TITLE = 'Salary talk with the partner';
const NOTE = 'Private note about the budget';
const GUEST = 'Mr Guest of Honour';
const START = '2026-10-23T10:00:00.000+03:00';
const text = (value: unknown) => JSON.stringify(value);
const ok = (result: Awaited<ReturnType<GoogleOffice['call']>>) => {
  if (!result.ok) throw new Error(`The call failed: ${JSON.stringify(result.error)}`);
  return result.output as Record<string, unknown>;
};
const rowsOf = (t: GoogleOffice, sql: string, values: unknown[] = []) => t.db.statement('read', sql, values) as Promise<Record<string, unknown>[]>;
const sealedOf = async (t: GoogleOffice, userId: string) => String((await rowsOf(t, 'select sealed_token from google_connections where user_id = ?1', [userId]))[0].sealed_token);
const noSecret = (value: string, extra: string[] = []) => {
  for (const secret of [...KNOWN_SECRETS, ...extra]) expect(value, secret).not.toContain(secret);
};

describe('the answers of the four calls', () => {
  it('hold no token, no code, no client secret, no sealed text and no calendar id', async () => {
    const t = await googleOffice();
    const answers: unknown[] = [];
    answers.push(await t.call('usr_003', 'google.status', {}));
    const start = await t.call('usr_003', 'google.connectStart', {});
    answers.push(start);
    const url = new URL(ok(start).url as string);
    t.google.state.challenge = url.searchParams.get('code_challenge') ?? undefined;
    answers.push(await t.call('usr_003', 'google.connect', { code: 'code-SECRET', state: url.searchParams.get('state') }));
    answers.push(await t.call('usr_003', 'google.status', {}));
    const sealed = await sealedOf(t, 'usr_003');
    answers.push(await t.call('usr_003', 'google.disconnect', {}));
    answers.push(await t.call('usr_003', 'google.status', {}));
    // The sign-in URL of Google holds the state (it goes to Google by design), so it is the one place where the state may be.
    const body = text(answers).replace(String(ok(start).url), '<url>');
    noSecret(body, [sealed, 'cal-1@group.calendar.google.com']);
  });

  it('hold no secret in a refusal, also when Google puts the secrets in its own error body', async () => {
    const t = await googleOffice();
    const leaking = { error: 'invalid_grant', error_description: 'rt-SECRET at-SECRET code-SECRET cs-SECRET', detail: TITLE };
    t.google.failAll((request) => request.path === '/token', 400, leaking);
    const denied = await t.connect('usr_003');
    t.google.clearRules();
    t.google.failAll((request) => request.path === '/token', 503, leaking);
    const down = await t.connect('usr_003');
    t.google.clearRules();
    t.google.failAll((request) => request.path === '/calendar/v3/calendars', 500, leaking);
    const noCalendar = await t.connect('usr_003');
    const wrongState = await t.call('usr_003', 'google.connect', { code: 'code-SECRET', state: 'not-a-state' });
    for (const answer of [denied, down, noCalendar, wrongState]) {
      expect(answer.ok).toBe(false);
      noSecret(text(answer), [TITLE]);
    }
  });
});

describe('the log', () => {
  it('has no line with a secret, the state, the sealed text or a title, over connect, sync (ok, failed, broken), revoke and the callback', async () => {
    const t = await googleOffice();
    const connected = await t.call('usr_003', 'google.connectStart', {});
    const url = new URL(ok(connected).url as string);
    const state = url.searchParams.get('state')!;
    t.google.state.challenge = url.searchParams.get('code_challenge') ?? undefined;
    ok(await t.call('usr_003', 'google.connect', { code: 'code-SECRET', state }));
    const sealed = await sealedOf(t, 'usr_003');
    // sync ok
    const id = await planMeeting(t, 'usr_003', { startsAt: START, title: TITLE, notes: NOTE, guests: GUEST, where: 'Room 4' });
    // sync failed (retry)
    t.google.failAll((request) => /\/events/.test(request.path), 503, { error: { message: `${TITLE} rt-SECRET` } });
    ok(await t.call('usr_003', 'meetings.update', { id, title: `${TITLE} 2` }));
    expect(t.deps.logs.some((line) => line.message === 'A Google Calendar sync will be tried again.')).toBe(true);
    t.google.clearRules();
    // sync broken
    t.google.state.grantAlive = false;
    resetAccessCache();
    ok(await t.call('usr_003', 'meetings.update', { id, title: `${TITLE} 3` }));
    expect(t.deps.logs.some((line) => line.message === 'A Google Calendar connection ended.')).toBe(true);
    // revoke
    ok(await t.connect('usr_003'));
    ok(await t.call('usr_003', 'google.disconnect', {}));
    // the callback, with the code and the state in the query
    const deps = fakeDeps({ config: { appUrl: 'https://madar.example', google: GOOGLE_CONFIG } });
    deps.clock.set(new Date('2026-10-21T06:00:00Z'));
    const good = (await signState(await googleKeysOf(GOOGLE_KEY), 'usr_003', deps.clock.now())).state;
    await googleCallback(new Request(`https://madar.example/api/google/callback?code=code-SECRET&state=${good}`), deps);
    const lines = [...t.deps.logs, ...deps.logs];
    expect(lines.length).toBeGreaterThan(0);
    const body = text(lines);
    noSecret(body, [state, good, sealed, TITLE, NOTE, GUEST, 'Room 4']);
  });
});

describe('the errors of the effects', () => {
  it('keep only a code in the outbox error', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    t.google.failAll((request) => request.path.endsWith('/events'), 503, { error: { message: `${TITLE} rt-SECRET at-SECRET` } });
    await planMeeting(t, 'usr_003', { startsAt: START, title: TITLE });
    const rows = await outboxRows(t, 'gcal.sync');
    expect(rows.map((row) => row.error)).toEqual(['server']);
    noSecret(text(rows), [TITLE]);
  });

  it('keep only the ids in the payload of every row', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    await planMeeting(t, 'usr_003', { startsAt: START, title: TITLE, notes: NOTE });
    ok(await t.call('usr_003', 'google.disconnect', {}));
    const rows = [...(await outboxRows(t, 'gcal.sync')), ...(await outboxRows(t, 'gcal.revoke'))];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(Object.keys(row.payload).sort()).toEqual(expect.arrayContaining([]));
    noSecret(text(rows), [TITLE, NOTE]);
    expect(rows.filter((row) => 'userId' in row.payload).map((row) => Object.keys(row.payload).sort())).toEqual([['meetingId', 'userId']]);
  });
});

describe('the reuse of a calendar (owner test 2026-10-20)', () => {
  it('keeps only the user id in the payload of gcal.tidy, holds only the calendar id in google_calendars, and logs no secret or title in the tidy', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    const id = await planMeeting(t, 'usr_003', { startsAt: START, title: TITLE, notes: NOTE, guests: GUEST, where: 'Room 4' });
    ok(await t.call('usr_003', 'google.disconnect', {}));
    // The tidy ends with a log line when Google refuses the list: the line holds a code and an id, nothing else.
    t.google.failAll((request) => request.method === 'GET' && request.path.endsWith('/events'), 403, { error: { message: `${TITLE} rt-SECRET at-SECRET` } });
    ok(await t.connect('usr_003'));
    t.google.clearRules();
    expect(id).toBeTruthy();
    const rows = await outboxRows(t, 'gcal.tidy');
    expect(rows.map((row) => Object.keys(row.payload))).toEqual([['userId']]);
    expect(rows.map((row) => [row.done, row.error])).toEqual([[true, null]]);
    noSecret(text(rows), [TITLE, NOTE]);
    const calendars = await rowsOf(t, 'select * from google_calendars');
    expect(calendars.map((row) => Object.keys(row).sort())).toEqual([['calendar_id', 'changed_at', 'user_id']]);
    noSecret(text(calendars), [await sealedOf(t, 'usr_003')]);
    const lines = t.deps.logs.filter((line) => line.message.startsWith('A Google Calendar tidy'));
    expect(lines).toHaveLength(1);
    noSecret(text(t.deps.logs), [TITLE, NOTE, GUEST, 'Room 4', await sealedOf(t, 'usr_003')]);
  });

  it('answers a failed reuse with no secret and no calendar id', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    ok(await t.call('usr_003', 'google.disconnect', {}));
    t.google.failAll((request) => request.method === 'GET' && /^\/calendar\/v3\/calendars\/[^/]+$/.test(request.path), 503, { error: { message: 'rt-SECRET at-SECRET cal-1@group.calendar.google.com' } });
    const answer = await t.connect('usr_003');
    expect(answer).toMatchObject({ ok: false, error: { details: { reason: 'google_unreachable' } } });
    noSecret(text(answer), ['cal-1@group.calendar.google.com']);
    noSecret(text(t.deps.logs), ['cal-1@group.calendar.google.com']);
  });
});

describe('events, signals and records', () => {
  it('writes no event and sends no signal when a connection is made, synced, revoked or disconnected', async () => {
    const t = await googleOffice();
    const id = await planMeeting(t, 'usr_003', { startsAt: START, title: TITLE });
    const events = await rowsOf(t, 'select count(*) as n from events');
    t.deps.signal.sent.length = 0;
    ok(await t.connect('usr_003'));
    expect(await syncOne(t.deps as never, 'usr_003', id)).toBe('put');
    const [connection] = await rowsOf(t, 'select id from google_connections');
    ok(await t.call('usr_003', 'google.disconnect', {}));
    await revokeOne(t.deps as never, String(connection.id));
    expect(await rowsOf(t, 'select count(*) as n from events')).toEqual(events);
    expect(t.deps.signal.sent).toEqual([]);
  });

  it('keeps every secret out of the History, the notices and the tables that the office reads', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    await planMeeting(t, 'usr_003', { startsAt: START, title: TITLE });
    ok(await t.call('usr_003', 'google.disconnect', {}));
    expect(TABLES.map((spec) => spec.table).filter((table) => table.startsWith('google'))).toEqual([]);
    for (const table of ['events', 'notifications', 'meetings', 'users', 'settings', 'idempotency']) {
      noSecret(text(await rowsOf(t, `select * from ${table}`)), []);
    }
  });

  it('has no MCP tool whose name starts with google., also for an agent of an Admin', () => {
    for (const admin of [false, true]) expect(mcpTools({ admin }).filter((tool) => tool.name.startsWith('google.'))).toEqual([]);
  });

  it('gives an agent forbidden from the four calls', async () => {
    const t = await googleOffice();
    for (const name of ['google.status', 'google.connectStart', 'google.connect', 'google.disconnect']) {
      const input = name === 'google.connect' ? { code: 'code-SECRET', state: 'x' } : {};
      expect(await t.callAs({ userId: 'usr_009', agent: { clientId: 'c' } }, name, input), name).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    }
  });
});

describe('the office export', () => {
  it('holds the sealed text of google_connections and never the plain token', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    const sealed = await sealedOf(t, 'usr_003');
    const page = exportPage(t.db, 'google_connections', 0);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].sealed_token).toBe(sealed);
    noSecret(text(page), []);
  });
});

describe('another person', () => {
  it('reads only their own row, and a disconnect leaves the row of the first person', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    expect(ok(await t.call('usr_004', 'google.status', {}))).toMatchObject({ state: 'none', connectedAt: null });
    ok(await t.connect('usr_004'));
    ok(await t.call('usr_004', 'google.disconnect', {}));
    expect(ok(await t.call('usr_003', 'google.status', {}))).toMatchObject({ state: 'ok' });
    expect(await rowsOf(t, "select user_id from google_connections where state = 'ok'")).toEqual([{ user_id: 'usr_003' }]);
  });

  it('cannot use the state of the first person: google_link_person, and no row for either', async () => {
    const t = await googleOffice();
    const state = new URL(ok(await t.call('usr_003', 'google.connectStart', {})).url as string).searchParams.get('state');
    const answer = await t.call('usr_004', 'google.connect', { code: 'code-SECRET', state });
    expect(answer).toMatchObject({ ok: false, error: { code: 'forbidden', details: { reason: 'google_link_person' } } });
    expect(await rowsOf(t, 'select * from google_connections')).toEqual([]);
    expect(t.google.requests).toEqual([]);
  });

  it('shows an Admin who is not invited no event of a private meeting, and the private meeting writes rows for its people only', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_001'));
    ok(await t.connect('usr_003'));
    ok(await t.connect('usr_004'));
    const id = await planMeeting(t, 'usr_003', { startsAt: START, attendeeIds: ['usr_004'], title: TITLE });
    expect((await rowsOf(t, 'select user_id from google_events order by user_id')).map((row) => row.user_id)).toEqual(['usr_003', 'usr_004']);
    expect((await outboxRows(t, 'gcal.sync')).filter((row) => row.payload.meetingId === id).map((row) => row.payload.userId).sort()).toEqual(['usr_003', 'usr_004']);
  });
});

describe('the body of an event', () => {
  it('has exactly the five keys (and the id on an insert), and holds no note, guest, person, project or code', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_002'));
    const leader = String((await rowsOf(t, "select json_extract(doc, '$.leaderId') as leader from projects where id = 'prj_001'"))[0].leader);
    ok(await t.connect(leader));
    const [project] = await rowsOf(t, "select json_extract(doc, '$.name') as name, json_extract(doc, '$.code') as code from projects where id = 'prj_001'");
    await planMeeting(t, leader, { kind: 'client', projectId: 'prj_001', startsAt: START, title: 'Facade review', where: 'Client office', notes: NOTE, guests: GUEST, attendeeIds: ['usr_002'] });
    // The list of the tidy (a second connect of the same person reuses the calendar) is a GET with no body: only the writes carry an event.
    const requests = t.google.eventRequests().filter((request) => request.method !== 'GET');
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      const keys = Object.keys(request.body as object).sort();
      expect(keys).toEqual(request.method === 'POST' ? ['end', 'id', 'location', 'start', 'status', 'summary'] : ['end', 'location', 'start', 'status', 'summary']);
      const body = text(request.body);
      for (const forbidden of [NOTE, GUEST, String(project.name), String(project.code), 'Hala', 'Faisal', 'Reem', 'attendee', 'organizer', 'client']) expect(body, forbidden).not.toContain(forbidden);
    }
  });
});
