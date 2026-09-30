import { describe, expect, it } from 'vitest';
import { bootstrap } from './bootstrap';
import { memoryPersister } from '../api/persist';
import { emptyState } from '../api/store';
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
});
