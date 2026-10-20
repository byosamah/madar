import { beforeEach, describe, expect, it } from 'vitest';
import { processOutbox, writeOutbox } from '../core/effects';
import { cleanup, GOOGLE_REVOKING_KEEP_MS } from '../jobs/steps/cleanup';
import { openToken } from './keys';
import { googleKeysOf } from './keys';
import { GoogleError } from './api';
import { eventBodyOf, eventIdOf, MADAR_EVENT_PREFIX, resetAccessCache, revokeOne, syncOne, tidyOne } from './sync';
import { GOOGLE_KEY, googleOffice, outboxRows, planMeeting, type GoogleOffice } from './testOffice';

/**
 * The one-way sync (fbk_022, owner 2026-10-19) on the sample office on node:sqlite, with fakeGoogle behind the Google fetch. Reem is
 * usr_003, Omar usr_004, Sara usr_005 and Yousef usr_006. Each call of a person that changes a meeting runs the sync rows at once
 * (the test office has no `after`), so the Google stub has seen the requests when the call returns.
 */

beforeEach(() => resetAccessCache());

const ok = (result: Awaited<ReturnType<GoogleOffice['call']>>) => {
  if (!result.ok) throw new Error(`The call failed: ${JSON.stringify(result.error)}`);
  return result.output as Record<string, unknown>;
};
const rowsOf = (t: GoogleOffice, text: string, values: unknown[] = []) => t.db.statement('read', text, values) as Promise<Record<string, unknown>[]>;
const eventCalls = (t: GoogleOffice) => t.google.eventRequests().map((request) => `${request.method} ${decodeURIComponent(request.path.split('/events')[1] || '/')}`);
const refreshes = (t: GoogleOffice) => t.google.requests.filter((request) => request.path === '/token' && (request.body as { grant_type?: string }).grant_type === 'refresh_token');
const connectedWith = async (...people: string[]) => {
  const t = await googleOffice();
  for (const id of people) ok(await t.connect(id));
  t.google.requests.length = 0;
  return t;
};
const calendarOf = async (t: GoogleOffice, userId: string) => String((await rowsOf(t, 'select calendar_id from google_connections where user_id = ?1', [userId]))[0].calendar_id);
const START = '2026-10-23T10:00:00.000+03:00';
const state = async (t: GoogleOffice, userId: string) => (await rowsOf(t, "select state, last_error, sealed_token from google_connections where user_id = ?1 and state <> 'revoking'", [userId]))[0];

describe('eventIdOf and eventBodyOf', () => {
  it('makes the same event id for one meeting, in the characters that Google takes (a to v and 0 to 9, 5 to 1024 of them)', () => {
    expect(eventIdOf('mtg_001')).toBe(eventIdOf('mtg_001'));
    expect(eventIdOf('mtg_001')).not.toBe(eventIdOf('mtg_002'));
    expect(eventIdOf('mtg_001')).toBe(Buffer.from('madar:mtg_001').toString('hex'));
    expect(eventIdOf('mtg_001')).toMatch(/^[0-9a-v]{5,1024}$/);
  });

  it('holds exactly the title, the place, the start, the end and the status', () => {
    const body = eventBodyOf({ title: 'Site visit', where: 'Plot 12', startsAt: '2026-10-20T23:30:00.000+03:00', endsAt: '2026-10-21T00:30:00.000+03:00' });
    expect(body).toEqual({
      summary: 'Site visit', location: 'Plot 12', status: 'confirmed',
      start: { dateTime: '2026-10-20T23:30:00.000+03:00', timeZone: 'Asia/Riyadh' },
      end: { dateTime: '2026-10-21T00:30:00.000+03:00', timeZone: 'Asia/Riyadh' },
    });
  });
});

describe('gcal.sync', () => {
  it('inserts the event with its id and the five keys when a connected person plans a meeting, and keeps a row for it', async () => {
    const t = await connectedWith('usr_003');
    const id = await planMeeting(t, 'usr_003', { startsAt: START, title: 'Kickoff', where: 'Meeting room', notes: 'Private note', guests: 'A guest' });
    const calendar = await calendarOf(t, 'usr_003');
    expect(t.google.eventRequests().map((request) => request.method)).toEqual(['POST']);
    const [insert] = t.google.eventRequests();
    expect(decodeURIComponent(insert.path)).toBe(`/calendar/v3/calendars/${calendar}/events`);
    expect(Object.keys(insert.body as object).sort()).toEqual(['end', 'id', 'location', 'start', 'status', 'summary']);
    expect(insert.body).toEqual({
      id: eventIdOf(id), summary: 'Kickoff', location: 'Meeting room', status: 'confirmed',
      start: { dateTime: START, timeZone: 'Asia/Riyadh' }, end: { dateTime: '2026-10-23T11:00:00.000+03:00', timeZone: 'Asia/Riyadh' },
    });
    expect(await rowsOf(t, 'select user_id, meeting_id, event_id, synced_rev from google_events')).toEqual([{ user_id: 'usr_003', meeting_id: id, event_id: eventIdOf(id), synced_rev: 1 }]);
    expect(await state(t, 'usr_003')).toMatchObject({ state: 'ok', last_error: null });
  });

  it('gives a meeting at 23:30 Riyadh the right stamp and the zone Asia/Riyadh', async () => {
    const t = await connectedWith('usr_003');
    await planMeeting(t, 'usr_003', { startsAt: '2026-10-20T23:30:00.000+03:00', durationMin: 60 });
    const [insert] = t.google.eventRequests();
    expect((insert.body as { start: unknown; end: unknown }).start).toEqual({ dateTime: '2026-10-20T23:30:00.000+03:00', timeZone: 'Asia/Riyadh' });
    expect((insert.body as { end: unknown }).end).toEqual({ dateTime: '2026-10-21T00:30:00.000+03:00', timeZone: 'Asia/Riyadh' });
  });

  it('syncs the organizer and each attendee who is connected, and nobody else', async () => {
    const t = await connectedWith('usr_003', 'usr_004');
    await planMeeting(t, 'usr_003', { startsAt: START, attendeeIds: ['usr_004', 'usr_005'] });
    expect(eventCalls(t)).toHaveLength(2);
    expect((await rowsOf(t, 'select user_id from google_events order by user_id')).map((row) => row.user_id)).toEqual(['usr_003', 'usr_004']);
  });

  it('patches the event when the time changes, and writes the new rev', async () => {
    const t = await connectedWith('usr_003');
    const id = await planMeeting(t, 'usr_003', { startsAt: START });
    t.google.requests.length = 0;
    ok(await t.call('usr_003', 'meetings.update', { id, startsAt: '2026-10-23T12:00:00.000+03:00' }));
    expect(t.google.eventRequests().map((request) => request.method)).toEqual(['PATCH']);
    expect((t.google.eventRequests()[0].body as { start: { dateTime: string } }).start.dateTime).toBe('2026-10-23T12:00:00.000+03:00');
    expect(await rowsOf(t, 'select synced_rev from google_events')).toEqual([{ synced_rev: 2 }]);
  });

  it('patches the title when only the title changes (no rev change)', async () => {
    const t = await connectedWith('usr_003');
    const id = await planMeeting(t, 'usr_003', { startsAt: START });
    t.google.requests.length = 0;
    ok(await t.call('usr_003', 'meetings.update', { id, title: 'A new title' }));
    expect((t.google.eventRequests()[0].body as { summary: string }).summary).toBe('A new title');
  });

  it('takes the event away from an attendee who is taken off, and the others keep theirs', async () => {
    const t = await connectedWith('usr_003', 'usr_004', 'usr_005');
    const id = await planMeeting(t, 'usr_004', { startsAt: START, attendeeIds: ['usr_003', 'usr_005'] });
    const reem = await calendarOf(t, 'usr_003');
    const sara = await calendarOf(t, 'usr_005');
    ok(await t.call('usr_004', 'meetings.update', { id, attendeeIds: ['usr_005'] }));
    expect(t.google.eventsOf(reem).get(eventIdOf(id))?.status).toBe('cancelled');
    expect(t.google.eventsOf(sara).get(eventIdOf(id))?.status).toBe('confirmed');
    expect((await rowsOf(t, 'select user_id from google_events order by user_id')).map((row) => row.user_id)).toEqual(['usr_004', 'usr_005']);
  });

  it('deletes the event for everyone when the meeting is cancelled, and a cancelled meeting stays out of the calendar', async () => {
    const t = await connectedWith('usr_003', 'usr_004');
    const id = await planMeeting(t, 'usr_003', { startsAt: START, attendeeIds: ['usr_004'] });
    ok(await t.call('usr_003', 'meetings.cancel', { id }));
    for (const user of ['usr_003', 'usr_004']) expect(t.google.eventsOf(await calendarOf(t, user)).get(eventIdOf(id))?.status).toBe('cancelled');
    expect(await rowsOf(t, 'select * from google_events')).toEqual([]);
  });

  it('deletes the events of the meetings of a project that is deleted', async () => {
    const t = await googleOffice();
    const project = 'prj_001';
    const leader = String((await rowsOf(t, "select json_extract(doc, '$.leaderId') as leader from projects where id = ?1", [project]))[0].leader);
    ok(await t.connect(leader));
    const id = await planMeeting(t, leader, { kind: 'client', projectId: project, startsAt: START });
    expect(await rowsOf(t, 'select meeting_id from google_events')).toEqual([{ meeting_id: id }]);
    ok(await t.call('usr_001', 'projects.delete', { id: project, confirm: true }));
    expect(await rowsOf(t, 'select * from google_events')).toEqual([]);
    expect(t.google.eventsOf(await calendarOf(t, leader)).get(eventIdOf(id))?.status).toBe('cancelled');
  });

  it('patches the old time back after an Undo of a move', async () => {
    const t = await connectedWith('usr_003');
    const id = await planMeeting(t, 'usr_003', { startsAt: START });
    ok(await t.call('usr_003', 'meetings.update', { id, startsAt: '2026-10-23T12:00:00.000+03:00' }));
    const [move] = await rowsOf(t, "select id from events where verb = 'meeting.updated' order by seq desc limit 1");
    ok(await t.call('usr_003', 'events.undo', { eventId: move.id }));
    const stored = t.google.eventsOf(await calendarOf(t, 'usr_003')).get(eventIdOf(id)) as unknown as { start: { dateTime: string } };
    expect(stored.start.dateTime).toBe(START);
  });

  it('writes nothing for a person with no connection, a meeting of other people, or an Admin who is not invited to a private meeting', async () => {
    const t = await connectedWith('usr_001', 'usr_005');
    await planMeeting(t, 'usr_003', { startsAt: START, attendeeIds: ['usr_004'] });
    expect(t.google.eventRequests()).toEqual([]);
    expect(await rowsOf(t, 'select * from google_events')).toEqual([]);
    expect(await outboxRows(t, 'gcal.sync')).toEqual([]);
  });

  it('refreshes the access token once for each connection, and uses it for later rows', async () => {
    const t = await connectedWith('usr_003');
    await planMeeting(t, 'usr_003', { startsAt: START });
    await planMeeting(t, 'usr_003', { startsAt: '2026-10-24T10:00:00.000+03:00' });
    await planMeeting(t, 'usr_003', { startsAt: '2026-10-25T10:00:00.000+03:00' });
    expect(refreshes(t)).toHaveLength(1);
    expect(t.google.eventRequests()).toHaveLength(3);
  });

  it('refreshes the access token again after a 401 and tries once more', async () => {
    const t = await connectedWith('usr_003');
    await planMeeting(t, 'usr_003', { startsAt: START });
    t.google.rotateAccessToken();
    await planMeeting(t, 'usr_003', { startsAt: '2026-10-24T10:00:00.000+03:00' });
    expect(refreshes(t)).toHaveLength(2);
    expect(t.google.eventRequests().map((request) => request.method)).toEqual(['POST', 'POST', 'POST']);
    expect(await rowsOf(t, 'select * from google_events')).toHaveLength(2);
  });

  it('refreshes after the access token ends, which is 60 seconds before its time', async () => {
    const t = await connectedWith('usr_003');
    await planMeeting(t, 'usr_003', { startsAt: START });
    t.deps.clock.advance(3_538_000);
    await planMeeting(t, 'usr_003', { startsAt: '2026-10-24T10:00:00.000+03:00' });
    expect(refreshes(t)).toHaveLength(1);
    t.deps.clock.advance(2_000);
    await planMeeting(t, 'usr_003', { startsAt: '2026-10-25T10:00:00.000+03:00' });
    expect(refreshes(t)).toHaveLength(2);
  });

  it('answers an insert that finds the id taken (409) with a full update that brings the event back confirmed', async () => {
    const t = await connectedWith('usr_003');
    const id = await planMeeting(t, 'usr_003', { startsAt: START });
    ok(await t.call('usr_003', 'meetings.cancel', { id }));
    expect(t.google.eventsOf(await calendarOf(t, 'usr_003')).get(eventIdOf(id))?.status).toBe('cancelled');
    t.google.requests.length = 0;
    // The meeting comes back by an Undo of the cancel: the row is gone, so the sync inserts, finds the id, and updates.
    const [cancel] = await rowsOf(t, "select id from events where verb = 'meeting.cancelled' order by seq desc limit 1");
    ok(await t.call('usr_003', 'events.undo', { eventId: cancel.id }));
    expect(t.google.eventRequests().map((request) => request.method)).toEqual(['POST', 'PUT']);
    expect(t.google.eventsOf(await calendarOf(t, 'usr_003')).get(eventIdOf(id))?.status).toBe('confirmed');
  });

  it('inserts again when a patch finds no event (404), for example after the person deleted it in Google', async () => {
    const t = await connectedWith('usr_003');
    const id = await planMeeting(t, 'usr_003', { startsAt: START });
    t.google.eventsOf(await calendarOf(t, 'usr_003')).delete(eventIdOf(id));
    t.google.requests.length = 0;
    ok(await t.call('usr_003', 'meetings.update', { id, title: 'Back again' }));
    expect(t.google.eventRequests().map((request) => request.method)).toEqual(['PATCH', 'POST']);
    expect(t.google.eventsOf(await calendarOf(t, 'usr_003')).get(eventIdOf(id))?.summary).toBe('Back again');
  });

  it('ends the connection when the calendar is gone (404 on an insert): state broken, the token deleted, no retry', async () => {
    const t = await connectedWith('usr_003');
    t.google.calendars.clear();
    const id = await planMeeting(t, 'usr_003', { startsAt: START });
    expect(await state(t, 'usr_003')).toMatchObject({ state: 'broken', last_error: 'calendar_gone', sealed_token: null });
    expect(await rowsOf(t, 'select * from google_events')).toEqual([]);
    expect((await outboxRows(t, 'gcal.sync'))[0]).toMatchObject({ payload: { meetingId: id }, done: true });
  });

  it('ends the connection on invalid_grant: state broken, the token deleted, the event rows gone, and the row is done with no retry', async () => {
    const t = await connectedWith('usr_003');
    t.google.state.grantAlive = false;
    await planMeeting(t, 'usr_003', { startsAt: START });
    expect(await state(t, 'usr_003')).toMatchObject({ state: 'broken', last_error: 'grant_gone', sealed_token: null });
    expect(await rowsOf(t, 'select * from google_events')).toEqual([]);
    expect(await outboxRows(t, 'gcal.sync')).toEqual([expect.objectContaining({ done: true, error: null })]);
    expect(ok(await t.call('usr_003', 'google.status', {}))).toMatchObject({ state: 'broken' });
    t.google.requests.length = 0;
    await planMeeting(t, 'usr_003', { startsAt: '2026-10-24T10:00:00.000+03:00' });
    expect(t.google.requests).toEqual([]);
  });

  it('ends the connection when the seal does not open (another key), also with no retry', async () => {
    const t = await connectedWith('usr_003');
    await t.db.statement('write', "update google_connections set sealed_token = 'v1.AAAAAAAAAAAAAAAA.AAAA' where user_id = 'usr_003'");
    await planMeeting(t, 'usr_003', { startsAt: START });
    expect(await state(t, 'usr_003')).toMatchObject({ state: 'broken', last_error: 'seal_broken', sealed_token: null });
    expect(refreshes(t)).toEqual([]);
  });

  it('sets not_synced and tries again for a timeout-like failure (5xx): the outbox row keeps its error code only, and a success sets ok again', async () => {
    const t = await connectedWith('usr_003');
    t.google.failAll((request) => request.method === 'POST' && request.path.endsWith('/events'), 503, { error: { message: 'Backend Error with a private title' } });
    const id = await planMeeting(t, 'usr_003', { startsAt: START, title: 'Private title' });
    expect(await state(t, 'usr_003')).toMatchObject({ state: 'not_synced', last_error: 'server' });
    const [row] = await outboxRows(t, 'gcal.sync');
    expect(row).toMatchObject({ payload: { userId: 'usr_003', meetingId: id }, done: false, error: 'server' });
    // The failure stays for the job: the rule is gone, the claim ended, and the next run succeeds.
    t.google.clearRules();
    t.deps.clock.advance(3 * 60_000);
    expect((await processOutbox(t.deps as never, [String(row.id)])).done).toEqual([String(row.id)]);
    expect(await state(t, 'usr_003')).toMatchObject({ state: 'ok', last_error: null });
    expect(await rowsOf(t, 'select meeting_id from google_events')).toEqual([{ meeting_id: id }]);
  });

  it('sets not_synced and tries again for a rate limit (429)', async () => {
    const t = await connectedWith('usr_003');
    t.google.failAll((request) => request.path.endsWith('/events'), 429);
    await planMeeting(t, 'usr_003', { startsAt: START });
    expect(await state(t, 'usr_003')).toMatchObject({ state: 'not_synced', last_error: 'rate_limited' });
    expect((await outboxRows(t, 'gcal.sync'))[0]).toMatchObject({ done: false, error: 'rate_limited' });
  });

  it('sets not_synced with the code refused for another refusal, and does not try again', async () => {
    const t = await connectedWith('usr_003');
    t.google.failAll((request) => request.path.endsWith('/events'), 400);
    await planMeeting(t, 'usr_003', { startsAt: START });
    expect(await state(t, 'usr_003')).toMatchObject({ state: 'not_synced', last_error: 'refused' });
    expect((await outboxRows(t, 'gcal.sync'))[0]).toMatchObject({ done: true, error: null });
  });

  it('does nothing for a person who is turned off or removed', async () => {
    const t = await connectedWith('usr_003');
    const id = await planMeeting(t, 'usr_003', { startsAt: START });
    t.google.requests.length = 0;
    await t.db.statement('write', "update users set doc = json_set(doc, '$.active', json('false')) where id = 'usr_003'");
    expect(await syncOne(t.deps as never, 'usr_003', id)).toBe('none');
    await t.db.statement('write', "update users set doc = json_set(doc, '$.active', json('true'), '$.removed', json('true')) where id = 'usr_003'");
    expect(await syncOne(t.deps as never, 'usr_003', id)).toBe('none');
    expect(t.google.requests).toEqual([]);
  });

  it('does nothing when Google is off for the copy', async () => {
    const t = await googleOffice({ google: false });
    expect(await syncOne(t.deps as never, 'usr_003', 'mtg_001')).toBe('none');
    expect(t.google.requests).toEqual([]);
  });

  it('returns put, deleted and none', async () => {
    const t = await connectedWith('usr_003');
    const id = await planMeeting(t, 'usr_003', { startsAt: START });
    expect(await syncOne(t.deps as never, 'usr_003', id)).toBe('put');
    ok(await t.call('usr_003', 'meetings.cancel', { id }));
    expect(await syncOne(t.deps as never, 'usr_003', id)).toBe('none');
    expect(await syncOne(t.deps as never, 'usr_003', 'mtg_404')).toBe('none');
  });
});

describe('gcal.revoke', () => {
  it('takes the refresh token back at Google and deletes the row, after a disconnect', async () => {
    const t = await connectedWith('usr_003');
    ok(await t.call('usr_003', 'google.disconnect', {}));
    expect(t.google.requests.filter((request) => request.path === '/revoke').map((request) => request.body)).toEqual([{ token: 'rt-SECRET' }]);
    expect(await rowsOf(t, 'select * from google_connections')).toEqual([]);
    expect(t.google.state.grantAlive).toBe(false);
  });

  it('does not call Google for a row that a new connect replaced, and deletes the row', async () => {
    const t = await connectedWith('usr_003');
    ok(await t.connect('usr_003'));
    expect(t.google.requests.filter((request) => request.path === '/revoke')).toEqual([]);
    expect(await rowsOf(t, 'select state from google_connections')).toEqual([{ state: 'ok' }]);
    expect(t.google.state.grantAlive).toBe(true);
  });

  it('deletes the row of a sealed text that does not open, with no call to Google', async () => {
    const t = await connectedWith('usr_003');
    await t.db.statement('write', "update google_connections set sealed_token = 'garbage', state = 'revoking' where user_id = 'usr_003'");
    const [row] = await rowsOf(t, 'select id from google_connections');
    await revokeOne(t.deps as never, String(row.id));
    expect(await rowsOf(t, 'select * from google_connections')).toEqual([]);
    expect(t.google.requests).toEqual([]);
  });

  it('counts a 400 of Google as done, tries again after a 5xx, and keeps the row until it works', async () => {
    const t = await connectedWith('usr_003');
    t.google.failAll((request) => request.path === '/revoke', 503);
    ok(await t.call('usr_003', 'google.disconnect', {}));
    expect(await rowsOf(t, 'select state from google_connections')).toEqual([{ state: 'revoking' }]);
    const [revoke] = await outboxRows(t, 'gcal.revoke');
    expect(revoke).toMatchObject({ done: false, error: 'server' });
    t.google.clearRules();
    t.google.failAll((request) => request.path === '/revoke', 400);
    t.deps.clock.advance(3 * 60_000);
    expect((await processOutbox(t.deps as never, [String(revoke.id)])).done).toEqual([String(revoke.id)]);
    expect(await rowsOf(t, 'select * from google_connections')).toEqual([]);
  });

  it('deletes the live row and the Google events of a person who was removed', async () => {
    const t = await connectedWith('usr_003');
    const id = await planMeeting(t, 'usr_003', { startsAt: START });
    expect(await rowsOf(t, 'select meeting_id from google_events')).toEqual([{ meeting_id: id }]);
    ok(await t.call('usr_001', 'users.deactivate', { id: 'usr_003' }));
    ok(await t.call('usr_001', 'users.remove', { id: 'usr_003' }));
    expect(await rowsOf(t, 'select * from google_connections')).toEqual([]);
    expect(await rowsOf(t, 'select * from google_events')).toEqual([]);
    expect(t.google.requests.filter((request) => request.path === '/revoke')).toHaveLength(1);
  });

  it('sets the row of a removed person to revoking in the transaction of users.remove, so the cleanup deletes it when Google never answers', async () => {
    const t = await connectedWith('usr_003');
    const id = await planMeeting(t, 'usr_003', { startsAt: START });
    expect(await rowsOf(t, 'select meeting_id from google_events')).toEqual([{ meeting_id: id }]);
    t.google.failAll((request) => request.path === '/revoke', 503);
    // Turned off only: the connection and its events stay (decision 11 of the plan).
    ok(await t.call('usr_001', 'users.deactivate', { id: 'usr_003' }));
    expect(await rowsOf(t, 'select state from google_connections')).toEqual([{ state: 'ok' }]);
    expect(await rowsOf(t, 'select meeting_id from google_events')).toEqual([{ meeting_id: id }]);
    ok(await t.call('usr_001', 'users.remove', { id: 'usr_003' }));
    // Removed: the row is revoking at once, and the Google events of the person are gone, whatever Google answers.
    expect(await rowsOf(t, 'select state from google_connections')).toEqual([{ state: 'revoking' }]);
    expect(await rowsOf(t, 'select * from google_events')).toEqual([]);
    const [revoke] = await outboxRows(t, 'gcal.revoke');
    expect(revoke).toMatchObject({ done: false, error: 'server' });
    // Google never answers. The cleanup step keeps the row for one day, then deletes it with its sealed token.
    const removedAt = t.deps.clock.now().getTime();
    expect(await cleanup(t.deps, new Date(removedAt + GOOGLE_REVOKING_KEEP_MS - 60_000))).toMatchObject({ googleRevoking: 0 });
    expect(await rowsOf(t, 'select state from google_connections')).toEqual([{ state: 'revoking' }]);
    expect(await cleanup(t.deps, new Date(removedAt + GOOGLE_REVOKING_KEEP_MS + 60_000))).toMatchObject({ googleRevoking: 1 });
    expect(await rowsOf(t, 'select * from google_connections')).toEqual([]);
  });

  it('does nothing for a row that is gone', async () => {
    const t = await googleOffice();
    await expect(revokeOne(t.deps as never, 'no-such-row')).resolves.toBeUndefined();
  });

  it('opens the token with the key of the copy (the check of the other tests)', async () => {
    const t = await connectedWith('usr_003');
    const [row] = await rowsOf(t, 'select sealed_token from google_connections');
    expect(await openToken(await googleKeysOf(GOOGLE_KEY), 'usr_003', String(row.sealed_token))).toBe('rt-SECRET');
  });
});

describe('gcal.tidy', () => {
  const FAR = '2026-12-01T10:00:00.000+03:00';
  const NOW = '2026-10-21T06:00:00.000Z';
  const isList = (request: { method: string; path: string }) => request.method === 'GET' && request.path.endsWith('/events');
  /** An event in the calendar, as Google keeps it. `end` decides whether the list shows it (the list gives the events that end after now). */
  const addEvent = (t: GoogleOffice, calendar: string, id: string, end = FAR, status = 'confirmed') =>
    void t.google.events.get(calendar)!.set(id, { id, status, summary: 'Old', start: { dateTime: end }, end: { dateTime: end } });
  const statusOf = (t: GoogleOffice, calendar: string, id: string) => t.google.eventsOf(calendar).get(id)?.status;
  const ledger = async (t: GoogleOffice) => ({
    events: await rowsOf(t, 'select * from google_events order by user_id, meeting_id'),
    connections: await rowsOf(t, 'select * from google_connections order by id'),
    calendars: await rowsOf(t, 'select * from google_calendars order by user_id'),
  });

  it('keeps the events of the upcoming meetings of the person, as organizer and as attendee, and deletes a stale event of Madar', async () => {
    const t = await connectedWith('usr_003');
    const own = await planMeeting(t, 'usr_003', { startsAt: START });
    const attending = await planMeeting(t, 'usr_004', { startsAt: '2026-10-24T10:00:00.000+03:00', attendeeIds: ['usr_003'] });
    const calendar = await calendarOf(t, 'usr_003');
    const stale = eventIdOf('mtg_900');
    addEvent(t, calendar, stale);
    const before = await ledger(t);
    t.google.requests.length = 0;
    expect(await tidyOne(t.deps as never, 'usr_003')).toBe(1);
    expect(statusOf(t, calendar, eventIdOf(own))).toBe('confirmed');
    expect(statusOf(t, calendar, eventIdOf(attending))).toBe('confirmed');
    expect(statusOf(t, calendar, stale)).toBe('cancelled');
    expect(eventCalls(t)).toEqual(['GET /', `DELETE /${stale}`]);
    // The list starts at now, as single events, 250 in a page.
    const list = t.google.requests.find(isList)!;
    expect(Object.fromEntries(new URL(list.url).searchParams)).toEqual({ timeMin: NOW, singleEvents: 'true', maxResults: '250' });
    // It writes no row of its own: the event rows and the connection are as they were.
    expect(await ledger(t)).toEqual(before);
  });

  it('never deletes an event that Madar did not make: an event of the person, and an id that only starts like the Madar ids', async () => {
    const t = await connectedWith('usr_003');
    const calendar = await calendarOf(t, 'usr_003');
    const mine = 'k3j2h1g0f9d8s7a6';
    const near = Buffer.from('madar:other').toString('hex');
    const shorter = Buffer.from('madar:mtg').toString('hex');
    for (const id of [mine, near, shorter, 'mtg_900', Buffer.from('xmadar:mtg_900').toString('hex')]) addEvent(t, calendar, id);
    const stale = eventIdOf('mtg_901');
    addEvent(t, calendar, stale);
    expect(MADAR_EVENT_PREFIX).toBe(Buffer.from('madar:mtg_').toString('hex'));
    expect(await tidyOne(t.deps as never, 'usr_003')).toBe(1);
    expect(eventCalls(t).filter((call) => call.startsWith('DELETE'))).toEqual([`DELETE /${stale}`]);
    for (const id of [mine, near, shorter, 'mtg_900']) expect(statusOf(t, calendar, id), id).toBe('confirmed');
  });

  it('deletes the event of a cancelled meeting, of a meeting that the person is not on, of a meeting 61 days away, and of a meeting that does not exist', async () => {
    const t = await connectedWith('usr_003');
    const calendar = await calendarOf(t, 'usr_003');
    const cancelled = await planMeeting(t, 'usr_003', { startsAt: START });
    ok(await t.call('usr_003', 'meetings.cancel', { id: cancelled }));
    const other = await planMeeting(t, 'usr_004', { startsAt: START });
    const far = await planMeeting(t, 'usr_003', { startsAt: '2026-12-25T10:00:00.000+03:00' });
    const kept = await planMeeting(t, 'usr_003', { startsAt: '2026-10-24T10:00:00.000+03:00' });
    const ids = [cancelled, other, far, 'mtg_999'].map(eventIdOf);
    for (const id of ids) addEvent(t, calendar, id);
    t.google.requests.length = 0;
    expect(await tidyOne(t.deps as never, 'usr_003')).toBe(4);
    for (const id of ids) expect(statusOf(t, calendar, id), id).toBe('cancelled');
    expect(statusOf(t, calendar, eventIdOf(kept))).toBe('confirmed');
  });

  it('leaves alone a Madar event that ended before now, because the list does not show it', async () => {
    const t = await connectedWith('usr_003');
    const calendar = await calendarOf(t, 'usr_003');
    const past = eventIdOf('mtg_902');
    addEvent(t, calendar, past, '2026-10-20T10:00:00.000+03:00');
    expect(await tidyOne(t.deps as never, 'usr_003')).toBe(0);
    expect(statusOf(t, calendar, past)).toBe('confirmed');
    expect(eventCalls(t)).toEqual(['GET /']);
  });

  it('reads the next page and deletes all the stale events of more than one page', async () => {
    const t = await connectedWith('usr_003');
    const calendar = await calendarOf(t, 'usr_003');
    const ids = Array.from({ length: 260 }, (_, n) => eventIdOf(`mtg_8${String(n).padStart(3, '0')}`));
    for (const id of ids) addEvent(t, calendar, id);
    expect(await tidyOne(t.deps as never, 'usr_003')).toBe(260);
    expect(ids.every((id) => statusOf(t, calendar, id) === 'cancelled')).toBe(true);
    expect(t.google.requests.filter(isList).map((request) => new URL(request.url).searchParams.get('pageToken'))).toEqual([null, '250']);
  });

  it('counts a 404 or a 410 of a delete as done and goes on with the next event', async () => {
    const t = await connectedWith('usr_003');
    const calendar = await calendarOf(t, 'usr_003');
    const [one, two, three] = ['mtg_910', 'mtg_911', 'mtg_912'].map(eventIdOf);
    for (const id of [one, two, three]) addEvent(t, calendar, id);
    t.google.on((request) => request.method === 'DELETE' && request.path.endsWith(`/${one}`), () => t.google.reply({}, 404));
    t.google.on((request) => request.method === 'DELETE' && request.path.endsWith(`/${two}`), () => t.google.reply({}, 410));
    expect(await tidyOne(t.deps as never, 'usr_003')).toBe(3);
    expect(statusOf(t, calendar, three)).toBe('cancelled');
  });

  it('ends quietly when the grant is gone: no throw, no delete, and the connection is as it was (the next sync marks it broken)', async () => {
    const t = await connectedWith('usr_003');
    const calendar = await calendarOf(t, 'usr_003');
    const stale = eventIdOf('mtg_900');
    addEvent(t, calendar, stale);
    t.google.state.grantAlive = false;
    const before = await ledger(t);
    t.google.requests.length = 0;
    expect(await tidyOne(t.deps as never, 'usr_003')).toBe(0);
    expect(statusOf(t, calendar, stale)).toBe('confirmed');
    expect(t.google.eventRequests()).toEqual([]);
    expect(await ledger(t)).toEqual(before);
    expect(t.deps.logs.some((line) => line.message === 'A Google Calendar tidy ended. The next sync decides about the connection.')).toBe(true);
  });

  it('ends quietly when Google still says 401 after a new access token, and when the calendar is gone (404) or the list is refused (403)', async () => {
    for (const status of [401, 404, 403]) {
      const t = await connectedWith('usr_003');
      t.google.failAll(isList, status);
      expect(await tidyOne(t.deps as never, 'usr_003'), String(status)).toBe(0);
      if (status === 401) expect(refreshes(t)).toHaveLength(2);
      expect(await state(t, 'usr_003'), String(status)).toMatchObject({ state: 'ok', last_error: null });
    }
  });

  it('throws for a timeout, a network error, a 5xx or a 429, so the outbox tries again, and the error holds only the code', async () => {
    for (const [name, fail] of [
      ['503', (t: GoogleOffice) => t.google.failAll(isList, 503, { error: { message: 'rt-SECRET at-SECRET' } })],
      ['429', (t: GoogleOffice) => t.google.failAll(isList, 429)],
      ['network', (t: GoogleOffice) => t.google.on(isList, () => { throw new TypeError('connect ECONNREFUSED 10.0.0.1 rt-SECRET'); })],
    ] as const) {
      const t = await connectedWith('usr_003');
      fail(t);
      const error = await tidyOne(t.deps as never, 'usr_003').catch((e: unknown) => e);
      expect(error, name).toBeInstanceOf(GoogleError);
      expect((error as GoogleError).retry, name).toBe(true);
      expect(String((error as Error).message), name).toMatch(/^(server|rate_limited|unreachable)$/);
    }
  });

  it('is a registered effect: a row with the payload userId runs through the outbox, fails with a code and runs again', async () => {
    const t = await connectedWith('usr_003');
    const calendar = await calendarOf(t, 'usr_003');
    const stale = eventIdOf('mtg_900');
    addEvent(t, calendar, stale);
    t.google.failAll(isList, 503);
    const [id] = await t.db.tx('write', (q) => writeOutbox(q, [{ kind: 'gcal.tidy', payload: { userId: 'usr_003' } }]));
    expect((await processOutbox(t.deps as never, [id])).failed).toEqual([id]);
    expect(await outboxRows(t, 'gcal.tidy')).toEqual([expect.objectContaining({ payload: { userId: 'usr_003' }, done: false, error: 'server' })]);
    t.google.clearRules();
    t.deps.clock.advance(3 * 60_000);
    expect((await processOutbox(t.deps as never, [id])).done).toEqual([id]);
    expect(statusOf(t, calendar, stale)).toBe('cancelled');
  });

  it('does nothing, and calls Google not at all, for a person with no connection, a broken connection, a turned off person, a removed person, or a copy with no Google', async () => {
    const t = await connectedWith('usr_003', 'usr_004');
    expect(await tidyOne(t.deps as never, 'usr_005')).toBe(0);
    await t.db.statement('write', "update google_connections set state = 'broken', sealed_token = null where user_id = 'usr_004'");
    expect(await tidyOne(t.deps as never, 'usr_004')).toBe(0);
    await t.db.statement('write', "update users set doc = json_set(doc, '$.active', json('false')) where id = 'usr_003'");
    expect(await tidyOne(t.deps as never, 'usr_003')).toBe(0);
    await t.db.statement('write', "update users set doc = json_set(doc, '$.active', json('true'), '$.removed', json('true')) where id = 'usr_003'");
    expect(await tidyOne(t.deps as never, 'usr_003')).toBe(0);
    expect(t.google.requests).toEqual([]);
    const off = await googleOffice({ google: false });
    expect(await tidyOne(off.deps as never, 'usr_003')).toBe(0);
    expect(off.google.requests).toEqual([]);
  });

  it('does not touch the calendar of another person', async () => {
    const t = await connectedWith('usr_003', 'usr_004');
    const reem = await calendarOf(t, 'usr_003');
    const omar = await calendarOf(t, 'usr_004');
    addEvent(t, reem, eventIdOf('mtg_900'));
    addEvent(t, omar, eventIdOf('mtg_900'));
    expect(await tidyOne(t.deps as never, 'usr_003')).toBe(1);
    expect(statusOf(t, reem, eventIdOf('mtg_900'))).toBe('cancelled');
    expect(statusOf(t, omar, eventIdOf('mtg_900'))).toBe('confirmed');
  });
});
