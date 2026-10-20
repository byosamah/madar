import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import type { Meeting } from '../contract/entities';

beforeEach(() => setNow(NOW));

/**
 * meetings.delete (owner, 2026-10-23): a person deletes a cancelled meeting. The world of the factories: Hala (usr_001) is the Admin,
 * Faisal (usr_002) leads prj_001, Sara (usr_003) is on its team, Omar (usr_004) is on no team, Nour (usr_006) is a Member on no team.
 * "Now" is Wednesday 2026-09-30 09:00 in Riyadh.
 */
function world() {
  const t = testApi(calls);
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Nour Member' });
  t.store.state.counters.usr = 6;
  return t;
}
type World = ReturnType<typeof world>;

// Thursday 2026-10-01 at 10:00.
const START = '2026-10-01T10:00:00+03:00';
const weekly = { every: 'week' as const, until: null };
const project = (extra: Record<string, unknown> = {}) => ({ kind: 'client' as const, title: 'Weekly review', projectId: 'prj_001', startsAt: START, ...extra });
const office = (extra: Record<string, unknown> = {}) => ({ kind: 'meeting' as const, title: 'Private talk', startsAt: START, ...extra });

const refusal = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return null;
  } catch (e) {
    const { code, message, details } = e as { code: string; message: string; details?: { reason?: string } };
    return { code, message, reason: details?.reason };
  }
};

const meetingsOf = (t: World): Meeting[] => Object.values(t.store.state.meetings ?? {}).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
const idsOf = (t: World) => meetingsOf(t).map((m) => m.id);
const eventsOf = (t: World, verb: string) => Object.values(t.store.state.events).filter((e) => e.verb === verb);

/** The series mtg_001 to mtg_008, a week apart from 2026-10-01 to 2026-11-19, made by Sara. */
async function series() {
  const t = world();
  t.as('usr_003');
  await t.api.call('meetings.create', project({ attendeeIds: ['usr_002', 'usr_004'], repeat: weekly }));
  return t;
}

describe('meetings.delete', () => {
  it('deletes a cancelled meeting and keeps the whole record in the event, so an Undo can bring it back', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project({ attendeeIds: ['usr_002'], where: 'Site office', notes: 'Plans' }));
    await t.api.call('meetings.cancel', { id: 'mtg_001' });
    const copy = structuredClone(t.store.state.meetings!.mtg_001);
    expect(await t.api.call('meetings.delete', { id: 'mtg_001' })).toEqual({ deleted: 1 });
    expect(t.store.state.meetings!.mtg_001).toBeUndefined();
    const [event] = eventsOf(t, 'meeting.deleted');
    expect(event).toMatchObject({ targetType: 'meeting', targetId: 'mtg_001', projectId: 'prj_001', before: copy, after: null, actorId: 'usr_003' });
    expect(event).not.toHaveProperty('officeMeetingId');
  });

  it('refuses a meeting that is not cancelled', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project());
    expect(await refusal(() => t.api.call('meetings.delete', { id: 'mtg_001' }))).toMatchObject({ code: 'conflict', reason: 'meeting_not_cancelled' });
    expect(t.store.state.meetings!.mtg_001).toBeDefined();
    expect(eventsOf(t, 'meeting.deleted')).toHaveLength(0);
  });

  it('follows the right to change a meeting: the organizer, the leader and the Admin of a project meeting', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project({ attendeeIds: ['usr_004'] }));
    await t.api.call('meetings.cancel', { id: 'mtg_001' });
    // Omar attends but plans nothing here: he may not delete.
    t.as('usr_004');
    expect(await refusal(() => t.api.call('meetings.delete', { id: 'mtg_001' }))).toMatchObject({ code: 'forbidden' });
    expect((await t.api.call('meetings.get', { id: 'mtg_001' })).viewerCan).toMatchObject({ edit: false, cancel: false, delete: false });
    t.as('usr_002');
    expect((await t.api.call('meetings.get', { id: 'mtg_001' })).viewerCan).toMatchObject({ delete: true });
    t.as('usr_001');
    expect(await t.api.call('meetings.delete', { id: 'mtg_001' })).toEqual({ deleted: 1 });
  });

  it('gives viewerCan.delete to a cancelled meeting only', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project());
    expect((await t.api.call('meetings.get', { id: 'mtg_001' })).viewerCan).toMatchObject({ edit: true, cancel: true, delete: false });
    await t.api.call('meetings.cancel', { id: 'mtg_001' });
    expect((await t.api.call('meetings.get', { id: 'mtg_001' })).viewerCan).toMatchObject({ edit: false, cancel: false, delete: true });
  });

  it('reads a hidden meeting as missing, with the text of an unknown id', async () => {
    const t = world();
    t.as('usr_004');
    await t.api.call('meetings.create', office({ attendeeIds: ['usr_003'] }));
    await t.api.call('meetings.cancel', { id: 'mtg_001' });
    const unknown = await refusal(() => t.api.call('meetings.delete', { id: 'mtg_099' }));
    t.as('usr_006');
    const hidden = await refusal(() => t.api.call('meetings.delete', { id: 'mtg_001' }));
    expect(hidden).toMatchObject({ code: 'not_found' });
    expect(hidden?.message).toBe(unknown?.message.replace('mtg_099', 'mtg_001'));
    // The Admin is not invited, so the meeting is hidden from the Admin too.
    t.as('usr_001');
    expect(await refusal(() => t.api.call('meetings.delete', { id: 'mtg_001' }))).toMatchObject({ code: 'not_found' });
    // An attendee reads it but does not change it.
    t.as('usr_003');
    expect(await refusal(() => t.api.call('meetings.delete', { id: 'mtg_001' }))).toMatchObject({ code: 'forbidden' });
  });

  it('takes the delete back with one Undo of its story, also for a meeting with no project', async () => {
    const t = world();
    t.as('usr_004');
    await t.api.call('meetings.create', office({ attendeeIds: ['usr_003'], where: 'Cafe' }));
    await t.api.call('meetings.cancel', { id: 'mtg_001' });
    const copy = structuredClone(t.store.state.meetings!.mtg_001);
    await t.api.call('meetings.delete', { id: 'mtg_001' });
    const [event] = eventsOf(t, 'meeting.deleted');
    // The event of a meeting with no project names its meeting, so only its people read it.
    expect(event).toMatchObject({ officeMeetingId: 'mtg_001', projectId: null });
    // The meeting is gone, so nobody reads its events in the History...
    expect((await t.api.call('events.list', { targetType: 'meeting', targetId: 'mtg_001' })).filter((e) => e.event.id === event.id)).toHaveLength(0);
    // ...and a person who is not in it cannot take it back.
    t.as('usr_006');
    expect(await refusal(() => t.api.call('events.undoStory', { correlationId: event.correlationId }))).toMatchObject({ code: 'not_found' });
    t.as('usr_004');
    await t.api.call('events.undoStory', { correlationId: event.correlationId });
    const { rev, ...back } = t.store.state.meetings!.mtg_001;
    const { rev: oldRev, ...was } = copy;
    expect(back).toEqual(was);
    expect(rev).toBeGreaterThan(oldRev);
    expect(eventsOf(t, 'meeting.deleted')[0].undoneBy).not.toBeNull();
  });

  it('takes a delete of a project meeting back with its Undo', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project());
    await t.api.call('meetings.cancel', { id: 'mtg_001' });
    await t.api.call('meetings.delete', { id: 'mtg_001' });
    await t.api.call('events.undo', { eventId: eventsOf(t, 'meeting.deleted')[0].id });
    expect(t.store.state.meetings!.mtg_001).toMatchObject({ status: 'cancelled', title: 'Weekly review' });
  });

  it('leaves no notice of its own, and the notice of the cancel reads as gone', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project({ attendeeIds: ['usr_004'] }));
    await t.api.call('meetings.cancel', { id: 'mtg_001' });
    const notices = Object.keys(t.store.state.notifications).length;
    await t.api.call('meetings.delete', { id: 'mtg_001' });
    expect(Object.keys(t.store.state.notifications)).toHaveLength(notices);
    t.as('usr_004');
    const views = await t.api.call('notifications.list', {});
    expect(views.length).toBeGreaterThan(0);
    expect(views.every((view) => view.gone && view.target === '')).toBe(true);
    // The badge counts no notice of a meeting that is gone.
    expect(await t.api.call('notifications.count', {})).toMatchObject({ badge: 0 });
  });
});

describe('meetings.delete in a series', () => {
  it('deletes this meeting alone with the scope one, and the later cancelled meetings with the scope later', async () => {
    const t = await series();
    await t.api.call('meetings.cancel', { id: 'mtg_003', scope: 'later' });
    expect(await t.api.call('meetings.delete', { id: 'mtg_003' })).toEqual({ deleted: 1 });
    expect(idsOf(t)).toEqual(['mtg_001', 'mtg_002', 'mtg_004', 'mtg_005', 'mtg_006', 'mtg_007', 'mtg_008']);
    expect(await t.api.call('meetings.delete', { id: 'mtg_005', scope: 'later' })).toEqual({ deleted: 4 });
    expect(idsOf(t)).toEqual(['mtg_001', 'mtg_002', 'mtg_004']);
  });

  it('never deletes a scheduled meeting with the scope later', async () => {
    const t = await series();
    for (const id of ['mtg_003', 'mtg_004', 'mtg_006']) await t.api.call('meetings.cancel', { id });
    expect(await t.api.call('meetings.delete', { id: 'mtg_003', scope: 'later' })).toEqual({ deleted: 3 });
    expect(idsOf(t)).toEqual(['mtg_001', 'mtg_002', 'mtg_005', 'mtg_007', 'mtg_008']);
    for (const m of meetingsOf(t)) expect(m.status, m.id).toBe('scheduled');
  });

  it('writes meeting.deleted for the target and for each later one, with the target as the cause, in one story', async () => {
    const t = await series();
    await t.api.call('meetings.cancel', { id: 'mtg_006', scope: 'later' });
    await t.api.call('meetings.delete', { id: 'mtg_006', scope: 'later' });
    const deleted = eventsOf(t, 'meeting.deleted');
    expect(deleted.map((e) => e.targetId).sort()).toEqual(['mtg_006', 'mtg_007', 'mtg_008']);
    const first = deleted.find((e) => e.targetId === 'mtg_006')!;
    for (const e of deleted.filter((one) => one !== first)) expect(e.causeEventId).toBe(first.id);
    expect(new Set(deleted.map((e) => e.correlationId)).size).toBe(1);
  });

  it('takes a later delete back with one Undo of its story, and the series is whole again', async () => {
    const t = await series();
    await t.api.call('meetings.cancel', { id: 'mtg_005', scope: 'later' });
    const before = structuredClone(meetingsOf(t)).map(({ rev: _rev, ...rest }) => rest);
    await t.api.call('meetings.delete', { id: 'mtg_005', scope: 'later' });
    await t.api.call('events.undoStory', { correlationId: eventsOf(t, 'meeting.deleted')[0].correlationId });
    expect(meetingsOf(t).map(({ rev: _rev, ...rest }) => rest)).toEqual(before);
  });

  it('treats a meeting in no series as one meeting whatever the scope', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project());
    await t.api.call('meetings.cancel', { id: 'mtg_001' });
    expect(await t.api.call('meetings.delete', { id: 'mtg_001', scope: 'later' })).toEqual({ deleted: 1 });
  });

  it('adds no meeting after a cancel for "this and later" and a delete of the cancelled tail: the cancel recorded the last day on the series', async () => {
    const t = await series();
    await t.api.call('meetings.cancel', { id: 'mtg_003', scope: 'later' });
    await t.api.call('meetings.delete', { id: 'mtg_003', scope: 'later' });
    expect(idsOf(t)).toEqual(['mtg_001', 'mtg_002']);
    // The cancel set the last day on every meeting, the earlier ones too: the day before the first cancelled meeting (2026-10-15).
    for (const id of ['mtg_001', 'mtg_002']) expect(t.store.state.meetings![id].repeat, id).toEqual({ every: 'week', until: '2026-10-14' });
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 0 });
    expect(idsOf(t)).toEqual(['mtg_001', 'mtg_002']);
  });

  it('changes no last day: a delete never ends or restarts a series (owner, 2026-10-23)', async () => {
    const t = await series();
    await t.api.call('meetings.cancel', { id: 'mtg_008' });
    await t.api.call('meetings.cancel', { id: 'mtg_003' });
    const before = structuredClone(meetingsOf(t)).map(({ rev: _rev, ...rest }) => rest);
    await t.api.call('meetings.delete', { id: 'mtg_008' });
    await t.api.call('meetings.delete', { id: 'mtg_003' });
    expect(eventsOf(t, 'meeting.series_updated')).toHaveLength(0);
    const after = meetingsOf(t).map(({ rev: _rev, ...rest }) => rest);
    expect(after).toEqual(before.filter((m) => m.id !== 'mtg_008' && m.id !== 'mtg_003'));
    for (const m of meetingsOf(t)) expect(m.repeat, m.id).toEqual({ every: 'week', until: null });
  });

  it('keeps a series open when its last meeting is cancelled alone and deleted: the extension adds a meeting again', async () => {
    const t = await series();
    await t.api.call('meetings.cancel', { id: 'mtg_008' });
    await t.api.call('meetings.delete', { id: 'mtg_008' });
    expect(t.store.state.meetings!.mtg_007.repeat).toEqual({ every: 'week', until: null });
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 1 });
  });

  it('takes the whole story of a later cancel and a later delete back, in two Undos', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project({ repeat: { every: 'week', until: '2026-10-22' } }));
    await t.api.call('meetings.cancel', { id: 'mtg_004', scope: 'later' });
    for (const id of ['mtg_001', 'mtg_002', 'mtg_003']) expect(t.store.state.meetings![id].repeat, id).toEqual({ every: 'week', until: '2026-10-21' });
    await t.api.call('meetings.delete', { id: 'mtg_004' });
    await t.api.call('events.undoStory', { correlationId: eventsOf(t, 'meeting.deleted')[0].correlationId });
    await t.api.call('events.undoStory', { correlationId: eventsOf(t, 'meeting.cancelled')[0].correlationId });
    expect(idsOf(t)).toEqual(['mtg_001', 'mtg_002', 'mtg_003', 'mtg_004']);
    for (const m of meetingsOf(t)) expect(m.repeat, m.id).toEqual({ every: 'week', until: '2026-10-22' });
    expect(meetingsOf(t).map((m) => m.status)).toEqual(['scheduled', 'scheduled', 'scheduled', 'scheduled']);
  });
});
