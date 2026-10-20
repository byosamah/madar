import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import type { Meeting } from '../contract/entities';
import { seriesToExtend } from './meetings';

beforeEach(() => setNow(NOW));

/**
 * meetings.extend (fbk_022, wave 3): the call that the 15-minute job and the prototype timer make to keep a series full. The world of the
 * factories: Hala (usr_001) is the Admin, Faisal (usr_002) leads prj_001, Sara (usr_003) is on its team, Omar (usr_004) is on no team, Nour
 * (usr_006) is a Member on no team. "Now" is Wednesday 2026-09-30 09:00 in Riyadh.
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
const plan = (extra: Record<string, unknown> = {}) => ({ kind: 'client' as const, title: 'Weekly review', projectId: 'prj_001', startsAt: START, repeat: { every: 'week' as const, until: null }, ...extra });

const refusal = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return null;
  } catch (e) {
    const { code, message, details } = e as { code: string; message: string; details?: { reason?: string } };
    return { code, message, reason: details?.reason };
  }
};

const seriesOf = (t: World): Meeting[] => Object.values(t.store.state.meetings ?? {}).filter((m) => m.seriesId === 'mtg_001').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
const days = (list: Meeting[]) => list.map((m) => m.startsAt.slice(0, 10));
const eventsOf = (t: World, verb: string) => Object.values(t.store.state.events).filter((e) => e.verb === verb);
const forget = (t: World) => {
  for (const id of Object.keys(t.store.state.notifications)) delete t.store.state.notifications[id];
};

async function series(extra: Record<string, unknown> = {}) {
  const t = world();
  t.as('usr_003');
  await t.api.call('meetings.create', plan({ attendeeIds: ['usr_002', 'usr_004'], where: 'Site office', notes: 'Bring the plans', ...extra }));
  forget(t);
  return t;
}

describe('meetings.extend', () => {
  it('adds nothing to a full series, and nothing on a second call', async () => {
    const t = await series();
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 0 });
    expect(seriesOf(t)).toHaveLength(8);
  });

  it('adds the meetings that are short after the last one, and no more, as the weeks pass', async () => {
    const t = await series();
    // Wednesday 2026-10-21 at 09:00: the meetings of 10-01, 10-08 and 10-15 are over, 5 are ahead (10-22 to 11-19), so 3 are short.
    setNow(new Date('2026-10-21T06:00:00Z'));
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 3 });
    expect(days(seriesOf(t))).toEqual([
      '2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05', '2026-11-12', '2026-11-19', '2026-11-26', '2026-12-03', '2026-12-10',
    ]);
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 0 });
    expect(seriesOf(t)).toHaveLength(11);
  });

  it('copies the last meeting: kind, title, project, place, notes, people, organizer, length and time of day, with a new row for each day', async () => {
    const t = await series({ durationMin: 90 });
    // Friday 2026-10-02: the meeting of 10-01 is over, so 7 are ahead and one is short.
    setNow(new Date('2026-10-02T06:00:00Z'));
    await t.api.call('meetings.extend', { seriesId: 'mtg_001' });
    const added = seriesOf(t).slice(8);
    expect(added.map((m) => m.id)).toEqual(['mtg_009']);
    expect(added[0]).toEqual({
      id: 'mtg_009', kind: 'client', title: 'Weekly review', projectId: 'prj_001', startsAt: '2026-11-26T10:00:00.000+03:00', endsAt: '2026-11-26T11:30:00.000+03:00',
      where: 'Site office', guests: '', notes: 'Bring the plans', organizerId: 'usr_003', attendeeIds: ['usr_002', 'usr_004'], status: 'scheduled', rev: 1,
      seriesId: 'mtg_001', repeat: { every: 'week', until: null }, createdBy: 'usr_003', createdAt: '2026-10-02T09:00:00.000+03:00',
    });
    // A row of its own, not the object of the last meeting.
    expect(added[0].attendeeIds).not.toBe(seriesOf(t)[7].attendeeIds);
    expect(added[0].repeat).not.toBe(seriesOf(t)[7].repeat);
  });

  it('follows the last meeting where it stands: a Friday series stays on Fridays, and "day" skips the weekend', async () => {
    const t = world();
    t.as('usr_003');
    // Friday 2026-10-02, every day: Sunday to Thursday after it.
    await t.api.call('meetings.create', { kind: 'meeting', title: 'Daily', startsAt: '2026-10-02T09:00:00+03:00', repeat: { every: 'day', until: null } });
    expect(days(seriesOf(t))).toEqual(['2026-10-02', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-11', '2026-10-12']);
    // Tuesday 2026-10-06 at 09:00: the meetings of 10-02, 10-04 and 10-05 are over, the one of 10-06 has just begun. 5 are ahead and 3 are short.
    setNow(new Date('2026-10-06T06:00:00Z'));
    await t.api.call('meetings.extend', { seriesId: 'mtg_001' });
    expect(days(seriesOf(t)).slice(8)).toEqual(['2026-10-13', '2026-10-14', '2026-10-15']);
  });

  it('stops at until, and adds none once the last day has come', async () => {
    const t = await series({ repeat: { every: 'week', until: '2026-11-26' } });
    // 10-01 to 11-19 are the 8 made. One more fits (11-26), and then until is reached.
    setNow(new Date('2026-10-25T06:00:00Z'));
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 1 });
    expect(days(seriesOf(t)).at(-1)).toBe('2026-11-26');
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 0 });
    setNow(new Date('2026-11-12T06:00:00Z'));
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 0 });
    expect(seriesOf(t)).toHaveLength(9);
  });

  it('adds a meeting after a last meeting that is cancelled alone: a cancel of one meeting never ends a series (owner, 2026-10-23)', async () => {
    const t = await series();
    await t.api.call('meetings.cancel', { id: 'mtg_008' });
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 1 });
    const last = seriesOf(t).at(-1)!;
    // The new meeting copies the fields of the last one and is scheduled, a week after the cancelled one.
    expect(last).toMatchObject({ status: 'scheduled', startsAt: '2026-11-26T10:00:00.000+03:00', title: 'Weekly review', where: 'Site office', repeat: { every: 'week', until: null } });
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 0 });
    const u = await series();
    await u.api.call('meetings.cancel', { id: 'mtg_004' });
    expect(await u.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 1 });
    expect(days(seriesOf(u)).at(-1)).toBe('2026-11-26');
  });

  it('adds none to the series of a project that is completed or archived, and goes on when the project is paused or opens again', async () => {
    const t = await series();
    setNow(new Date('2026-10-21T06:00:00Z'));
    for (const status of ['completed', 'archived'] as const) {
      t.store.state.projects.prj_001.status = status;
      expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' }), status).toEqual({ added: 0 });
      expect(seriesToExtend(t.store.state, new Date('2026-10-21T06:00:00Z')), status).toEqual([]);
    }
    t.store.state.projects.prj_001.status = 'on_hold';
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 3 });
  });

  it('adds none after a "later" cancel: the cancel recorded the last day on the series, the person\'s choice to stop it', async () => {
    const t = await series();
    await t.api.call('meetings.cancel', { id: 'mtg_004', scope: 'later' });
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 0 });
    expect(seriesOf(t)).toHaveLength(8);
    // Also after the Undo of the cancel the rule is as before and the series goes on.
    await t.api.call('events.undoStory', { correlationId: eventsOf(t, 'meeting.cancelled')[0].correlationId });
    for (const m of seriesOf(t)) expect(m.repeat, m.id).toEqual({ every: 'week', until: null });
  });

  it('counts a meeting in progress as ahead and a meeting that is over as not ahead', async () => {
    const t = await series();
    // Thursday 2026-10-22 at 10:30 in Riyadh: the meeting of 10-22 (10:00 to 11:00) is in progress, 10-01 to 10-15 are over.
    setNow(new Date('2026-10-22T07:30:00Z'));
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 3 });
    // At 11:00 the meeting of 10-22 is over: 7 are ahead (10-29 to 12-10), so one is short.
    setNow(new Date('2026-10-22T08:00:00Z'));
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 1 });
  });

  it('starts after the last day, and after today when the series ran dry: never in the past', async () => {
    const t = await series();
    // The job stood still for a long time: Wednesday 2026-12-02. The last meeting was on 11-19. All 8 are over. The call reads the meetings from
    // today on (the loader reads the same window), so a series with nothing from today on reads as missing, and the job never asks for it.
    setNow(new Date('2026-12-02T06:00:00Z'));
    expect(await refusal(() => t.api.call('meetings.extend', { seriesId: 'mtg_001' }))).toMatchObject({ code: 'not_found' });
    // On the day of the last meeting, after its end, nothing is ahead: the new meetings start after that day.
    setNow(new Date('2026-11-19T12:00:00Z'));
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 8 });
    expect(days(seriesOf(t)).slice(8)).toEqual(['2026-11-26', '2026-12-03', '2026-12-10', '2026-12-17', '2026-12-24', '2026-12-31', '2027-01-07', '2027-01-14']);
  });

  it('writes one mark, meeting.extended, and one meeting.added for each new meeting with the mark as its cause, in one story, and no notice', async () => {
    const t = await series();
    setNow(new Date('2026-10-21T06:00:00Z'));
    await t.api.call('meetings.extend', { seriesId: 'mtg_001' });
    const marks = eventsOf(t, 'meeting.extended');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ targetId: 'mtg_008', projectId: 'prj_001', before: { ahead: 5 }, after: { ahead: 8 } });
    const added = eventsOf(t, 'meeting.added').filter((e) => e.causeEventId === marks[0].id);
    expect(added.map((e) => e.targetId)).toEqual(['mtg_009', 'mtg_010', 'mtg_011']);
    expect(new Set([marks[0], ...added].map((e) => e.correlationId)).size).toBe(1);
    expect(Object.values(t.store.state.notifications)).toEqual([]);
  });

  it('writes nothing when nothing is short', async () => {
    const t = await series();
    const events = Object.keys(t.store.state.events).length;
    await t.api.call('meetings.extend', { seriesId: 'mtg_001' });
    expect(Object.keys(t.store.state.events)).toHaveLength(events);
  });

  it('keeps the mark and the added meetings out of the project feed, which shows the first meeting alone, and the mark has no Undo', async () => {
    const t = await series();
    setNow(new Date('2026-10-21T06:00:00Z'));
    await t.api.call('meetings.extend', { seriesId: 'mtg_001' });
    const feed = await t.api.call('updates.list', { projectId: 'prj_001' });
    const verbs = feed.flatMap((item) => (item.kind === 'event' ? [item.verb] : []));
    expect(verbs.filter((verb) => verb.startsWith('meeting.'))).toEqual(['meeting.created']);
    const mark = eventsOf(t, 'meeting.extended')[0];
    expect(await refusal(() => t.api.call('events.undo', { eventId: mark.id }))).toMatchObject({ code: 'conflict' });
  });

  it('is open to the people who may change the series: the organizer, the leader and the Admin; an attendee who only reads it is refused', async () => {
    for (const person of ['usr_003', 'usr_002', 'usr_001']) {
      setNow(NOW);
      const t = await series();
      setNow(new Date('2026-10-21T06:00:00Z'));
      t.as(person);
      expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' }), person).toEqual({ added: 3 });
      expect(seriesOf(t).slice(8).every((m) => m.organizerId === 'usr_003' && m.createdBy === person), person).toBe(true);
    }
    // Omar attends but is on no team: he reads the series, and the History must never name him for meetings he may not plan (review 2026-10-20).
    setNow(NOW);
    const t = await series();
    setNow(new Date('2026-10-21T06:00:00Z'));
    t.as('usr_004');
    expect(await refusal(() => t.api.call('meetings.extend', { seriesId: 'mtg_001' }))).toMatchObject({ code: 'forbidden' });
    expect(seriesOf(t)).toHaveLength(8);
    expect(eventsOf(t, 'meeting.extended')).toHaveLength(0);
  });

  it('counts every meeting of the series: a person taken off the later meetings of a private series cannot extend it from the ones they still see', async () => {
    const t = world();
    t.as('usr_004');
    await t.api.call('meetings.create', { kind: 'meeting', title: 'Private weekly', startsAt: START, attendeeIds: ['usr_006', 'usr_003'], repeat: { every: 'week', until: null } });
    // From the meeting of 10-29 on, Sara is off the series. She still sees the meetings of 10-22 (and the past ones).
    await t.api.call('meetings.update', { id: 'mtg_005', attendeeIds: ['usr_006'], scope: 'later' });
    setNow(new Date('2026-10-21T06:00:00Z'));
    t.as('usr_003');
    expect(await refusal(() => t.api.call('meetings.extend', { seriesId: 'mtg_001' }))).toMatchObject({ code: 'not_found' });
    expect(seriesOf(t)).toHaveLength(8);
    // The organizer extends it from the true last meeting: the new meetings copy its people, without Sara, on new days only.
    t.as('usr_004');
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 3 });
    const all = seriesOf(t);
    expect(new Set(days(all)).size).toBe(all.length);
    expect(all.slice(8).every((m) => m.attendeeIds.join() === 'usr_006')).toBe(true);
  });

  it('answers an unknown series as a missing meeting, and a person without a view of a private series the same', async () => {
    const t = world();
    t.as('usr_004');
    await t.api.call('meetings.create', { kind: 'meeting', title: 'Private weekly', startsAt: START, attendeeIds: ['usr_006'], repeat: { every: 'week', until: null } });
    setNow(new Date('2026-10-21T06:00:00Z'));
    const none = await refusal(() => t.api.call('meetings.extend', { seriesId: 'mtg_999' }));
    expect(none).toEqual({ code: 'not_found', message: 'Meeting mtg_999 does not exist.', reason: undefined });
    for (const outsider of ['usr_001', 'usr_002', 'usr_003']) {
      t.as(outsider);
      const real = await refusal(() => t.api.call('meetings.extend', { seriesId: 'mtg_001' }));
      expect(real, outsider).toEqual({ ...none, message: 'Meeting mtg_001 does not exist.' });
    }
    expect(Object.values(t.store.state.meetings ?? {})).toHaveLength(8);
    // The attendee reads it but may not change it. The organizer extends it.
    t.as('usr_006');
    expect(await refusal(() => t.api.call('meetings.extend', { seriesId: 'mtg_001' }))).toMatchObject({ code: 'forbidden' });
    t.as('usr_004');
    expect(await t.api.call('meetings.extend', { seriesId: 'mtg_001' })).toEqual({ added: 3 });
  });

  it('keeps the series of a meeting in no series out: its id gives not_found', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', { kind: 'client', title: 'Once', projectId: 'prj_001', startsAt: START });
    expect(await refusal(() => t.api.call('meetings.extend', { seriesId: 'mtg_001' }))).toMatchObject({ code: 'not_found' });
  });
});

describe('seriesToExtend (the rule of the job read, for the prototype timer)', () => {
  const at = new Date('2026-10-21T06:00:00Z');

  it('lists a short series, and no full series, no series that ended and no meeting in no series', async () => {
    const t = await series();
    const other = await t.api.call('meetings.create', plan({ title: 'Other', startsAt: '2026-10-22T10:00:00+03:00' }));
    await t.api.call('meetings.create', { kind: 'client', title: 'Once', projectId: 'prj_001', startsAt: '2026-10-01T10:00:00+03:00' });
    setNow(at);
    // mtg_001: 5 ahead. "Other": 8 ahead, full.
    expect(seriesToExtend(t.store.state, at)).toEqual(['mtg_001']);
    await t.api.call('meetings.extend', { seriesId: 'mtg_001' });
    expect(seriesToExtend(t.store.state, at)).toEqual([]);
    // The last meeting of "Other" cancelled alone: the series goes on (owner, 2026-10-23), so it is short by one and the timer extends it.
    const last = Object.values(t.store.state.meetings!).filter((m) => m.seriesId === other.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).at(-1)!;
    await t.api.call('meetings.cancel', { id: last.id });
    expect(seriesToExtend(t.store.state, at)).toEqual([other.id]);
  });

  it('reads the series with the fewest meetings ahead first, then by id, and at most 20 of them', async () => {
    const t = world();
    t.as('usr_003');
    // 24 open series, every 2 weeks from 2026-10-01, and 2 that end on 2026-10-29 (3 meetings, a day of the rule is left after none of them).
    for (let n = 0; n < 26; n += 1) {
      await t.api.call('meetings.create', { kind: 'meeting', title: `Series ${n}`, startsAt: START, repeat: { every: 'two_weeks', until: n < 2 ? '2026-10-29' : null } });
    }
    const on = new Date('2026-10-16T06:00:00Z');
    setNow(on);
    const listed = seriesToExtend(t.store.state, on);
    expect(listed).toHaveLength(20);
    expect(listed).toEqual([...listed].sort());
    for (const id of listed) expect(t.store.state.meetings![id].repeat!.until, id).toBeNull();
    // The one with the fewest ahead comes first: take a meeting off a series with a cancel of its middle meeting alone.
    const target = listed[19];
    const middle = Object.values(t.store.state.meetings!).filter((m) => m.seriesId === target).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[3];
    t.as('usr_003');
    await t.api.call('meetings.cancel', { id: middle.id });
    expect(seriesToExtend(t.store.state, on)[0]).toBe(target);
  });
});
