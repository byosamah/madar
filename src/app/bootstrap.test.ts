import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrap, startScheduler } from './bootstrap';
import { memoryPersister } from '../api/persist';
import { emptyState, STATE_VERSION, Store } from '../api/store';
import { addDays, setNow } from '../lib/dates';
import { NOW, TODAY } from '../test/factories';

describe('bootstrap', () => {
  it('builds the sample office on the first visit and loads saved work later', async () => {
    setNow(NOW);
    const persister = memoryPersister();
    const first = await bootstrap({ persister, latencyMs: 0 });
    // 12 projects of the plan, and the sample internal project (fbk_044).
    expect(Object.keys(first.store.state.projects)).toHaveLength(13);
    await first.api.call('projects.update', { id: 'prj_001', patch: { name: 'Corniche Tower' } });
    await first.store.flush();
    const second = await bootstrap({ persister, latencyMs: 0 });
    expect(second.store.state.projects.prj_001.name).toBe('Corniche Tower');
  });

  it('gives the runtime a live port: sample states, and the state of this tab for its own person (chat presence)', async () => {
    setNow(NOW);
    const runtime = await bootstrap({ persister: memoryPersister(), latencyMs: 0 });
    const live = runtime.live!;
    expect(live.stateOf('usr_002')).toBe('online');
    expect(live.stateOf('usr_007')).toBe('away');
    expect(live.stateOf('usr_005')).toBe('offline');
    const me = runtime.store.state.session.currentUserId;
    live.setMine('online');
    expect(live.stateOf(me)).toBe('online');
    live.stop();
  });

  it('shifts saved dates when the day changes', async () => {
    setNow(NOW);
    const persister = memoryPersister();
    const first = await bootstrap({ persister, latencyMs: 0 });
    await first.store.flush();
    const due = first.store.state.tasks.tsk_001.dueDate!;
    setNow(new Date('2026-10-03T06:00:00Z'));
    const second = await bootstrap({ persister, latencyMs: 0 });
    expect(second.store.state.seededOn).toBe('2026-10-03');
    expect(second.store.state.tasks.tsk_001.dueDate).toBe(addDays(due, 3));
  });

  it('builds a fresh office when the saved version is old', async () => {
    setNow(NOW);
    const persister = memoryPersister();
    const stale = emptyState(TODAY);
    stale.version = 0;
    await persister.save(stale);
    const runtime = await bootstrap({ persister, latencyMs: 0 });
    expect(Object.keys(runtime.store.state.projects)).toHaveLength(13);
  });

  it('never wipes an office saved by a newer build: it runs in memory and keeps the saved copy (audit 2026-10-03, API-2)', async () => {
    setNow(NOW);
    const persister = memoryPersister();
    const newer = emptyState(TODAY);
    newer.version = STATE_VERSION + 1;
    newer.projects.prj_001 = { ...((await bootstrap({ persister: memoryPersister(), latencyMs: 0 })).store.state.projects.prj_001), name: 'MY REAL PROJECT' };
    await persister.save(newer);
    const runtime = await bootstrap({ persister, latencyMs: 0 });
    expect(runtime.store.persistent).toBe(false);
    expect(Object.keys(runtime.store.state.projects)).toHaveLength(13);
    await runtime.api.call('projects.update', { id: 'prj_002', patch: { name: 'Changed here' } });
    await runtime.store.flush();
    const kept = (await persister.load())!;
    expect(kept.version).toBe(STATE_VERSION + 1);
    expect(kept.projects.prj_001.name).toBe('MY REAL PROJECT');
  });

  it('never wipes the saved office when it cannot be read (audit 2026-10-03, API-2)', async () => {
    setNow(NOW);
    const inner = memoryPersister();
    let cleared = false;
    const persister = {
      ...inner, persistent: true,
      load: () => Promise.reject(new Error('blocked')),
      clear: async () => {
        cleared = true;
      },
    };
    const runtime = await bootstrap({ persister, latencyMs: 0 });
    expect(cleared).toBe(false);
    expect(runtime.store.persistent).toBe(false);
    expect(Object.keys(runtime.store.state.projects)).toHaveLength(13);
  });

  it('adds the sample genders to an office saved before them, and keeps the local work', async () => {
    setNow(NOW);
    const persister = memoryPersister();
    const first = await bootstrap({ persister, latencyMs: 0 });
    await first.api.call('projects.update', { id: 'prj_001', patch: { name: 'Corniche Tower' } });
    await first.store.flush();
    const old = (await persister.load())!;
    old.version = 1;
    for (const user of Object.values(old.users)) delete user.gender;
    await persister.save(old);
    const second = await bootstrap({ persister, latencyMs: 0 });
    expect(second.store.state.version).toBe(STATE_VERSION);
    expect(second.store.state.projects.prj_001.name).toBe('Corniche Tower');
    expect(second.store.state.users.usr_001.gender).toBe('female');
    expect(second.store.state.users.usr_002.gender).toBe('male');
  });

  it('fills the real-build parts of the runtime: always signed in, a change source that is open, the prototype mode (plan, T0.4)', async () => {
    setNow(NOW);
    const runtime = await bootstrap({ persister: memoryPersister(), latencyMs: 0 });
    expect(runtime.mode).toBe('prototype');
    expect(runtime.auth?.status()).toBe('signed_in');
    expect(runtime.changes?.status()).toBe('open');
    const heard: unknown[] = [];
    const stop = runtime.changes!.subscribe((signals) => heard.push(signals));
    await runtime.api.call('projects.update', { id: 'prj_001', patch: { name: 'Corniche Tower' } });
    stop();
    await runtime.api.call('projects.update', { id: 'prj_001', patch: { name: 'Corniche Tower 2' } });
    expect(heard).toEqual([[]]);
  });
});

describe('the minute timer of the prototype (performance audit FET-11)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tells the screens and saves nothing when a tick finds nothing due and the day stays', async () => {
    vi.useFakeTimers();
    setNow(NOW);
    const runtime = await bootstrap({ persister: memoryPersister(), latencyMs: 0 });
    await runtime.store.flush();
    const save = vi.spyOn(runtime.store.persister, 'save');
    let heard = 0;
    runtime.store.subscribe(() => {
      heard += 1;
    });
    const before = JSON.stringify(runtime.store.state);
    const stop = startScheduler(runtime.store);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    stop();
    expect([heard, save.mock.calls.length]).toEqual([0, 0]);
    // The notices of the start are there already, so the triggers change nothing.
    expect(JSON.stringify(runtime.store.state)).toBe(before);
  });

  it('tells the screens and saves once for a tick that makes a notice', async () => {
    vi.useFakeTimers();
    setNow(NOW);
    const runtime = await bootstrap({ persister: memoryPersister(), latencyMs: 0 });
    await runtime.store.flush();
    const save = vi.spyOn(runtime.store.persister, 'save');
    let heard = 0;
    runtime.store.subscribe(() => {
      heard += 1;
    });
    const stop = startScheduler(runtime.store);
    // A task that became past due with a new due day: its reminder has a new dedupe key.
    const task = Object.values(runtime.store.state.tasks).find((t) => t.status === 'todo' && t.ownerId !== null && t.projectId !== null
      && runtime.store.state.projects[t.projectId]?.status === 'active')!;
    task.dueDate = addDays(TODAY, -5);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(heard).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    stop();
    expect(heard).toBe(1);
    expect(save.mock.calls.length).toBe(1);
  });

  // The settle of a meeting that ended (fbk_022, wave 2): the prototype has no job, so its minute timer calls meetings.settle.
  it('settles a meeting in the first tick after its end, with its Tracker line, and the next tick does nothing more', async () => {
    vi.useFakeTimers();
    // 08:59:30 in Riyadh. The meeting 08:45 to 09:00 has not ended.
    setNow(new Date('2026-09-30T05:59:30Z'));
    const runtime = await bootstrap({ persister: memoryPersister(), latencyMs: 0 });
    await runtime.store.flush();
    const made = await runtime.api.call('meetings.create', { kind: 'client', title: 'Review the facade', projectId: 'prj_001', startsAt: '2026-09-30T08:45:00+03:00', durationMin: 15 });
    const lines = () => Object.values(runtime.store.state.tracker ?? {}).filter((entry) => entry.auto === 'meeting');
    const stop = startScheduler(runtime.store, runtime.api);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runtime.store.state.meetings![made.id].settledAt ?? null).toBeNull();
    expect(lines()).toHaveLength(0);
    // 09:00:30: the meeting ended 30 seconds ago, and the next tick settles it.
    setNow(new Date('2026-09-30T06:00:30Z'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runtime.store.state.meetings![made.id].settledAt).toBe('2026-09-30T09:00:30.000+03:00');
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ meetingId: made.id, minutes: null, title: 'Review the facade' });
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    stop();
    expect(lines()).toHaveLength(1);
  });

  // A repeating series (fbk_022, wave 3): the prototype has no job, so its minute timer calls meetings.extend.
  it('keeps a series full: the first tick after a meeting of it ends adds the meeting that is short, and the next tick adds none', async () => {
    vi.useFakeTimers();
    setNow(new Date('2026-09-30T05:59:30Z'));
    const runtime = await bootstrap({ persister: memoryPersister(), latencyMs: 0 });
    await runtime.store.flush();
    const made = await runtime.api.call('meetings.create', {
      kind: 'client', title: 'Weekly review', projectId: 'prj_001', startsAt: '2026-09-30T08:45:00+03:00', durationMin: 15, repeat: { every: 'week', until: null },
    });
    const series = () => Object.values(runtime.store.state.meetings!).filter((meeting) => meeting.seriesId === made.id);
    expect(series()).toHaveLength(8);
    const stop = startScheduler(runtime.store, runtime.api);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(series()).toHaveLength(8);
    // 09:00:30: the first meeting ended 30 seconds ago, so 7 are ahead and one is short.
    setNow(new Date('2026-09-30T06:00:30Z'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(series()).toHaveLength(9);
    expect(series().map((meeting) => meeting.startsAt.slice(0, 10)).at(-1)).toBe('2026-11-25');
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    stop();
    expect(series()).toHaveLength(9);
  });

  it('keeps no series full without an api, and stops at the last day of the rule', async () => {
    vi.useFakeTimers();
    setNow(new Date('2026-09-30T05:59:30Z'));
    const runtime = await bootstrap({ persister: memoryPersister(), latencyMs: 0 });
    await runtime.store.flush();
    const made = await runtime.api.call('meetings.create', {
      kind: 'client', title: 'Weekly review', projectId: 'prj_001', startsAt: '2026-09-30T08:45:00+03:00', durationMin: 15, repeat: { every: 'week', until: '2026-11-18' },
    });
    const series = () => Object.values(runtime.store.state.meetings!).filter((meeting) => meeting.seriesId === made.id);
    expect(series()).toHaveLength(8);
    setNow(new Date('2026-09-30T06:00:30Z'));
    const withoutApi = startScheduler(runtime.store);
    await vi.advanceTimersByTimeAsync(60_000);
    withoutApi();
    // The 8 meetings reach 2026-11-18, the last day: nothing is short that a rule can fill.
    const withApi = startScheduler(runtime.store, runtime.api);
    await vi.advanceTimersByTimeAsync(60_000);
    withApi();
    expect(series()).toHaveLength(8);
  });

  it('runs the settle for no meeting without an api, and ignores a meeting that the current person does not see', async () => {
    vi.useFakeTimers();
    setNow(new Date('2026-09-30T06:00:30Z'));
    const runtime = await bootstrap({ persister: memoryPersister(), latencyMs: 0 });
    await runtime.store.flush();
    // A meeting with no project, planned by Omar for Sara: the current person (the Admin) is not on it.
    const state = runtime.store.state;
    const [first, second] = Object.values(state.users).filter((user) => user.kind === 'human' && user.active && user.systemRole !== 'admin');
    state.meetings = { ...state.meetings, mtg_900: {
      id: 'mtg_900', kind: 'meeting', title: 'Private talk', projectId: null, startsAt: '2026-09-30T08:45:00.000+03:00', endsAt: '2026-09-30T09:00:00.000+03:00', where: '', guests: '',
      notes: '', organizerId: first.id, attendeeIds: [second.id], status: 'scheduled', rev: 1, createdBy: first.id, createdAt: '2026-09-29T09:00:00.000+03:00',
    } };
    const withoutApi = startScheduler(runtime.store);
    await vi.advanceTimersByTimeAsync(60_000);
    withoutApi();
    expect(state.meetings.mtg_900.settledAt ?? null).toBeNull();
    const withApi = startScheduler(runtime.store, runtime.api);
    await vi.advanceTimersByTimeAsync(60_000);
    withApi();
    // not_found for the Admin: the timer ignores it and the meeting waits for a person who sees it.
    expect(state.meetings.mtg_900.settledAt ?? null).toBeNull();
  });

  it('still tells the screens once at a new office day, so the day counts refresh after midnight', async () => {
    vi.useFakeTimers();
    setNow(new Date('2026-10-08T20:59:30Z'));
    const store = new Store(emptyState('2026-10-08'), memoryPersister());
    let heard = 0;
    store.subscribe(() => {
      heard += 1;
    });
    const stop = startScheduler(store);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(heard).toBe(0);
    // 00:00 in Riyadh.
    setNow(new Date('2026-10-08T21:00:30Z'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(heard).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    stop();
    expect(heard).toBe(1);
  });
});
