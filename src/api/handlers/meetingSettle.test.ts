import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeUser, NOW, testApi } from '../../test/factories';
import { now, setNow } from '../../lib/dates';
import { dueToSettle } from './meetings';
import type { TrackerEntry } from '../contract/entities';

beforeEach(() => setNow(NOW));

/**
 * Settle (fbk_022, wave 2, owner 2026-10-19): when a project meeting ends, Madar makes its Tracker line once. A team meeting and a
 * meeting with no project get the mark only. There is no minutes task and no notice.
 *
 * The world of the factories: Hala (usr_001) is the Admin, Faisal (usr_002) leads prj_001, Sara (usr_003) is on its team, Omar
 * (usr_004) is on no team. usr_006 is a Member on no team. "Now" is 2026-09-30 09:00 in Riyadh.
 */
function world() {
  const t = testApi(calls);
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Nour Member' });
  t.store.state.counters.usr = 6;
  return t;
}

const START = '2026-10-01T10:00:00+03:00';
const END = '2026-10-01T11:00:00+03:00';
const at = (stamp: string) => setNow(new Date(stamp));
const project = (extra: Record<string, unknown> = {}) => ({ kind: 'client' as const, title: 'Review the facade', projectId: 'prj_001', startsAt: START, ...extra });
const office = (extra: Record<string, unknown> = {}) => ({ kind: 'meeting' as const, title: 'Meet a new client', startsAt: START, ...extra });

const refusal = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return null;
  } catch (e) {
    const { code, message, details } = e as { code: string; message: string; details?: { reason?: string } };
    return { code, message, reason: details?.reason };
  }
};

const lines = (t: ReturnType<typeof world>): TrackerEntry[] => Object.values(t.store.state.tracker ?? {});
const count = (t: ReturnType<typeof world>) => ({ events: Object.keys(t.store.state.events).length, lines: lines(t).length, notices: Object.keys(t.store.state.notifications).length });

describe('meetings.settle', () => {
  it('settles a project meeting once and makes one Tracker line', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project({ attendeeIds: ['usr_002', 'usr_004'], notes: 'Bring the plans' }));
    at('2026-10-01T11:01:00+03:00');
    const settled = await t.api.call('meetings.settle', { id: made.id });
    expect(settled.settledAt).toBe('2026-10-01T11:01:00.000+03:00');
    expect(settled.trackerEntryId).toMatch(/^trk_/);
    expect(lines(t)).toHaveLength(1);
    expect(lines(t)[0]).toMatchObject({
      id: settled.trackerEntryId, projectId: 'prj_001', type: 'meeting', direction: 'both', title: 'Review the facade', note: 'Bring the plans',
      date: '2026-10-01', auto: 'meeting', meetingId: made.id, minutes: null, peopleIds: ['usr_003', 'usr_002', 'usr_004'], waiting: null,
    });
    expect(t.store.state.meetings![made.id]).toMatchObject({ settledAt: '2026-10-01T11:01:00.000+03:00', trackerEntryId: settled.trackerEntryId });
    // A second call, also later, gives the same values and writes nothing.
    const before = count(t);
    at('2026-10-01T12:30:00+03:00');
    expect(await t.api.call('meetings.settle', { id: made.id })).toEqual(settled);
    expect(count(t)).toEqual(before);
  });

  it('waits for the end, and settles at the end exactly', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project());
    at('2026-10-01T10:59:00+03:00');
    const before = count(t);
    expect(await t.api.call('meetings.settle', { id: made.id })).toEqual({ settledAt: null, trackerEntryId: null });
    expect(count(t)).toEqual(before);
    at(END);
    const settled = await t.api.call('meetings.settle', { id: made.id });
    expect(settled.settledAt).toBe('2026-10-01T11:00:00.000+03:00');
    expect(lines(t)).toHaveLength(1);
  });

  it('gives a cancelled meeting nothing', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project());
    await t.api.call('meetings.cancel', { id: made.id });
    at('2026-10-01T12:00:00+03:00');
    const before = count(t);
    expect(await t.api.call('meetings.settle', { id: made.id })).toEqual({ settledAt: null, trackerEntryId: null });
    expect(count(t)).toEqual(before);
    expect(t.store.state.meetings![made.id].settledAt ?? null).toBeNull();
  });

  it('gives a team meeting and a meeting with no project the mark only', async () => {
    const t = world();
    t.as('usr_003');
    const team = await t.api.call('meetings.create', project({ kind: 'team', title: 'Team sync' }));
    t.as('usr_004');
    const solo = await t.api.call('meetings.create', office({ attendeeIds: ['usr_003'] }));
    at('2026-10-01T12:00:00+03:00');
    t.as('usr_003');
    expect(await t.api.call('meetings.settle', { id: team.id })).toEqual({ settledAt: '2026-10-01T12:00:00.000+03:00', trackerEntryId: null });
    expect(await t.api.call('meetings.settle', { id: solo.id })).toEqual({ settledAt: '2026-10-01T12:00:00.000+03:00', trackerEntryId: null });
    expect(lines(t)).toHaveLength(0);
    const marks = Object.values(t.store.state.events).filter((event) => event.verb === 'meeting.settled');
    expect(marks.map((event) => event.targetId).sort()).toEqual([solo.id, team.id].sort());
  });

  it('makes a line that names its cause: the event of the mark', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project());
    at('2026-10-01T11:05:00+03:00');
    await t.api.call('meetings.settle', { id: made.id });
    const events = Object.values(t.store.state.events);
    const mark = events.find((event) => event.verb === 'meeting.settled')!;
    const logged = events.find((event) => event.verb === 'tracker.logged')!;
    expect(mark).toMatchObject({ targetType: 'meeting', targetId: made.id, projectId: 'prj_001' });
    expect(logged.causeEventId).toBe(mark.id);
    expect(logged.targetId).toBe(t.store.state.meetings![made.id].trackerEntryId);
    expect(mark.after).toMatchObject({ settledAt: '2026-10-01T11:05:00.000+03:00', trackerEntryId: logged.targetId });
  });

  it('gives the right day to a meeting at 23:30 in Riyadh', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project({ startsAt: '2026-10-20T23:30:00+03:00' }));
    expect(made.endsAt).toBe('2026-10-21T00:30:00.000+03:00');
    at('2026-10-21T00:31:00+03:00');
    await t.api.call('meetings.settle', { id: made.id });
    expect(lines(t)[0].date).toBe('2026-10-20');
  });

  it('keeps the first 20 people on the line', async () => {
    const t = world();
    for (let n = 10; n < 40; n += 1) t.store.state.users[`usr_0${n}`] = makeUser(`usr_0${n}`, { name: `Person ${n}` });
    t.as('usr_003');
    const everyone = Array.from({ length: 29 }, (_, n) => `usr_0${n + 10}`);
    const made = await t.api.call('meetings.create', project({ attendeeIds: everyone }));
    at('2026-10-01T11:01:00+03:00');
    await t.api.call('meetings.settle', { id: made.id });
    expect(lines(t)[0].peopleIds).toEqual(['usr_003', ...everyone.slice(0, 19)]);
  });

  it('sends no notice, no mail row and no minutes task', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project({ attendeeIds: ['usr_002'] }));
    const notices = Object.keys(t.store.state.notifications).length;
    const tasks = Object.keys(t.store.state.tasks).length;
    at('2026-10-01T11:30:00+03:00');
    await t.api.call('meetings.settle', { id: made.id });
    expect(Object.keys(t.store.state.notifications)).toHaveLength(notices);
    expect(Object.keys(t.store.state.tasks)).toHaveLength(tasks);
    expect(t.store.state.meetings![made.id].minutesTaskId ?? null).toBeNull();
  });

  it('reads a meeting with no project as missing for a person who is not in it, and keeps its mark private', async () => {
    const t = world();
    t.as('usr_004');
    const solo = await t.api.call('meetings.create', office({ attendeeIds: ['usr_003'] }));
    at('2026-10-01T12:00:00+03:00');
    for (const person of ['usr_001', 'usr_002', 'usr_006']) {
      t.as(person);
      const hidden = await refusal(() => t.api.call('meetings.settle', { id: solo.id }));
      const gone = await refusal(() => t.api.call('meetings.settle', { id: 'mtg_999' }));
      expect(hidden, person).toEqual({ ...gone, message: gone!.message.replace('mtg_999', solo.id) });
      expect(hidden, person).toMatchObject({ code: 'not_found', message: `Meeting ${solo.id} does not exist.` });
    }
    expect(t.store.state.meetings![solo.id].settledAt ?? null).toBeNull();
    t.as('usr_003');
    await t.api.call('meetings.settle', { id: solo.id });
    const mark = Object.values(t.store.state.events).find((event) => event.verb === 'meeting.settled')!;
    expect(mark.officeMeetingId).toBe(solo.id);
  });

  it('allows no Undo of the mark, and the Undo of the line deletes the line', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project());
    at('2026-10-01T11:05:00+03:00');
    // The leader settles: a person undoes only an own change, and only the leader or the Admin takes back the line of a meeting.
    t.as('usr_002');
    await t.api.call('meetings.settle', { id: made.id });
    const events = Object.values(t.store.state.events);
    const mark = events.find((event) => event.verb === 'meeting.settled')!;
    const logged = events.find((event) => event.verb === 'tracker.logged')!;
    for (const person of ['usr_003', 'usr_002', 'usr_001']) {
      t.as(person);
      expect(await refusal(() => t.api.call('events.undo', { eventId: mark.id })), person).toMatchObject({ code: 'conflict', reason: 'settle_final' });
    }
    t.as('usr_002');
    await t.api.call('events.undo', { eventId: logged.id });
    expect(lines(t)).toHaveLength(0);
    // The mark stays: the next job run does not settle the meeting again.
    expect(t.store.state.meetings![made.id].settledAt).toBe('2026-10-01T11:05:00.000+03:00');
    expect(dueToSettle(t.store.state, now())).toEqual([]);
  });

  it('lets any person who sees a project meeting settle it, with that person as the actor and the organizer as the author', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project());
    at('2026-10-01T11:05:00+03:00');
    t.as('usr_004');
    const settled = await t.api.call('meetings.settle', { id: made.id });
    expect(settled.trackerEntryId).toMatch(/^trk_/);
    // The line is made for the people of the meeting, whoever the actor is. Its author is the organizer.
    expect(lines(t)[0].createdBy).toBe('usr_003');
    expect(lines(t)[0].peopleIds).toEqual(['usr_003']);
    const logged = Object.values(t.store.state.events).find((event) => event.verb === 'tracker.logged')!;
    expect(logged.actorId).toBe('usr_004');
  });

  it('settles for the person of an agent, with the agent as the actor', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project());
    at('2026-10-01T11:05:00+03:00');
    t.as('usr_005');
    await t.api.call('meetings.settle', { id: made.id });
    const mark = Object.values(t.store.state.events).find((event) => event.verb === 'meeting.settled')!;
    expect(mark).toMatchObject({ actorId: 'usr_005', actingForId: 'usr_003', actorKind: 'agent' });
    // The author is the organizer (a person), never the agent.
    expect(lines(t)[0].createdBy).toBe('usr_003');
  });
});

/**
 * The author and the delete of the line of a meeting (security fix, 2026-10-19). Any person who sees a project meeting may settle it, so
 * the person who settles must not become the author of the line: the author is always the organizer. The line is no line that a person
 * logged, so the rule "the author deletes" does not apply to it. Only the project leader and the Admin delete it (or undo its log).
 */
describe('the author and the delete of the line of a meeting', () => {
  async function settledBy(person: string) {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project({ attendeeIds: ['usr_004', 'usr_006'] }));
    at('2026-10-01T11:05:00+03:00');
    t.as(person);
    await t.api.call('meetings.settle', { id: made.id });
    const [line] = lines(t);
    const logged = Object.values(t.store.state.events).find((event) => event.verb === 'tracker.logged')!;
    return { t, made, line, logged };
  }
  const canDeleteOf = async (t: ReturnType<typeof world>, person: string, id: string) => {
    t.as(person);
    const rows = await t.api.call('tracker.list', { projectId: 'prj_001' });
    return rows.find((row) => row.entry.id === id)?.canDelete;
  };

  it('makes the organizer the author when an attendee who is not the organizer settles it, and refuses that attendee the delete', async () => {
    const { t, line, logged } = await settledBy('usr_004');
    expect(line.createdBy).toBe('usr_003');
    expect(logged.actorId).toBe('usr_004');
    t.as('usr_004');
    expect(await refusal(() => t.api.call('tracker.delete', { id: line.id }))).toMatchObject({ code: 'forbidden' });
    expect(await refusal(() => t.api.call('events.undo', { eventId: logged.id }))).toMatchObject({ code: 'forbidden' });
    expect(lines(t)).toHaveLength(1);
  });

  it('gives the organizer no delete as the author of the line', async () => {
    const { t, line, logged } = await settledBy('usr_003');
    expect(line.createdBy).toBe('usr_003');
    expect(await canDeleteOf(t, 'usr_003', line.id)).toBe(false);
    t.as('usr_003');
    expect(await refusal(() => t.api.call('tracker.delete', { id: line.id }))).toMatchObject({ code: 'forbidden' });
    expect(await refusal(() => t.api.call('events.undo', { eventId: logged.id }))).toMatchObject({ code: 'forbidden' });
    expect(lines(t)).toHaveLength(1);
  });

  it('lets the project leader and the Admin delete the line, and the leader bring it back with Undo', async () => {
    const { t, line } = await settledBy('usr_006');
    expect(await canDeleteOf(t, 'usr_002', line.id)).toBe(true);
    expect(await canDeleteOf(t, 'usr_001', line.id)).toBe(true);
    t.as('usr_002');
    await t.api.call('tracker.delete', { id: line.id });
    expect(lines(t)).toHaveLength(0);
    const deleted = Object.values(t.store.state.events).find((event) => event.verb === 'tracker.deleted')!;
    await t.api.call('events.undo', { eventId: deleted.id });
    expect(lines(t)).toHaveLength(1);
    t.as('usr_001');
    await t.api.call('tracker.delete', { id: line.id });
    expect(lines(t)).toHaveLength(0);
  });

  it('makes the organizer the author when the first minutes save of an attendee settles the meeting', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project({ attendeeIds: ['usr_004'] }));
    at('2026-10-01T11:05:00+03:00');
    t.as('usr_004');
    await t.api.call('meetings.saveMinutes', { id: made.id, text: 'We agreed on the facade.' });
    const [line] = lines(t);
    expect(line).toMatchObject({ createdBy: 'usr_003', minutes: { text: 'We agreed on the facade.', updatedBy: 'usr_004' } });
    expect(await refusal(() => t.api.call('tracker.delete', { id: line.id }))).toMatchObject({ code: 'forbidden' });
  });

  it('keeps the author delete for a meeting line that a person logged by hand', async () => {
    const t = world();
    t.as('usr_003');
    const { entry } = await t.api.call('tracker.log', { projectId: 'prj_001', type: 'meeting', direction: 'both', title: 'A call by hand' });
    expect(entry.auto).toBeNull();
    await t.api.call('tracker.delete', { id: entry.id });
    expect(t.store.state.tracker?.[entry.id]).toBeUndefined();
  });
});

describe('dueToSettle', () => {
  const stateWith = async () => {
    const t = world();
    t.as('usr_003');
    const make = async (startsAt: string, title: string, extra: Record<string, unknown> = {}) => (await t.api.call('meetings.create', project({ startsAt, title, ...extra }))).id;
    return { t, make };
  };

  it('finds only the scheduled meetings that ended in the last 14 days, by end then id', async () => {
    const { t, make } = await stateWith();
    const ended = await make('2026-10-01T10:00:00+03:00', 'Ended');
    const endedEarlier = await make('2026-09-30T10:00:00+03:00', 'Ended earlier');
    const later = await make('2026-10-01T12:00:00+03:00', 'Later');
    const cancelled = await make('2026-10-01T09:00:00+03:00', 'Cancelled');
    await t.api.call('meetings.cancel', { id: cancelled });
    const done = await make('2026-10-01T08:00:00+03:00', 'Done');
    // A meeting that ended 15 days ago is made by hand: a new meeting may start 14 days back at most.
    t.store.state.meetings!.mtg_old = { ...t.store.state.meetings![ended], id: 'mtg_old', startsAt: '2026-09-15T10:00:00.000+03:00', endsAt: '2026-09-15T11:00:00.000+03:00' };
    at('2026-10-01T11:30:00+03:00');
    await t.api.call('meetings.settle', { id: done });
    // The meeting "done" is settled now. The others: two ended, one is later, one is cancelled, one is too old.
    const found = dueToSettle(t.store.state, now()).map((meeting) => meeting.id);
    expect(found).toEqual([endedEarlier, ended]);
    expect(found).not.toContain(later);
    expect(found).not.toContain('mtg_old');
  });

  it('counts the end itself as ended', async () => {
    const { t, make } = await stateWith();
    const id = await make('2026-10-01T10:00:00+03:00', 'Exactly');
    at('2026-10-01T10:59:59+03:00');
    expect(dueToSettle(t.store.state, now())).toEqual([]);
    at(END);
    expect(dueToSettle(t.store.state, now()).map((meeting) => meeting.id)).toEqual([id]);
  });
});
