import { beforeEach, describe, expect, it } from 'vitest';
import type { Query } from '../core/ports';
import { gcalRows, revokeRowsOf } from './rows';
import { resetAccessCache } from './sync';
import { googleOffice, outboxRows, PLAN, planMeeting, type GoogleOffice } from './testOffice';

/** The producers of the sync rows (fbk_022): which pairs of person and meeting get a gcal.sync row. Reem is usr_003, Omar usr_004, Sara usr_005. */

beforeEach(() => resetAccessCache());

const START = '2026-10-23T10:00:00.000+03:00';
const ok = (result: Awaited<ReturnType<GoogleOffice['call']>>) => {
  if (!result.ok) throw new Error(`The call failed: ${JSON.stringify(result.error)}`);
  return result.output as Record<string, unknown>;
};
const rowsFor = (t: GoogleOffice, meetingIds?: string[]) => t.db.tx('read', (q) => gcalRows(q, { ...(meetingIds ? { meetingIds } : {}) }));

describe('gcalRows', () => {
  it('asks the database nothing when the save touched no meeting', async () => {
    const asked: string[] = [];
    const q = (async (text: string) => (asked.push(text), [])) as unknown as Query;
    expect(await gcalRows(q, {})).toEqual([]);
    expect(await gcalRows(q, { meetingIds: [] })).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('writes no row for a person with no connection, with a broken connection, or for a meeting of other people', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_005'));
    await t.db.statement('write', "update google_connections set state = 'broken', sealed_token = null where user_id = 'usr_005'");
    const id = await planMeeting(t, 'usr_003', { startsAt: START, attendeeIds: ['usr_004', 'usr_005'] });
    expect(await rowsFor(t, [id])).toEqual([]);
    ok(await t.connect('usr_001'));
    expect(await rowsFor(t, [id])).toEqual([]);
  });

  it('writes one row for each connected organizer and attendee, sorted, with a not_synced connection counted', async () => {
    const t = await googleOffice();
    for (const user of ['usr_003', 'usr_004', 'usr_005']) ok(await t.connect(user));
    await t.db.statement('write', "update google_connections set state = 'not_synced' where user_id = 'usr_005'");
    const id = await planMeeting(t, 'usr_004', { startsAt: START, attendeeIds: ['usr_005', 'usr_003'] });
    expect(await rowsFor(t, [id])).toEqual([
      { kind: 'gcal.sync', payload: { userId: 'usr_003', meetingId: id } },
      { kind: 'gcal.sync', payload: { userId: 'usr_004', meetingId: id } },
      { kind: 'gcal.sync', payload: { userId: 'usr_005', meetingId: id } },
    ]);
  });

  it('writes a row for a person taken off who has an event, and for a deleted meeting that has events', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    const id = await planMeeting(t, 'usr_004', { startsAt: START, attendeeIds: ['usr_003'] });
    expect(await rowsFor(t, [id])).toEqual([{ kind: 'gcal.sync', payload: { userId: 'usr_003', meetingId: id } }]);
    await t.db.statement('write', "update meetings set doc = json_set(doc, '$.attendeeIds', json('[]')) where id = ?1", [id]);
    // Reem is off the list now, and her event row keeps her in the answer.
    expect(await rowsFor(t, [id])).toEqual([{ kind: 'gcal.sync', payload: { userId: 'usr_003', meetingId: id } }]);
    await t.db.statement('write', 'delete from meetings where id = ?1', [id]);
    expect(await rowsFor(t, [id])).toEqual([{ kind: 'gcal.sync', payload: { userId: 'usr_003', meetingId: id } }]);
    await t.db.statement('write', "delete from google_events where meeting_id = ?1", [id]);
    expect(await rowsFor(t, [id])).toEqual([]);
  });

  it('writes one row for a pair that both reasons name', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    const id = await planMeeting(t, 'usr_003', { startsAt: START });
    await t.db.statement('write', "insert or replace into google_events (user_id, meeting_id, event_id, synced_rev, synced_at) values ('usr_003', ?1, 'ev', 1, '2026-10-21T06:00:00.000Z')", [id]);
    expect(await rowsFor(t, [id])).toHaveLength(1);
  });
});

describe('the rows of a call', () => {
  it('writes the sync rows in the transaction of meetings.create, meetings.update, meetings.cancel, meetings.delete and events.undo', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    const id = await planMeeting(t, 'usr_003', { startsAt: START });
    ok(await t.call('usr_003', 'meetings.update', { id, title: 'New' }));
    const [update] = await t.db.statement('read', "select id from events where verb = 'meeting.updated' order by seq desc limit 1") as { id: string }[];
    ok(await t.call('usr_003', 'events.undo', { eventId: update.id }));
    ok(await t.call('usr_003', 'meetings.cancel', { id }));
    expect((await outboxRows(t, 'gcal.sync')).map((row) => row.payload)).toEqual(Array(4).fill({ userId: 'usr_003', meetingId: id }));
  });

  it('writes a sync row for a deleted meeting only when a Google event row of it stands (owner, 2026-10-23)', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    const id = await planMeeting(t, 'usr_003', { startsAt: START });
    ok(await t.call('usr_003', 'meetings.cancel', { id }));
    const before = (await outboxRows(t, 'gcal.sync')).length;
    // The sync of the cancel took the row away, so the delete has nothing to send.
    ok(await t.call('usr_003', 'meetings.delete', { id }));
    expect((await outboxRows(t, 'gcal.sync')).length).toBe(before);
    const other = await planMeeting(t, 'usr_003', { startsAt: START, title: 'Other' });
    ok(await t.call('usr_003', 'meetings.cancel', { id: other }));
    await t.db.statement('write', "insert or replace into google_events (user_id, meeting_id, event_id, synced_rev, synced_at) values ('usr_003', ?1, 'ev', 1, '2026-10-21T06:00:00.000Z')", [other]);
    const again = (await outboxRows(t, 'gcal.sync')).length;
    ok(await t.call('usr_003', 'meetings.delete', { id: other }));
    expect((await outboxRows(t, 'gcal.sync')).slice(again).map((row) => row.payload)).toEqual([{ userId: 'usr_003', meetingId: other }]);
  });

  it('writes one row for each meeting of a new series, for a connected attendee (wave 3)', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_004'));
    const made = ok(await t.call('usr_003', 'meetings.create', { ...PLAN, startsAt: START, attendeeIds: ['usr_004'], repeat: { every: 'week', until: null } }));
    const ids = (await t.db.statement('read', "select id from meetings where json_extract(doc, '$.seriesId') = ?1 order by starts_at", [made.id as string])) as { id: string }[];
    expect(ids).toHaveLength(8);
    const rows = (await outboxRows(t, 'gcal.sync')).map((row) => row.payload);
    expect(rows).toHaveLength(8);
    expect(rows.map((row) => row.meetingId).sort()).toEqual(ids.map((row) => row.id).sort());
    expect(new Set(rows.map((row) => row.userId))).toEqual(new Set(['usr_004']));
  });

  it('writes one row for each meeting that a "later" change or cancel touches (a "later" cancel touches the whole series), and for each meeting that the extension adds (wave 3)', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_004'));
    const made = ok(await t.call('usr_003', 'meetings.create', { ...PLAN, startsAt: START, attendeeIds: ['usr_004'], repeat: { every: 'week', until: null } }));
    const ids = ((await t.db.statement('read', "select id from meetings where json_extract(doc, '$.seriesId') = ?1 order by starts_at", [made.id as string])) as { id: string }[]).map((row) => row.id);
    const seen = async () => (await outboxRows(t, 'gcal.sync')).map((row) => row.payload.meetingId as string);
    const before = (await seen()).length;
    ok(await t.call('usr_003', 'meetings.update', { id: ids[5], where: 'Room 9', scope: 'later' }));
    expect((await seen()).slice(before).sort()).toEqual(ids.slice(5).sort());
    const afterUpdate = (await seen()).length;
    ok(await t.call('usr_003', 'meetings.cancel', { id: ids[6], scope: 'later' }));
    // The cancel records the last day of the series on every meeting of it (owner, 2026-10-23), so every meeting gets a row.
    expect((await seen()).slice(afterUpdate).sort()).toEqual(ids.slice().sort());
    // A second series: one meeting in the middle is cancelled alone, so 7 are ahead and the extension adds one, then no more.
    const other = ok(await t.call('usr_003', 'meetings.create', { ...PLAN, title: 'Other', startsAt: START, attendeeIds: ['usr_004'], repeat: { every: 'week', until: null } }));
    const otherIds = ((await t.db.statement('read', "select id from meetings where json_extract(doc, '$.seriesId') = ?1 order by starts_at", [other.id as string])) as { id: string }[]).map((row) => row.id);
    ok(await t.call('usr_003', 'meetings.cancel', { id: otherIds[2] }));
    const afterCancel = (await seen()).length;
    expect(ok(await t.call('usr_003', 'meetings.extend', { seriesId: other.id }))).toEqual({ added: 1 });
    const added = (await seen()).slice(afterCancel);
    expect(added).toHaveLength(1);
    expect(otherIds).not.toContain(added[0]);
    expect(ok(await t.call('usr_003', 'meetings.extend', { seriesId: other.id }))).toEqual({ added: 0 });
    expect((await seen()).slice(afterCancel)).toHaveLength(1);
  });

  it('writes no row for a call that touches no meeting', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    ok(await t.call('usr_003', 'me.updateProfile', { name: 'Reem A.' }));
    expect(await outboxRows(t, 'gcal.sync')).toEqual([]);
  });

  it('writes nothing when the transaction fails: a rollback leaves no row', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    const before = await outboxRows(t, 'gcal.sync');
    expect(await t.call('usr_003', 'meetings.create', { kind: 'meeting', title: 'Late', startsAt: '2020-01-01T10:00:00.000+03:00' })).toMatchObject({ ok: false });
    expect(await outboxRows(t, 'gcal.sync')).toEqual(before);
  });
});

describe('revokeRowsOf', () => {
  it('sets the live connection of a person who was removed to revoking, deletes the Google events, and writes one gcal.revoke row', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    await planMeeting(t, 'usr_003', { startsAt: START });
    expect(await t.db.statement('read', 'select user_id from google_events')).toEqual([{ user_id: 'usr_003' }]);
    const [connection] = await t.db.statement('read', 'select id from google_connections') as { id: string }[];
    const at = new Date('2026-10-21T07:00:00Z');
    const rows = await t.db.tx('write', (q) => revokeRowsOf(q, { id: 'usr_003' }, at));
    expect(rows).toEqual([{ kind: 'gcal.revoke', payload: { connectionId: connection.id } }]);
    expect(await t.db.statement('read', 'select state, changed_at from google_connections')).toEqual([{ state: 'revoking', changed_at: at.toISOString() }]);
    expect(await t.db.statement('read', 'select * from google_events')).toEqual([]);
    // A second ask finds no live row: no second revoke row.
    expect(await t.db.tx('write', (q) => revokeRowsOf(q, { id: 'usr_003' }, at))).toEqual([]);
    expect(await t.db.tx('write', (q) => revokeRowsOf(q, { id: 'usr_004' }, at))).toEqual([]);
  });

  it('deletes the remembered calendar of the removed person only, in the same transaction (a disconnect keeps it)', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    ok(await t.connect('usr_004'));
    const remembered = () => t.db.statement('read', 'select user_id from google_calendars order by user_id');
    expect(await remembered()).toEqual([{ user_id: 'usr_003' }, { user_id: 'usr_004' }]);
    ok(await t.call('usr_003', 'google.disconnect', {}));
    expect(await remembered()).toEqual([{ user_id: 'usr_003' }, { user_id: 'usr_004' }]);
    const at = new Date('2026-10-21T07:00:00Z');
    await t.db.tx('write', (q) => revokeRowsOf(q, { id: 'usr_003' }, at));
    expect(await remembered()).toEqual([{ user_id: 'usr_004' }]);
    ok(await t.call('usr_001', 'users.deactivate', { id: 'usr_004' }));
    expect(await remembered()).toEqual([{ user_id: 'usr_004' }]);
    ok(await t.call('usr_001', 'users.remove', { id: 'usr_004' }));
    expect(await remembered()).toEqual([]);
  });

  it('deletes the remembered calendar of a removed person who has no connection any more', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    ok(await t.call('usr_003', 'google.disconnect', {}));
    expect(await t.db.statement('read', 'select user_id from google_calendars')).toEqual([{ user_id: 'usr_003' }]);
    ok(await t.call('usr_001', 'users.deactivate', { id: 'usr_003' }));
    ok(await t.call('usr_001', 'users.remove', { id: 'usr_003' }));
    expect(await t.db.statement('read', 'select user_id from google_calendars')).toEqual([]);
    // The disconnect wrote the one revoke row. The removal finds no live connection, so it writes no second one.
    expect(await outboxRows(t, 'gcal.revoke')).toHaveLength(1);
  });

  it('writes the row in the transaction of users.remove, once, and none for a person with no connection', async () => {
    const t = await googleOffice();
    ok(await t.connect('usr_003'));
    for (const id of ['usr_003', 'usr_004']) {
      ok(await t.call('usr_001', 'users.deactivate', { id }));
      ok(await t.call('usr_001', 'users.remove', { id }));
    }
    const rows = await outboxRows(t, 'gcal.revoke');
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0].payload)).toEqual(['connectionId']);
  });
});
