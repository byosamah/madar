import { describe, expect, it } from 'vitest';
import { EFFECTS_OF, registerEffect } from '../core/effects';
import { fakeDeps } from '../test/fakes/deps';
import { fakeFilesDb } from './fakeFilesDb';
import { blobKeysInUse, keysOfVersions, projectBlobKeys, removeNowOrLater, removeStoredData, stashProjectKeys } from './effects';

/** The r2.delete effect and the stored data of a project delete (plan 5.2, "Delete"; plan 4.12; task F2). */

const version = (blobKey: string, thumbKey?: string) => ({ letter: 'A', blobKey, mimeType: 'image/png', size: 1, uploadedBy: 'usr_001', uploadedAt: 'x', ...(thumbKey ? { thumbKey } : {}) });

describe('the r2.delete effect', () => {
  it('is registered for both stores, once', () => {
    expect(() => registerEffect('r2.delete', async () => undefined)).toThrow(/already registered/);
  });

  it('removes the keys that no file and no report uses, and keeps the others', async () => {
    const db = fakeFilesDb({
      files: { fil_1: { id: 'fil_1', projectId: 'prj_002', versions: [version('prj-002/upl-a/file', 'prj-002/upl-a/thumb')] } },
      feedback: { fbk_1: { id: 'fbk_1', screenshots: [{ blobKey: 'feedback/upl-s/file', type: 'image/png' }] } },
    });
    const deps = fakeDeps({ db });
    for (const key of ['prj-002/upl-a/file', 'prj-002/upl-a/thumb', 'feedback/upl-s/file', 'prj-001/upl-b/file']) deps.files.objects.set(key, { size: 1, mimeType: 'image/png' });
    expect(await blobKeysInUse(db, ['prj-002/upl-a/file', 'prj-002/upl-a/thumb', 'feedback/upl-s/file', 'prj-001/upl-b/file'])).toEqual(
      new Set(['prj-002/upl-a/file', 'prj-002/upl-a/thumb', 'feedback/upl-s/file']),
    );
    await removeStoredData({ keys: ['prj-002/upl-a/file', 'prj-002/upl-a/thumb', 'feedback/upl-s/file', 'prj-001/upl-b/file'] }, deps);
    expect([...deps.files.objects.keys()].sort()).toEqual(['feedback/upl-s/file', 'prj-002/upl-a/file', 'prj-002/upl-a/thumb']);
  });

  it('skips a value that is not an object key (prototype data has none in a store), and does nothing for an empty list', async () => {
    const deps = fakeDeps({ db: fakeFilesDb() });
    await removeStoredData({ keys: ['blob_abc', 'prj-001/upl-b/file'] }, deps);
    expect(deps.files.calls).toEqual([{ op: 'remove', key: 'prj-001/upl-b/file' }]);
    deps.files.calls.length = 0;
    await removeStoredData({ keys: ['blob_abc'] }, deps);
    await removeStoredData({}, deps);
    expect(deps.files.calls).toEqual([]);
  });

  it('removes at once when it can, and writes an r2.delete row for the job when the store fails', async () => {
    const db = fakeFilesDb();
    const deps = fakeDeps({ db });
    deps.files.objects.set('up/upl-a/file', { size: 1, mimeType: 'image/png' });
    await removeNowOrLater(deps, ['up/upl-a/file']);
    expect(deps.files.objects.size).toBe(0);
    expect(db.outbox).toEqual([]);
    deps.files.remove = async () => {
      throw new Error('The store is down.');
    };
    await removeNowOrLater(deps, ['up/upl-b/file']);
    expect(db.outbox).toEqual([{ kind: 'r2.delete', payload: { keys: ['up/upl-b/file'] } }]);
    expect(deps.logs.map((l) => l.level)).toEqual(['warn']);
  });
});

describe('the stored data of a project delete', () => {
  it('lists every key of the project\'s files and of the versions its file events remember, files and thumbs, once each', async () => {
    expect(keysOfVersions([
      { versions: [version('k/1/file', 'k/1/thumb'), version('k/2/file')] },
      { versions: null },
      { versions: [version('k/1/file'), version('k/3/file')] },
    ])).toEqual(['k/1/file', 'k/1/thumb', 'k/2/file', 'k/3/file']);
    const db = fakeFilesDb({
      files: { fil_1: { id: 'fil_1', projectId: 'prj_001', versions: [version('k/1/file', 'k/1/thumb')] }, fil_2: { id: 'fil_2', projectId: 'prj_002', versions: [version('k/9/file')] } },
      events: [{ projectId: 'prj_001', targetType: 'file', before: { versions: [version('k/0/file')] }, after: null }],
    });
    expect((await projectBlobKeys(db.q, 'prj_001')).sort()).toEqual(['k/0/file', 'k/1/file', 'k/1/thumb']);
  });

  it('hands the keys from the prepare hook to the outbox of the same transaction, once', async () => {
    const [producer] = EFFECTS_OF['projects.delete'] ?? [];
    expect(producer).toBeTypeOf('function');
    const q = (async () => []) as never;
    const other = (async () => []) as never;
    stashProjectKeys(q, ['k/1/file']);
    expect(await producer({ deleted: true }, {} as never, other)).toEqual([]);
    expect(await producer({ deleted: true }, {} as never, q)).toEqual([{ kind: 'r2.delete', payload: { keys: ['k/1/file'] } }]);
    expect(await producer({ deleted: true }, {} as never, q)).toEqual([]);
    stashProjectKeys(q, []);
    expect(await producer({ deleted: true }, {} as never, q)).toEqual([]);
  });
});
