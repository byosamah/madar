import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { diffState } from '../data/save';
import { fakeDeps } from '../test/fakes/deps';
import { memoryData } from './memoryData';
import { createRunCall } from './runCall';

/**
 * The change signals of a meeting (fbk_022, owner 2026-10-19, Q4). A meeting with no project is private to its organizer and its
 * attendees: its signals go only to the person channels of those people, the Admin too only when invited. They carry no office signal,
 * no actor, no story, no project and no id or title of the meeting. A project meeting signals like any change of its project.
 */

// usage.get is not built here (as in chatsGroupSignal.test.ts). serverCallMap.ts copies each call at import, so the mock comes first.
vi.mock('../calls/usage', async () => {
  const { notBuiltAsync } = await import('./notBuilt');
  return { usageGet: () => notBuiltAsync('usage.get'), usageRetryEffect: () => notBuiltAsync('usage.retryEffect') };
});

const NOW = new Date('2026-10-04T06:00:00Z');
const ADMIN = 'usr_001';
const ORGANIZER = 'usr_004';
const ATTENDEE = 'usr_003';
const REMOVED = 'usr_006';
const OUTSIDER = 'usr_002';
const AGENT = 'usr_009';
const TITLE = 'Salary talk SIGNAL-7731';
const SIGNAL_KEYS = new Set(['v', 'id', 'channel', 'seq', 'projects', 'office', 'kinds', 'people', 'storyId', 'actorId']);

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

function runner() {
  const mem = memoryData(structuredClone(seed));
  const deps = fakeDeps({ db: mem.db });
  deps.clock.set(NOW);
  const run = createRunCall({ data: () => mem.data() });
  const batch = () => ({ storyRefs: new Map<string, string>(), overviewCalls: 0 });
  /** Runs one call. "signals" are all the signals that the save sent, on every channel (the answer holds only the own ones). */
  const call = async (userId: string, name: string, input: unknown) => {
    const principal = userId === AGENT ? { userId, agent: { clientId: 'cli-test' } } : { userId };
    const sent = deps.signal.sent.length;
    const result = await run(deps, { principal, name, input, batch: batch() });
    if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
    return { output: result.output, signals: deps.signal.sent.slice(sent) };
  };
  return { mem, call };
}

describe('the signals of a meeting with no project', () => {
  it('go to the person channels of its people only: no office signal, no Admin, no actor, no story, and no title or id', async () => {
    const { call } = runner();
    const made = await call(ORGANIZER, 'meetings.create', { kind: 'meeting', title: TITLE, startsAt: '2026-10-06T10:00:00+03:00', attendeeIds: [ATTENDEE, REMOVED] });
    const id = (made.output as { id: string }).id;
    const signals = made.signals;
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.map((signal) => signal.channel).sort()).toEqual([ATTENDEE, ORGANIZER, REMOVED].sort().map((user) => `person:${user}`));
    for (const signal of signals) {
      const text = JSON.stringify(signal);
      for (const hidden of [id, TITLE, 'SIGNAL-7731']) expect(text).not.toContain(hidden);
      for (const key of Object.keys(signal)) expect(SIGNAL_KEYS.has(key), key).toBe(true);
      expect(signal).not.toHaveProperty('actorId');
      expect(signal).not.toHaveProperty('storyId');
      expect(signal.projects).toEqual([]);
      expect(signal.office).toBe(false);
      expect(signal.people).toEqual([signal.channel.replace('person:', '')]);
      expect(signal.kinds).toEqual(expect.arrayContaining(['events', 'meetings']));
    }
    expect(new Set(signals.map((signal) => signal.id)).size).toBe(1);
    for (const outsider of [ADMIN, OUTSIDER]) expect(signals.some((signal) => signal.channel === `person:${outsider}`), outsider).toBe(false);
  });

  it('tell a person taken off the attendees that the meeting changed, and still not the Admin', async () => {
    const { call } = runner();
    const made = await call(ORGANIZER, 'meetings.create', { kind: 'meeting', title: TITLE, startsAt: '2026-10-06T10:00:00+03:00', attendeeIds: [ATTENDEE, REMOVED] });
    const id = (made.output as { id: string }).id;
    const changed = await call(ORGANIZER, 'meetings.update', { id, attendeeIds: [ATTENDEE] });
    const channels = changed.signals.map((signal) => signal.channel);
    expect(channels.sort()).toEqual([ATTENDEE, ORGANIZER, REMOVED].sort().map((user) => `person:${user}`));
    const cancelled = await call(ORGANIZER, 'meetings.cancel', { id });
    expect(cancelled.signals.map((signal) => signal.channel)).toEqual([ATTENDEE, ORGANIZER].sort().map((user) => `person:${user}`));
  });

  it('go, for a delete and its Undo, to the people of the meeting only, with no title and no id (owner, 2026-10-23)', async () => {
    const { mem, call } = runner();
    const made = await call(ORGANIZER, 'meetings.create', { kind: 'meeting', title: TITLE, startsAt: '2026-10-06T10:00:00+03:00', attendeeIds: [ATTENDEE, REMOVED] });
    const id = (made.output as { id: string }).id;
    await call(ORGANIZER, 'meetings.cancel', { id });
    const deleted = await call(ORGANIZER, 'meetings.delete', { id });
    expect(deleted.output).toEqual({ deleted: 1 });
    const people = [ATTENDEE, ORGANIZER, REMOVED].sort().map((user) => `person:${user}`);
    expect(deleted.signals.map((signal) => signal.channel).sort()).toEqual(people);
    for (const signal of deleted.signals) {
      const text = JSON.stringify(signal);
      for (const hidden of [id, TITLE, 'SIGNAL-7731']) expect(text).not.toContain(hidden);
      expect(signal.office).toBe(false);
      expect(signal.projects).toEqual([]);
      expect(signal.kinds).toEqual(expect.arrayContaining(['events', 'meetings']));
    }
    const story = Object.values(mem.tables.state.events).find((event) => event.verb === 'meeting.deleted')!.correlationId;
    const back = await call(ORGANIZER, 'events.undoStory', { correlationId: story });
    expect(back.signals.map((signal) => signal.channel).sort()).toEqual(people);
  });

  it('go to the organizer behind an agent, not to the agent', async () => {
    const { call } = runner();
    const made = await call(AGENT, 'meetings.create', { kind: 'team', title: TITLE, startsAt: '2026-10-06T10:00:00+03:00', attendeeIds: [ATTENDEE] });
    expect(made.signals.map((signal) => signal.channel).sort()).toEqual([ADMIN, ATTENDEE].sort().map((user) => `person:${user}`));
  });

  it('shows in diffState as a private change with no project, and the Admin only as an attendee', async () => {
    const { mem, call } = runner();
    const before = structuredClone(mem.tables.state);
    await call(ORGANIZER, 'meetings.create', { kind: 'meeting', title: TITLE, startsAt: '2026-10-06T10:00:00+03:00', attendeeIds: [ATTENDEE] });
    const diff = diffState(before, mem.tables.state);
    expect(diff.privateChange).toBe(true);
    expect(diff.privateOnly).toBe(true);
    expect([...diff.privatePeople].sort()).toEqual([ATTENDEE, ORGANIZER]);
    expect([...diff.publicKinds]).toEqual([]);
    expect(diff.office).toBe(false);
    expect([...diff.projects]).toEqual([]);
  });
});

describe('the signals of the minutes (wave 2, owner 2026-10-19)', () => {
  const MINUTES = 'The raise is 4,000 riyals. SIGNAL-MINUTES-9027';

  it('go, for a meeting with no project, to the person channels of its people only, with the kinds and no name, no id and no text', async () => {
    const { call } = runner();
    const made = await call(ORGANIZER, 'meetings.create', { kind: 'meeting', title: TITLE, startsAt: '2026-10-02T09:00:00+03:00', attendeeIds: [ATTENDEE, REMOVED] });
    const id = (made.output as { id: string }).id;
    const saved = await call(ATTENDEE, 'meetings.saveMinutes', { id, text: MINUTES, fileIds: [] });
    expect(saved.signals.map((signal) => signal.channel).sort()).toEqual([ATTENDEE, ORGANIZER, REMOVED].sort().map((user) => `person:${user}`));
    for (const signal of saved.signals) {
      const text = JSON.stringify(signal);
      for (const hidden of [id, TITLE, 'SIGNAL-7731', 'SIGNAL-MINUTES-9027']) expect(text).not.toContain(hidden);
      for (const key of Object.keys(signal)) expect(SIGNAL_KEYS.has(key), key).toBe(true);
      expect(signal).not.toHaveProperty('actorId');
      expect(signal).not.toHaveProperty('storyId');
      expect(signal.projects).toEqual([]);
      expect(signal.office).toBe(false);
      expect(signal.kinds).toEqual(expect.arrayContaining(['events', 'meetings']));
    }
    for (const outsider of [ADMIN, OUTSIDER]) expect(saved.signals.some((signal) => signal.channel === `person:${outsider}`), outsider).toBe(false);
    expect(saved.signals.some((signal) => signal.channel === 'office')).toBe(false);
  });

  it('go, for a project meeting, on the office channel with the project and the kind tracker, as any change of the Tracker', async () => {
    const { call } = runner();
    const leader = seed.projects.prj_001.leaderId!;
    const made = await call(leader, 'meetings.create', { kind: 'client', title: 'Review the facade', projectId: 'prj_001', startsAt: '2026-10-02T09:00:00+03:00' });
    const id = (made.output as { id: string }).id;
    const saved = await call(leader, 'meetings.saveMinutes', { id, text: MINUTES, fileIds: [] });
    const office = saved.signals.find((signal) => signal.channel === 'office')!;
    expect(office).toMatchObject({ projects: ['prj_001'], actorId: leader });
    expect(office.kinds).toEqual(expect.arrayContaining(['events', 'meetings', 'tracker']));
    expect(JSON.stringify(saved.signals)).not.toContain('SIGNAL-MINUTES-9027');
  });
});

describe('the signals of a project meeting', () => {
  it('go on the office channel with the project, the actor and the story, as any change of the project', async () => {
    const { call } = runner();
    const leader = seed.projects.prj_001.leaderId!;
    const made = await call(leader, 'meetings.create', { kind: 'client', title: 'Review the facade', projectId: 'prj_001', startsAt: '2026-10-06T10:00:00+03:00' });
    const office = made.signals.find((signal) => signal.channel === 'office')!;
    expect(office).toMatchObject({ projects: ['prj_001'], actorId: leader });
    expect(office.kinds).toEqual(expect.arrayContaining(['events', 'meetings']));
    expect(office.people).toEqual([]);
  });
});

describe('the signals of a repeating series (wave 3, owner 2026-10-19)', () => {
  const weekly = { every: 'week', until: null };

  it('go, for a series with no project, to the person channels of its people only: one signal for the whole save, no name, no id, no title', async () => {
    const { call } = runner();
    const made = await call(ORGANIZER, 'meetings.create', { kind: 'meeting', title: TITLE, startsAt: '2026-10-06T10:00:00+03:00', attendeeIds: [ATTENDEE, REMOVED], repeat: weekly });
    const id = (made.output as { id: string }).id;
    const steps = [
      made,
      await call(ORGANIZER, 'meetings.update', { id, where: 'Room 5', scope: 'later' }),
      await call(ORGANIZER, 'meetings.cancel', { id, scope: 'later' }),
    ];
    for (const step of steps) {
      expect(step.signals.map((signal) => signal.channel).sort()).toEqual([ATTENDEE, ORGANIZER, REMOVED].sort().map((user) => `person:${user}`));
      for (const signal of step.signals) {
        const text = JSON.stringify(signal);
        for (const hidden of [id, TITLE, 'SIGNAL-7731', 'Room 5']) expect(text).not.toContain(hidden);
        for (const key of Object.keys(signal)) expect(SIGNAL_KEYS.has(key), key).toBe(true);
        expect(signal).not.toHaveProperty('actorId');
        expect(signal).not.toHaveProperty('storyId');
        expect(signal.projects).toEqual([]);
        expect(signal.office).toBe(false);
      }
      for (const outsider of [ADMIN, OUTSIDER]) expect(step.signals.some((signal) => signal.channel === `person:${outsider}`), outsider).toBe(false);
      expect(step.signals.some((signal) => signal.channel === 'office')).toBe(false);
    }
  });

  it('go, for a project series, on the office channel with the project, as any change of the project', async () => {
    const { call } = runner();
    const leader = seed.projects.prj_001.leaderId!;
    const made = await call(leader, 'meetings.create', { kind: 'client', title: 'Review the facade', projectId: 'prj_001', startsAt: '2026-10-06T10:00:00+03:00', repeat: weekly });
    const id = (made.output as { id: string }).id;
    const office = made.signals.find((signal) => signal.channel === 'office')!;
    expect(office).toMatchObject({ projects: ['prj_001'], actorId: leader });
    expect(office.kinds).toEqual(expect.arrayContaining(['events', 'meetings']));
    const changed = await call(leader, 'meetings.update', { id, where: 'Room 5', scope: 'later' });
    expect(changed.signals.find((signal) => signal.channel === 'office')).toMatchObject({ projects: ['prj_001'] });
  });
});
