import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import type { Meeting, Notification } from '../contract/entities';
import { memberKey } from '../rowKeys';

beforeEach(() => setNow(NOW));

/**
 * Repeating meetings (fbk_022, wave 3, owner 2026-10-19): the repeat rule of meetings.create and the scope of meetings.update and
 * meetings.cancel. The world of the factories: Hala (usr_001) is the Admin, Faisal (usr_002) leads prj_001, Sara (usr_003) is on its
 * team, Omar (usr_004) is on no team, Nour (usr_006) is a Member on no team. "Now" is Wednesday 2026-09-30 09:00 in Riyadh.
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
const project = (extra: Record<string, unknown> = {}) => ({ kind: 'client' as const, title: 'Weekly review', projectId: 'prj_001', startsAt: START, repeat: weekly, ...extra });
const office = (extra: Record<string, unknown> = {}) => ({ kind: 'meeting' as const, title: 'Weekly sync', startsAt: START, repeat: weekly, ...extra });

const refusal = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return null;
  } catch (e) {
    const { code, details } = e as { code: string; details: { reason?: string; fields?: string[] } };
    return { code, reason: details.reason, fields: details.fields };
  }
};

const meetingsOf = (t: World): Meeting[] => Object.values(t.store.state.meetings ?? {}).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
const days = (list: Meeting[]) => list.map((m) => m.startsAt.slice(0, 10));
const noticesOf = (t: World, trigger = 'meeting_invited'): Notification[] => Object.values(t.store.state.notifications).filter((n) => n.trigger === trigger);
const eventsOf = (t: World, verb: string) => Object.values(t.store.state.events).filter((e) => e.verb === verb);

describe('meetings.create with repeat', () => {
  it('makes 8 meetings a week apart, with the same series, rule, time, place and people', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project({ attendeeIds: ['usr_002'], where: 'Site office', notes: 'Bring the plans' }));
    expect(made).toMatchObject({ id: 'mtg_001', seriesId: 'mtg_001', repeat: { every: 'week', until: null }, startsAt: '2026-10-01T10:00:00.000+03:00' });
    const list = meetingsOf(t);
    expect(days(list)).toEqual(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05', '2026-11-12', '2026-11-19']);
    for (const m of list) {
      expect(m, m.id).toMatchObject({
        seriesId: 'mtg_001', repeat: { every: 'week', until: null }, kind: 'client', title: 'Weekly review', projectId: 'prj_001', where: 'Site office',
        notes: 'Bring the plans', organizerId: 'usr_003', attendeeIds: ['usr_002'], status: 'scheduled', rev: 1, createdBy: 'usr_003',
      });
      expect(m.startsAt.slice(10), m.id).toBe('T10:00:00.000+03:00');
      expect(m.endsAt.slice(0, 10), m.id).toBe(m.startsAt.slice(0, 10));
      expect(m.endsAt.slice(10), m.id).toBe('T11:00:00.000+03:00');
    }
    // The ids grow with the days.
    expect(list.map((m) => m.id)).toEqual(['mtg_001', 'mtg_002', 'mtg_003', 'mtg_004', 'mtg_005', 'mtg_006', 'mtg_007', 'mtg_008']);
  });

  it('makes a meeting with no repeat as before: no series and no rule', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', { kind: 'client', title: 'Once', projectId: 'prj_001', startsAt: START });
    expect(meetingsOf(t)).toHaveLength(1);
    expect(t.store.state.meetings!.mtg_001).not.toHaveProperty('seriesId');
    expect(t.store.state.meetings!.mtg_001).not.toHaveProperty('repeat');
    await t.api.call('meetings.create', { kind: 'client', title: 'Null', projectId: 'prj_001', startsAt: START, repeat: null });
    expect(t.store.state.meetings!.mtg_002).not.toHaveProperty('repeat');
  });

  it('keeps Sunday to Thursday for "day", also when the first day is a Friday', async () => {
    const t = world();
    t.as('usr_003');
    // Friday 2026-10-02.
    await t.api.call('meetings.create', office({ startsAt: '2026-10-02T09:00:00+03:00', repeat: { every: 'day', until: null } }));
    expect(days(meetingsOf(t))).toEqual(['2026-10-02', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-11', '2026-10-12']);
  });

  it('keeps a step of 14 days for "two_weeks"', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', office({ repeat: { every: 'two_weeks', until: null } }));
    expect(days(meetingsOf(t))).toEqual(['2026-10-01', '2026-10-15', '2026-10-29', '2026-11-12', '2026-11-26', '2026-12-10', '2026-12-24', '2027-01-07']);
  });

  it('makes only the meetings up to until, and one meeting when until is the first day', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', office({ repeat: { every: 'week', until: '2026-10-22' } }));
    expect(days(meetingsOf(t))).toEqual(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22']);
    await t.api.call('meetings.create', office({ title: 'Single', repeat: { every: 'week', until: '2026-10-01' } }));
    expect(meetingsOf(t).filter((m) => m.title === 'Single')).toHaveLength(1);
  });

  it('refuses an until before the first day and an until more than 400 days after it', async () => {
    const t = world();
    t.as('usr_003');
    expect(await refusal(() => t.api.call('meetings.create', office({ repeat: { every: 'week', until: '2026-09-30' } })))).toMatchObject({ code: 'invalid_input', reason: 'until_before_start' });
    expect(await refusal(() => t.api.call('meetings.create', office({ repeat: { every: 'week', until: '2027-11-06' } })))).toMatchObject({ code: 'invalid_input', reason: 'until_too_far' });
    // 400 days after 2026-10-01 is 2027-11-05.
    await t.api.call('meetings.create', office({ repeat: { every: 'week', until: '2027-11-05' } }));
    expect(meetingsOf(t)).toHaveLength(8);
  });

  it('refuses a repeat every other value', async () => {
    const t = world();
    t.as('usr_003');
    expect(await refusal(() => t.api.call('meetings.create', office({ repeat: { every: 'month', until: null } })))).toMatchObject({ code: 'invalid_input' });
  });

  it('writes one meeting.created for the first meeting and one meeting.added for each other, in one story, with the first as their cause', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project());
    const created = eventsOf(t, 'meeting.created');
    const added = eventsOf(t, 'meeting.added');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ targetId: 'mtg_001', projectId: 'prj_001', before: null });
    expect(added).toHaveLength(7);
    for (const event of added) expect(event, event.targetId).toMatchObject({ projectId: 'prj_001', before: null, causeEventId: created[0].id });
    const stories = new Set([...created, ...added].map((e) => e.correlationId));
    expect(stories.size).toBe(1);
  });

  it('tells each attendee once for the whole series, not once for each meeting', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project({ attendeeIds: ['usr_002', 'usr_004'] }));
    const notices = noticesOf(t);
    expect(notices.map((n) => n.userId).sort()).toEqual(['usr_002', 'usr_004']);
    expect(notices.every((n) => n.targetId === 'mtg_001' && n.meeting?.change === 'new')).toBe(true);
    expect(notices.map((n) => n.dedupeKey).sort()).toEqual(['meeting_invited:mtg_001:usr_002', 'meeting_invited:mtg_001:usr_004']);
  });

  it('takes the whole series back with one Undo of its story, notices included', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project({ attendeeIds: ['usr_002'] }));
    const created = eventsOf(t, 'meeting.created')[0];
    expect(meetingsOf(t)).toHaveLength(8);
    await t.api.call('events.undoStory', { correlationId: created.correlationId });
    expect(meetingsOf(t)).toHaveLength(0);
    expect(noticesOf(t)).toHaveLength(0);
  });

  it('checks the rights of a project series as for one meeting: a person outside the team cannot plan one', async () => {
    const t = world();
    t.as('usr_004');
    expect(await refusal(() => t.api.call('meetings.create', project()))).toMatchObject({ code: 'forbidden' });
    expect(meetingsOf(t)).toHaveLength(0);
  });

  it('checks the first start as before: a start more than 14 days ago is refused, and nothing is made', async () => {
    const t = world();
    t.as('usr_003');
    expect(await refusal(() => t.api.call('meetings.create', office({ startsAt: '2026-09-10T10:00:00+03:00' })))).toMatchObject({ code: 'invalid_input', reason: 'in_the_past' });
    expect(meetingsOf(t)).toHaveLength(0);
  });

  it('shows the series and the rule in the list and in the detail', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', office({ attendeeIds: ['usr_004'] }));
    const rows = await t.api.call('meetings.list', { from: '2026-10-01', to: '2026-10-31' });
    expect(rows.map((r) => r.id)).toEqual(['mtg_001', 'mtg_002', 'mtg_003', 'mtg_004', 'mtg_005']);
    expect(rows.every((r) => r.seriesId === 'mtg_001' && r.repeat?.every === 'week')).toBe(true);
    expect(await t.api.call('meetings.get', { id: 'mtg_003' })).toMatchObject({ seriesId: 'mtg_001', repeat: { every: 'week', until: null } });
  });
});

describe('the project feed of a series', () => {
  it('shows one line for a series that is planned, one for a later change and one for a later cancel, not one for each meeting', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project());
    const verbs = async () => (await t.api.call('updates.list', { projectId: 'prj_001' })).flatMap((item) => (item.kind === 'event' ? [item.verb] : []));
    expect(await verbs()).toEqual(['meeting.created']);
    await t.api.call('meetings.update', { id: 'mtg_004', where: 'Room 9', scope: 'later' });
    expect((await verbs()).sort()).toEqual(['meeting.created', 'meeting.updated']);
    await t.api.call('meetings.cancel', { id: 'mtg_004', scope: 'later' });
    expect((await verbs()).sort()).toEqual(['meeting.cancelled', 'meeting.created', 'meeting.updated']);
  });
});

describe('meetings.update with a scope', () => {
  async function series(extra: Record<string, unknown> = {}) {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project({ attendeeIds: ['usr_002'], ...extra }));
    // The notices of the plan are not the subject of these tests.
    for (const id of Object.keys(t.store.state.notifications)) delete t.store.state.notifications[id];
    return t;
  }

  it('changes only this meeting by default, and with the scope "one"', async () => {
    const t = await series();
    await t.api.call('meetings.update', { id: 'mtg_003', where: 'Room 1' });
    await t.api.call('meetings.update', { id: 'mtg_004', where: 'Room 2', scope: 'one' });
    expect(meetingsOf(t).map((m) => m.where)).toEqual(['', '', 'Room 1', 'Room 2', '', '', '', '']);
  });

  it('changes this meeting and every scheduled meeting after it with the scope "later", and never an earlier one', async () => {
    const t = await series();
    const result = await t.api.call('meetings.update', { id: 'mtg_004', where: 'Room 9', title: 'Review of the facade', scope: 'later' });
    expect(result).toMatchObject({ id: 'mtg_004', where: 'Room 9', title: 'Review of the facade' });
    expect(meetingsOf(t).map((m) => [m.id, m.where, m.title])).toEqual([
      ['mtg_001', '', 'Weekly review'], ['mtg_002', '', 'Weekly review'], ['mtg_003', '', 'Weekly review'],
      ['mtg_004', 'Room 9', 'Review of the facade'], ['mtg_005', 'Room 9', 'Review of the facade'], ['mtg_006', 'Room 9', 'Review of the facade'],
      ['mtg_007', 'Room 9', 'Review of the facade'], ['mtg_008', 'Room 9', 'Review of the facade'],
    ]);
  });

  it('never changes a past meeting or a cancelled meeting, also with the scope "later" from an earlier one', async () => {
    const t = await series();
    // Wednesday 2026-10-21: the meetings of 10-01, 10-08 and 10-15 are past. mtg_005 (10-29) is cancelled by itself.
    setNow(new Date('2026-10-21T06:00:00Z'));
    await t.api.call('meetings.cancel', { id: 'mtg_005' });
    const before = structuredClone(meetingsOf(t));
    await t.api.call('meetings.update', { id: 'mtg_004', where: 'Room 9', scope: 'later' });
    const after = meetingsOf(t);
    expect(after.map((m) => [m.id, m.where])).toEqual([
      ['mtg_001', ''], ['mtg_002', ''], ['mtg_003', ''], ['mtg_004', 'Room 9'], ['mtg_005', ''], ['mtg_006', 'Room 9'], ['mtg_007', 'Room 9'], ['mtg_008', 'Room 9'],
    ]);
    // The cancelled meeting is the same record, byte for byte.
    expect(after.find((m) => m.id === 'mtg_005')).toEqual(before.find((m) => m.id === 'mtg_005'));
    for (const id of ['mtg_001', 'mtg_002', 'mtg_003']) expect(after.find((m) => m.id === id), id).toEqual(before.find((m) => m.id === id));
  });

  it('keeps the rule of a past meeting: only its notes change, also with the scope "later"', async () => {
    const t = await series();
    setNow(new Date('2026-10-21T06:00:00Z'));
    expect(await refusal(() => t.api.call('meetings.update', { id: 'mtg_003', where: 'Room 9', scope: 'later' }))).toMatchObject({ code: 'conflict', reason: 'meeting_over' });
    expect(meetingsOf(t).every((m) => m.where === '')).toBe(true);
  });

  it('applies a new time of day to all of them, on the day of each, and raises rev once for each', async () => {
    const t = await series();
    await t.api.call('meetings.update', { id: 'mtg_004', startsAt: '2026-10-22T14:30:00+03:00', scope: 'later' });
    const list = meetingsOf(t);
    expect(list.map((m) => [m.id, m.startsAt.slice(0, 16), m.endsAt.slice(11, 16), m.rev])).toEqual([
      ['mtg_001', '2026-10-01T10:00', '11:00', 1], ['mtg_002', '2026-10-08T10:00', '11:00', 1], ['mtg_003', '2026-10-15T10:00', '11:00', 1],
      ['mtg_004', '2026-10-22T14:30', '15:30', 2], ['mtg_005', '2026-10-29T14:30', '15:30', 2], ['mtg_006', '2026-11-05T14:30', '15:30', 2],
      ['mtg_007', '2026-11-12T14:30', '15:30', 2], ['mtg_008', '2026-11-19T14:30', '15:30', 2],
    ]);
  });

  it('applies a new length to all of them', async () => {
    const t = await series();
    await t.api.call('meetings.update', { id: 'mtg_006', durationMin: 90, scope: 'later' });
    expect(meetingsOf(t).map((m) => m.endsAt.slice(11, 16))).toEqual(['11:00', '11:00', '11:00', '11:00', '11:00', '11:30', '11:30', '11:30']);
  });

  it('refuses a new day with the scope "later", and moves one meeting to a new day with the scope "one"', async () => {
    const t = await series();
    expect(await refusal(() => t.api.call('meetings.update', { id: 'mtg_004', startsAt: '2026-10-23T10:00:00+03:00', scope: 'later' }))).toMatchObject({
      code: 'invalid_input', reason: 'series_day_one_only', fields: ['startsAt'],
    });
    expect(days(meetingsOf(t))).toEqual(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05', '2026-11-12', '2026-11-19']);
    await t.api.call('meetings.update', { id: 'mtg_004', startsAt: '2026-10-23T10:00:00+03:00', scope: 'one' });
    expect(t.store.state.meetings!.mtg_004.startsAt).toBe('2026-10-23T10:00:00.000+03:00');
    expect(t.store.state.meetings!.mtg_005.startsAt).toBe('2026-10-29T10:00:00.000+03:00');
  });

  it('does not reset a meeting that was changed by itself, when the later change does not touch that field', async () => {
    const t = await series();
    await t.api.call('meetings.update', { id: 'mtg_006', where: 'Alone', scope: 'one' });
    await t.api.call('meetings.update', { id: 'mtg_004', title: 'New title', scope: 'later' });
    const list = meetingsOf(t);
    expect(list.map((m) => m.title).slice(3)).toEqual(Array(5).fill('New title'));
    expect(list.map((m) => m.where)).toEqual(['', '', '', '', '', 'Alone', '', '']);
  });

  it('gives the new people to this meeting and to every later one, and tells an added person once', async () => {
    const t = await series();
    await t.api.call('meetings.update', { id: 'mtg_004', attendeeIds: ['usr_002', 'usr_004'], scope: 'later' });
    expect(meetingsOf(t).map((m) => m.attendeeIds)).toEqual([
      ['usr_002'], ['usr_002'], ['usr_002'], ['usr_002', 'usr_004'], ['usr_002', 'usr_004'], ['usr_002', 'usr_004'], ['usr_002', 'usr_004'], ['usr_002', 'usr_004'],
    ]);
    const notices = noticesOf(t);
    expect(notices.map((n) => [n.userId, n.targetId, n.meeting?.change])).toEqual([['usr_004', 'mtg_004', 'new']]);
  });

  it('sends one "moved" notice to each person for a later change of the time, not one for each meeting', async () => {
    const t = await series({ attendeeIds: ['usr_002', 'usr_004'] });
    for (const id of Object.keys(t.store.state.notifications)) delete t.store.state.notifications[id];
    await t.api.call('meetings.update', { id: 'mtg_004', startsAt: '2026-10-22T14:30:00+03:00', scope: 'later' });
    const notices = noticesOf(t);
    expect(notices.map((n) => [n.userId, n.targetId, n.meeting?.change]).sort()).toEqual([['usr_002', 'mtg_004', 'moved'], ['usr_004', 'mtg_004', 'moved']]);
  });

  it('sends nothing for a change that tells nobody (a title) and nothing when nothing changes', async () => {
    const t = await series({ attendeeIds: ['usr_002'] });
    await t.api.call('meetings.update', { id: 'mtg_004', title: 'Other title', scope: 'later' });
    await t.api.call('meetings.update', { id: 'mtg_004', title: 'Other title', scope: 'later' });
    expect(noticesOf(t)).toHaveLength(0);
    expect(eventsOf(t, 'meeting.updated')).toHaveLength(1);
  });

  it('writes meeting.updated for this meeting and meeting.series_updated for each other one, in one story', async () => {
    const t = await series();
    await t.api.call('meetings.update', { id: 'mtg_004', where: 'Room 9', scope: 'later' });
    const updated = eventsOf(t, 'meeting.updated');
    const others = eventsOf(t, 'meeting.series_updated');
    expect(updated.map((e) => e.targetId)).toEqual(['mtg_004']);
    expect(others.map((e) => e.targetId).sort()).toEqual(['mtg_005', 'mtg_006', 'mtg_007', 'mtg_008']);
    for (const event of others) expect(event.causeEventId).toBe(updated[0].id);
    expect(new Set([...updated, ...others].map((e) => e.correlationId)).size).toBe(1);
  });

  it('takes a whole later change back with one Undo of its story', async () => {
    const t = await series({ attendeeIds: ['usr_002'] });
    const before = structuredClone(meetingsOf(t));
    await t.api.call('meetings.update', { id: 'mtg_004', where: 'Room 9', startsAt: '2026-10-22T14:30:00+03:00', scope: 'later' });
    const updated = eventsOf(t, 'meeting.updated')[0];
    await t.api.call('events.undoStory', { correlationId: updated.correlationId });
    const after = meetingsOf(t);
    // rev grows with an Undo of a move (it never goes down), and the rest is as before.
    expect(after.map(({ rev: _rev, ...rest }) => rest)).toEqual(before.map(({ rev: _rev, ...rest }) => rest));
    expect(noticesOf(t)).toHaveLength(0);
  });

  it('treats a meeting that is in no series as one meeting, whatever the scope', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', { kind: 'client', title: 'Once', projectId: 'prj_001', startsAt: START });
    await t.api.call('meetings.update', { id: 'mtg_001', where: 'Room 1', scope: 'later' });
    expect(t.store.state.meetings!.mtg_001.where).toBe('Room 1');
  });

  it('keeps the rights of one meeting: the organizer, the leader and the Admin change a series, a team mate does not', async () => {
    const t = await series();
    t.as('usr_003');
    t.store.state.users.usr_007 = makeUser('usr_007', { name: 'Team mate' });
    t.store.state.members[memberKey('prj_001', 'usr_007')] = { projectId: 'prj_001', userId: 'usr_007', discipline: 'Architect' };
    t.as('usr_007');
    expect(await refusal(() => t.api.call('meetings.update', { id: 'mtg_004', where: 'No', scope: 'later' }))).toMatchObject({ code: 'forbidden' });
    expect(meetingsOf(t).every((m) => m.where === '')).toBe(true);
    for (const person of ['usr_002', 'usr_001']) {
      t.as(person);
      await t.api.call('meetings.update', { id: 'mtg_007', where: `By ${person}`, scope: 'later' });
    }
    expect(meetingsOf(t).map((m) => m.where).slice(6)).toEqual(['By usr_001', 'By usr_001']);
  });

  it('answers a missing id as before', async () => {
    const t = await series();
    expect(await refusal(() => t.api.call('meetings.update', { id: 'mtg_099', where: 'x', scope: 'later' }))).toMatchObject({ code: 'not_found' });
  });
});

describe('meetings.cancel with a scope', () => {
  async function series() {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project({ attendeeIds: ['usr_002', 'usr_004'] }));
    for (const id of Object.keys(t.store.state.notifications)) delete t.store.state.notifications[id];
    return t;
  }

  it('cancels only this meeting by default, and with the scope "one"', async () => {
    const t = await series();
    await t.api.call('meetings.cancel', { id: 'mtg_003' });
    await t.api.call('meetings.cancel', { id: 'mtg_005', scope: 'one' });
    expect(meetingsOf(t).map((m) => m.status)).toEqual(['scheduled', 'scheduled', 'cancelled', 'scheduled', 'cancelled', 'scheduled', 'scheduled', 'scheduled']);
  });

  it('cancels this meeting and every scheduled meeting after it with the scope "later", and records the last day on every meeting of the series (owner, 2026-10-23)', async () => {
    const t = await series();
    const result = await t.api.call('meetings.cancel', { id: 'mtg_004', scope: 'later' });
    expect(result).toMatchObject({ id: 'mtg_004', status: 'cancelled' });
    const list = meetingsOf(t);
    expect(list.map((m) => m.status)).toEqual(['scheduled', 'scheduled', 'scheduled', ...Array(5).fill('cancelled')]);
    // The person chose to stop the series here, so the rule of every meeting, the earlier ones too, ends on the day before the first cancelled one.
    for (const m of list) expect(m.repeat, m.id).toEqual({ every: 'week', until: '2026-10-21' });
    expect(list.slice(3).every((m) => m.rev === 2)).toBe(true);
    // The earlier meetings change their rule only: no new rev, no notice for them, and a series_updated event each.
    expect(list.slice(0, 3).every((m) => m.rev === 1)).toBe(true);
    expect(eventsOf(t, 'meeting.series_updated').map((e) => e.targetId).sort()).toEqual(['mtg_001', 'mtg_002', 'mtg_003']);
  });

  it('records no last day with the scope "one": a cancel of one meeting never ends a series, also not the last meeting', async () => {
    const t = await series();
    await t.api.call('meetings.cancel', { id: 'mtg_008' });
    for (const m of meetingsOf(t)) expect(m.repeat, m.id).toEqual({ every: 'week', until: null });
    expect(eventsOf(t, 'meeting.series_updated')).toHaveLength(0);
  });

  it('keeps an earlier until when the series ended sooner', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project({ repeat: { every: 'week', until: '2026-10-22' } }));
    await t.api.call('meetings.cancel', { id: 'mtg_003', scope: 'later' });
    expect(t.store.state.meetings!.mtg_003.repeat).toEqual({ every: 'week', until: '2026-10-14' });
    expect(t.store.state.meetings!.mtg_004.repeat).toEqual({ every: 'week', until: '2026-10-14' });
  });

  it('never changes a past or a cancelled meeting', async () => {
    const t = await series();
    setNow(new Date('2026-10-21T06:00:00Z'));
    await t.api.call('meetings.cancel', { id: 'mtg_006' });
    const before = structuredClone(meetingsOf(t));
    await t.api.call('meetings.cancel', { id: 'mtg_004', scope: 'later' });
    const after = meetingsOf(t);
    expect(after.map((m) => m.status)).toEqual(['scheduled', 'scheduled', 'scheduled', 'cancelled', 'cancelled', 'cancelled', 'cancelled', 'cancelled']);
    // These meetings change their rule only (the last day): the status, the time and the rev stay.
    const plain = ({ repeat: _repeat, ...rest }: Meeting) => rest;
    for (const id of ['mtg_001', 'mtg_002', 'mtg_003', 'mtg_006']) expect(plain(after.find((m) => m.id === id)!), id).toEqual(plain(before.find((m) => m.id === id)!));
  });

  it('tells each person once that the later meetings are cancelled, not once for each meeting', async () => {
    const t = await series();
    await t.api.call('meetings.cancel', { id: 'mtg_004', scope: 'later' });
    const notices = noticesOf(t);
    expect(notices.map((n) => [n.userId, n.targetId, n.meeting?.change]).sort()).toEqual([
      ['usr_002', 'mtg_004', 'cancelled'], ['usr_004', 'mtg_004', 'cancelled'],
    ]);
  });

  it('writes meeting.cancelled for this meeting and meeting.series_cancelled for each other one, in one story', async () => {
    const t = await series();
    await t.api.call('meetings.cancel', { id: 'mtg_004', scope: 'later' });
    const cancelled = eventsOf(t, 'meeting.cancelled');
    const others = eventsOf(t, 'meeting.series_cancelled');
    expect(cancelled.map((e) => e.targetId)).toEqual(['mtg_004']);
    expect(others.map((e) => e.targetId).sort()).toEqual(['mtg_005', 'mtg_006', 'mtg_007', 'mtg_008']);
    for (const event of others) expect(event.causeEventId).toBe(cancelled[0].id);
    expect(new Set([...cancelled, ...others].map((e) => e.correlationId)).size).toBe(1);
  });

  it('takes a whole later cancel back with one Undo of its story', async () => {
    const t = await series();
    const before = structuredClone(meetingsOf(t));
    await t.api.call('meetings.cancel', { id: 'mtg_004', scope: 'later' });
    await t.api.call('events.undoStory', { correlationId: eventsOf(t, 'meeting.cancelled')[0].correlationId });
    expect(meetingsOf(t).map(({ rev: _rev, ...rest }) => rest)).toEqual(before.map(({ rev: _rev, ...rest }) => rest));
    expect(noticesOf(t)).toHaveLength(0);
  });

  it('keeps the rule of a past meeting and of a second cancel', async () => {
    const t = await series();
    await t.api.call('meetings.cancel', { id: 'mtg_004', scope: 'later' });
    const events = Object.keys(t.store.state.events).length;
    // A second cancel changes nothing and writes no event, whatever the scope.
    await t.api.call('meetings.cancel', { id: 'mtg_004', scope: 'later' });
    expect(Object.keys(t.store.state.events)).toHaveLength(events);
    setNow(new Date('2026-10-21T06:00:00Z'));
    expect(await refusal(() => t.api.call('meetings.cancel', { id: 'mtg_003', scope: 'later' }))).toMatchObject({ code: 'conflict', reason: 'meeting_over' });
  });

  it('treats a meeting in no series as one meeting, and keeps the rights of one meeting', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', { kind: 'client', title: 'Once', projectId: 'prj_001', startsAt: START });
    await t.api.call('meetings.cancel', { id: 'mtg_001', scope: 'later' });
    expect(t.store.state.meetings!.mtg_001.status).toBe('cancelled');
    const s = await series();
    s.as('usr_006');
    expect(await refusal(() => s.api.call('meetings.cancel', { id: 'mtg_004', scope: 'later' }))).toMatchObject({ code: 'forbidden' });
  });
});

describe('a series with no project', () => {
  it('stays private to its people, also the later meetings and the scope edits', async () => {
    const t = world();
    t.as('usr_004');
    await t.api.call('meetings.create', office({ attendeeIds: ['usr_003'] }));
    expect(meetingsOf(t)).toHaveLength(8);
    // Hala, the Admin, is not invited: every meeting of the series reads as missing, and the scope edits too.
    t.as('usr_001');
    for (const id of ['mtg_001', 'mtg_005']) {
      expect(await refusal(() => t.api.call('meetings.get', { id })), id).toMatchObject({ code: 'not_found' });
      expect(await refusal(() => t.api.call('meetings.update', { id, where: 'x', scope: 'later' })), id).toMatchObject({ code: 'not_found' });
      expect(await refusal(() => t.api.call('meetings.cancel', { id, scope: 'later' })), id).toMatchObject({ code: 'not_found' });
    }
    expect(await t.api.call('meetings.list', { from: '2026-10-01', to: '2026-12-31' })).toEqual([]);
    // Every event of the series is private: the Admin lists none of them.
    const seen = await t.api.call('events.list', {});
    expect(seen.filter((e) => e.event.targetType === 'meeting')).toEqual([]);
    expect(Object.values(t.store.state.events).filter((e) => e.targetType === 'meeting').every((e) => e.officeMeetingId !== undefined)).toBe(true);
  });
});
