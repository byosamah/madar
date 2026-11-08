import { beforeEach, describe, expect, it, vi } from 'vitest';
import { meetingsOf, type State } from '../../src/api/store';
import { nowStamp } from '../../src/lib/dates';
import { KNOWN_SECRETS } from '../google/fakeGoogle';
import { resetAccessCache } from '../google/sync';
import { NET_BUDGET } from './net';
import { outsideOffice, type OutsideOffice } from './test/outsideOffice';

/**
 * Google Calendar in the office object (plan A of Madar enterprises). The object makes no network call: every Google request goes
 * through the network port, and the Worker side of the port (`googleRequest`) sends it to the fake Google. So these tests run the real
 * Google calls, effects and sync on SQLite, with the port in the middle.
 */

beforeEach(() => {
  resetAccessCache();
  vi.stubGlobal('fetch', () => {
    throw new Error('A test reached the network.');
  });
});

const AT = '2026-10-21T06:00:00Z';
const START = '2026-10-23T10:00:00.000+03:00';
const MEETING = { kind: 'meeting', title: 'Kickoff', where: 'Meeting room', startsAt: START } as const;

/** Meetings of one person in the next days, from `mtg_900` up. */
const meetingsFor = (userId: string, count: number) => (seed: State) => {
  for (let n = 0; n < count; n += 1) {
    const id = `mtg_${900 + n}`;
    const startsAt = nowStamp(new Date(Date.parse(AT) + (n + 1) * 3_600_000));
    meetingsOf(seed)[id] = {
      id, kind: 'meeting', title: `Meeting ${n}`, projectId: null, startsAt, endsAt: nowStamp(new Date(Date.parse(AT) + (n + 2) * 3_600_000)), where: 'Room', guests: '', notes: '',
      organizerId: userId, attendeeIds: [], status: 'scheduled', rev: 1, createdBy: userId, createdAt: startsAt,
    };
  }
};

const okOf = (results: { ok: boolean; output?: unknown; error?: unknown }[], n = 0): Record<string, unknown> => {
  const entry = results[n];
  if (!entry.ok) throw new Error(`The call failed: ${JSON.stringify(entry.error)}`);
  return entry.output as Record<string, unknown>;
};
const requestsOf = (t: OutsideOffice, path: string) => t.google.requests.filter((request) => request.path.includes(path));
const eventPosts = (t: OutsideOffice) => t.google.eventRequests().filter((request) => request.method === 'POST');

describe('google.status in the office object', () => {
  it('says ready with the three values, and not ready without them', async () => {
    const on = await outsideOffice();
    expect(okOf((await on.batch('usr_003', [{ name: 'google.status', input: {} }])).results)).toMatchObject({ ready: true, state: 'none' });
    const off = await outsideOffice({ google: false });
    expect(okOf((await off.batch('usr_003', [{ name: 'google.status', input: {} }])).results)).toMatchObject({ ready: false });
  });
});

describe('google.connect in the office object', () => {
  it('swaps the code and makes the calendar through the port, and the sync rows run after the answer', async () => {
    const t = await outsideOffice({ edit: meetingsFor('usr_003', 2) });
    const connected = await t.connect('usr_003');
    expect(okOf(connected.results)).toEqual({ state: 'ok', meetings: 2 });
    // In the same call the fake saw the code swap and the calendar, and no event yet.
    expect(requestsOf(t, '/token').length).toBeGreaterThan(0);
    expect(t.google.requests.some((request) => request.path === '/calendar/v3/calendars')).toBe(true);
    expect(t.google.eventRequests()).toEqual([]);
    // The rows go to Deps.later, and not to processOutbox: they are in `later`, still open.
    expect(connected.later).toHaveLength(2);
    const open = await t.rows("select count(*) as n from outbox where kind = 'gcal.sync' and done_at is null");
    expect(open[0].n).toBe(2);
    expect(await t.effects(connected.later)).toEqual({ done: 2, failed: 0 });
    expect(eventPosts(t)).toHaveLength(2);
    expect(await t.rows('select meeting_id from google_events order by meeting_id')).toEqual([{ meeting_id: 'mtg_900' }, { meeting_id: 'mtg_901' }]);
    expect(t.openAtCall.length).toBeGreaterThan(0);
    expect(t.openAtCall.every((open) => open === false)).toBe(true);
  });

  it('sends a meeting made after the connect to Google through runEffects', async () => {
    const t = await outsideOffice();
    await t.connect('usr_003');
    const made = await t.batch('usr_003', [{ name: 'meetings.create', input: MEETING }]);
    okOf(made.results);
    expect(made.later).toHaveLength(1);
    expect(eventPosts(t)).toHaveLength(0);
    await t.effects(made.later);
    expect(eventPosts(t)).toHaveLength(1);
  });

  it('hands the revoke row to later on disconnect, and the revoke reaches Google', async () => {
    const t = await outsideOffice();
    await t.connect('usr_003');
    const out = await t.batch('usr_003', [{ name: 'google.disconnect', input: {} }]);
    expect(okOf(out.results)).toEqual({ state: 'none' });
    expect(out.later).toHaveLength(1);
    expect(requestsOf(t, '/revoke')).toHaveLength(0);
    await t.effects(out.later);
    expect(requestsOf(t, '/revoke')).toHaveLength(1);
    expect(await t.rows("select * from google_connections where user_id = 'usr_003'")).toEqual([]);
  });
});

describe('the network budget of the office object', () => {
  it('leaves the connection ok and loses no attempt when the budget ends in the middle of a backfill, and the next run sends the rest', async () => {
    const t = await outsideOffice({ edit: meetingsFor('usr_003', 60) });
    const connected = await t.connect('usr_003');
    expect(okOf(connected.results)).toMatchObject({ meetings: 60 });
    const before = t.net.calls.length;
    await t.effects(connected.later);
    const first = t.net.calls.slice(before);
    expect(first.length).toBeLessThanOrEqual(NET_BUDGET);
    const [connection] = await t.rows('select state, last_error from google_connections');
    expect(connection).toEqual({ state: 'ok', last_error: null });
    const waiting = await t.rows('select attempts, done_at, claimed_until from outbox where kind = \'gcal.sync\' and done_at is null');
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.every((row) => row.attempts === 0)).toBe(true);
    // The wait is 60 seconds. After it, the second run finishes the rest.
    t.clock.advance(61_000);
    await t.effects(connected.later);
    expect(await t.rows("select count(*) as n from outbox where kind = 'gcal.sync' and done_at is null")).toEqual([{ n: 0 }]);
    expect(t.google.eventsOf().size).toBe(60);
  });
});

describe('leaks of the Google flow in the office object', () => {
  it('keeps every Google secret out of the log, the outbox errors and the answers', async () => {
    const t = await outsideOffice({ edit: meetingsFor('usr_003', 3) });
    const connected = await t.connect('usr_003');
    t.google.failAll(() => true, 500, { error: { message: 'rt-SECRET at-SECRET code-SECRET cs-SECRET' } });
    await t.effects(connected.later);
    const errors = await t.rows('select error from outbox');
    const text = JSON.stringify([t.lines, errors, connected.results, t.net.calls]);
    for (const secret of KNOWN_SECRETS) expect(text, secret).not.toContain(secret);
  });

  it('takes the Google event of a hidden project from a person who loses the view, and sends it no more', async () => {
    // prj_001 is hidden and has the leader usr_002. usr_011 joins the team, attends a meeting, then leaves the team.
    const t = await outsideOffice({
      edit: (seed) => {
        seed.projects.prj_001 = { ...seed.projects.prj_001, access: { hidden: true, viewerIds: [] } };
      },
    });
    okOf((await t.batch('usr_001', [{ name: 'members.add', input: { projectId: 'prj_001', userId: 'usr_011' } }])).results);
    await t.connect('usr_011');
    const made = await t.batch('usr_002', [{ name: 'meetings.create', input: { kind: 'client', title: 'Hidden kickoff', projectId: 'prj_001', startsAt: START, attendeeIds: ['usr_011'] } }]);
    const { id } = okOf(made.results) as { id: string };
    await t.effects(made.later);
    expect(t.net.calls.filter((call) => call.startsWith('google POST') && call.includes('/events'))).toHaveLength(1);
    const removed = await t.batch('usr_001', [{ name: 'members.remove', input: { projectId: 'prj_001', userId: 'usr_011' } }]);
    okOf(removed.results);
    await t.effects(removed.later);
    expect(t.net.calls.filter((call) => call.startsWith('google DELETE') && call.includes('/events'))).toHaveLength(1);
    // A later change of the meeting reaches Google for nobody who cannot view the project.
    const changed = await t.batch('usr_002', [{ name: 'meetings.update', input: { id, title: 'Hidden kickoff 2' } }]);
    okOf(changed.results);
    await t.effects(changed.later);
    const writes = t.net.calls.filter((call) => /^google (POST|PATCH|PUT) /.test(call) && call.includes('/events'));
    expect(writes).toHaveLength(1);
  });
});
