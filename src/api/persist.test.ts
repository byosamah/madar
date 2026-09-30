import { afterEach, describe, expect, it, vi } from 'vitest';
import { idbPersister, memoryPersister, openPersister } from './persist';
import { emptyState } from './store';

describe('persisters', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps state and blobs in memory', async () => {
    const persister = memoryPersister();
    expect(persister.persistent).toBe(false);
    await persister.save(emptyState('2026-09-30'));
    expect((await persister.load())?.seededOn).toBe('2026-09-30');
    await persister.putBlob('blob_1', new Blob(['hello'], { type: 'text/plain' }));
    expect((await persister.getBlob('blob_1'))?.size).toBe(5);
    await persister.clear();
    expect(await persister.load()).toBeNull();
    expect(await persister.getBlob('blob_1')).toBeNull();
  });

  it('keeps state in IndexedDB across opens', async () => {
    const first = await idbPersister('madar-test-state');
    expect(first.persistent).toBe(true);
    await first.save(emptyState('2026-09-30'));
    const second = await idbPersister('madar-test-state');
    expect((await second.load())?.seededOn).toBe('2026-09-30');
  });

  it('falls back to memory when IndexedDB is missing', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const persister = await openPersister();
    expect(persister.persistent).toBe(false);
  });
});
