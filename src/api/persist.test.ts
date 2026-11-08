import { afterEach, describe, expect, it, vi } from 'vitest';
import { idbPersister, memoryPersister, openPersister } from './persist';
import { emptyState } from './store';
import { VADO_ENTERPRISE } from './vadoEnterprise';
import { clear, createStore, get, set } from 'idb-keyval';

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

  it('keeps two enterprises apart', async () => {
    const one = await idbPersister('madar-test-ent-apart', 'ent_001');
    const two = await idbPersister('madar-test-ent-apart', 'ent_002');
    await one.save(emptyState('2026-09-30'));
    await two.save(emptyState('2026-10-05'));
    expect((await (await idbPersister('madar-test-ent-apart', 'ent_001')).load())?.seededOn).toBe('2026-09-30');
    expect((await (await idbPersister('madar-test-ent-apart', 'ent_002')).load())?.seededOn).toBe('2026-10-05');
    expect(one.ent).toBe('ent_001');
    expect(two.ent).toBe('ent_002');
  });

  it('keeps the blobs of two enterprises apart', async () => {
    const one = await idbPersister('madar-test-ent-blobs', 'ent_001');
    const two = await idbPersister('madar-test-ent-blobs', 'ent_002');
    await one.putBlob('blob_1', new Blob(['one'], { type: 'text/plain' }));
    expect(await two.getBlob('blob_1')).toBeNull();
    await two.putBlob('blob_1', new Blob(['second'], { type: 'text/plain' }));
    expect((await one.getBlob('blob_1'))?.size).toBe(3);
    expect((await two.getBlob('blob_1'))?.size).toBe(6);
  });

  it('clear removes only the data of its own enterprise', async () => {
    const one = await idbPersister('madar-test-ent-clear', 'ent_001');
    const two = await idbPersister('madar-test-ent-clear', 'ent_002');
    await one.save(emptyState('2026-09-30'));
    await one.putBlob('blob_1', new Blob(['one']));
    await two.save(emptyState('2026-10-05'));
    await two.putBlob('blob_1', new Blob(['second']));
    await two.clear();
    expect(await two.load()).toBeNull();
    expect(await two.getBlob('blob_1')).toBeNull();
    expect((await one.load())?.seededOn).toBe('2026-09-30');
    expect((await one.getBlob('blob_1'))?.size).toBe(3);
  });

  it('moves the old key state to state:ent_001 on the first save', async () => {
    const data = createStore('madar-test-ent-move', 'data');
    await set('state', emptyState('2026-09-01'), data);
    const persister = await idbPersister('madar-test-ent-move');
    expect(persister.ent).toBe(VADO_ENTERPRISE);
    expect((await persister.load())?.seededOn).toBe('2026-09-01');
    await persister.save(emptyState('2026-09-02'));
    expect(await get('state', data)).toBeUndefined();
    expect(((await get('state:ent_001', data)) as { seededOn: string }).seededOn).toBe('2026-09-02');
    await clear(data);
  });

  it('does not give the old state to the second enterprise', async () => {
    const data = createStore('madar-test-ent-oldstate', 'data');
    await set('state', emptyState('2026-09-01'), data);
    const two = await idbPersister('madar-test-ent-oldstate', 'ent_002');
    expect(await two.load()).toBeNull();
    expect((await (await idbPersister('madar-test-ent-oldstate', 'ent_001')).load())?.seededOn).toBe('2026-09-01');
  });

  it('an old blob key still loads for ent_001 and not for ent_002', async () => {
    const blobs = createStore('madar-test-ent-oldblob-blobs', 'blobs');
    await set('blob_old', { type: 'text/plain', bytes: new TextEncoder().encode('old data').buffer }, blobs);
    const one = await idbPersister('madar-test-ent-oldblob', 'ent_001');
    const two = await idbPersister('madar-test-ent-oldblob', 'ent_002');
    expect((await one.getBlob('blob_old'))?.size).toBe(8);
    expect(await two.getBlob('blob_old')).toBeNull();
    await one.deleteBlob('blob_old');
    expect(await one.getBlob('blob_old')).toBeNull();
  });

  it('memory persisters carry the enterprise id too', () => {
    expect(memoryPersister().ent).toBe(VADO_ENTERPRISE);
    expect(memoryPersister('ent_002').ent).toBe('ent_002');
  });
});
