import { describe, expect, it } from 'vitest';
import { bootstrap } from './bootstrap';
import { memoryPersister } from '../api/persist';
import { emptyState, STATE_VERSION } from '../api/store';
import { addDays, setNow } from '../lib/dates';
import { NOW, TODAY } from '../test/factories';

describe('bootstrap', () => {
  it('builds the sample office on the first visit and loads saved work later', async () => {
    setNow(NOW);
    const persister = memoryPersister();
    const first = await bootstrap({ persister, latencyMs: 0 });
    expect(Object.keys(first.store.state.projects)).toHaveLength(12);
    await first.api.call('projects.update', { id: 'prj_001', patch: { name: 'Corniche Tower' } });
    await first.store.flush();
    const second = await bootstrap({ persister, latencyMs: 0 });
    expect(second.store.state.projects.prj_001.name).toBe('Corniche Tower');
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
    expect(Object.keys(runtime.store.state.projects)).toHaveLength(12);
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
    expect(Object.keys(runtime.store.state.projects)).toHaveLength(12);
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
    expect(Object.keys(runtime.store.state.projects)).toHaveLength(12);
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

