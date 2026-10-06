import { describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { createApi } from '../client';
import { ApiError } from '../errors';
import { memoryPersister } from '../persist';
import { Store } from '../store';
import { buildSeed } from '../../data/seed';
import { sampleOffice } from '../../data/sampleOffice';
import { NOW, TODAY } from '../../test/factories';
import { setNow } from '../../lib/dates';

describe('session.resetSampleData', () => {
  it('puts the sample data back and keeps the error switch', async () => {
    setNow(NOW);
    const store = new Store(await buildSeed(TODAY, async () => undefined), memoryPersister());
    const api = createApi(calls, { store, latencyMs: 0, sampleOffice });
    store.state.projects.prj_001.name = 'Changed';
    store.state.session.simulateErrors = true;
    store.state.session.currentUserId = 'usr_004';
    await api.call('session.resetSampleData', {});
    expect(store.state.projects.prj_001.name).toBe('Corniche Office Tower');
    expect(store.state.session.simulateErrors).toBe(true);
    expect(store.state.session.currentUserId).toBe('usr_001');
  });

  // The server bundles hold no sample office (server/workerGraph.test.ts). A runtime that gives none refuses, and keeps the office.
  it('refuses with no sample office from the runtime, and changes nothing', async () => {
    setNow(NOW);
    const store = new Store(await buildSeed(TODAY, async () => undefined), memoryPersister());
    const api = createApi(calls, { store, latencyMs: 0 });
    store.state.projects.prj_001.name = 'Changed';
    const error = await api.call('session.resetSampleData', {}).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('failed');
    expect(store.state.projects.prj_001.name).toBe('Changed');
  });
});
