import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import type { CallEntry, ServerEntry, SharedEntry } from '../core/serverCallMap';
import type { ServerCallCtx } from '../core/types';
import { fakeDeps } from './fakes/deps';
import type { FakeFiles } from './fakes/files';
import { uploadStandIns } from './uploadStandIns';
import { browserPut } from './uploads';

const failing = async (): Promise<never> => {
  throw new ApiError('failed', 'The real step needs SQL.', { reason: 'needs_sql' });
};

const server = (name: string): ServerEntry => ({ kind: 'server', name, call: failing, input: {} as never, output: {} as never, readOnly: false });
const shared = (name: string, hooks: SharedEntry['hooks']): SharedEntry => ({ kind: 'shared', name, def: {} as never, input: {} as never, readOnly: false, hooks });

const ctx = () => {
  const deps = fakeDeps();
  const office = { lists: { projects: { prj_001: { id: 'prj_001' } } } } as unknown as ServerCallCtx['office'];
  return { deps, office, principal: { userId: 'usr_002' }, batch: { storyRefs: new Map(), overviewCalls: 0 }, now: new Date() } as ServerCallCtx;
};

const MAP = (): Map<string, CallEntry> => new Map<string, CallEntry>([
  ['files.uploadStart', server('files.uploadStart')],
  ['feedback.uploadStart', server('feedback.uploadStart')],
  ['files.upload', shared('files.upload', { preflight: failing, prepare: failing })],
  ['feedback.send', shared('feedback.send', { preflight: failing, prepare: failing })],
  ['feedback.screenshot', shared('feedback.screenshot', { preflight: failing })],
  ['tasks.update', server('tasks.update')],
]);

describe('the upload stand-ins of the in-memory mirror tests (dbApi.test.ts)', () => {
  it('starts a file upload with a put link of the fake store, and refuses an unknown project and a file over the limit', async () => {
    const entry = uploadStandIns(MAP()).get('files.uploadStart') as ServerEntry;
    const c = ctx();
    const { output } = await entry.call({ projectId: 'prj_001', name: 'a.pdf', size: 3, mimeType: 'application/pdf' }, c);
    expect(output).toMatchObject({ uploadId: expect.stringMatching(/^upl_dbmode_/), put: { url: expect.stringMatching(/^https:\/\/files\.test\/put\/up\//) } });
    await expect(entry.call({ projectId: 'prj_404', name: 'a.pdf', size: 3, mimeType: 'application/pdf' }, c)).rejects.toMatchObject({ code: 'not_found' });
    const over = c.deps.files.maxFileBytes + 1;
    await expect(entry.call({ projectId: 'prj_001', name: 'a.pdf', size: over, mimeType: 'application/pdf' }, c)).rejects.toMatchObject({ details: { reason: 'file_too_large' } });
  });

  it('replaces only the upload steps, keeps every other entry the same object, and leaves the given map as it is', () => {
    const map = MAP();
    const before = new Map(map);
    const result = uploadStandIns(map);
    for (const name of ['files.uploadStart', 'feedback.uploadStart', 'files.upload', 'feedback.send', 'feedback.screenshot']) expect(result.get(name)).not.toBe(map.get(name));
    expect(result.get('tasks.update')).toBe(map.get('tasks.update'));
    expect(map).toEqual(before);
  });

  it('confirms only an upload of the same person whose file arrived whole', async () => {
    const map = uploadStandIns(MAP());
    const c = ctx();
    const { output } = await (map.get('files.uploadStart') as ServerEntry).call({ projectId: 'prj_001', name: 'a.pdf', size: 3, mimeType: 'application/pdf' }, c);
    const { uploadId, put } = output as { uploadId: string; put: { url: string } };
    const hooks = (map.get('files.upload') as SharedEntry).hooks!;
    const hookCtx = { actorId: 'usr_002', now: new Date(), deps: c.deps };
    await expect(hooks.preflight!({ uploadId }, hookCtx)).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['uploadId'] } });
    browserPut(c.deps.files as FakeFiles, put.url, new Blob(['abc'], { type: 'application/pdf' }));
    await expect(hooks.preflight!({ uploadId }, { ...hookCtx, actorId: 'usr_003' })).rejects.toMatchObject({ code: 'invalid_input' });
    const prepared = await hooks.preflight!({ uploadId }, hookCtx);
    expect(prepared).toMatchObject({ size: 3, mimeType: 'application/pdf' });
    expect(await hooks.prepare!({ uploadId }, { ...hookCtx, q: (async () => []) as never }, prepared)).toBe(prepared);
  });

  it('starts one upload for each feedback screenshot, and feedback.send takes their stored keys and types', async () => {
    const map = uploadStandIns(MAP());
    const c = ctx();
    const shots = [{ size: 2, mimeType: 'image/png' }, { size: 3, mimeType: 'image/jpeg' }];
    const { output } = await (map.get('feedback.uploadStart') as ServerEntry).call({ screenshots: shots }, c);
    const { uploads } = output as { uploads: { uploadId: string; put: { url: string } }[] };
    expect(uploads).toHaveLength(2);
    uploads.forEach((upload, i) => browserPut(c.deps.files as FakeFiles, upload.put.url, new Blob([i === 0 ? 'ab' : 'abc'], { type: shots[i].mimeType })));
    const hooks = (map.get('feedback.send') as SharedEntry).hooks!;
    const prepared = await hooks.preflight!({ uploadIds: uploads.map((upload) => upload.uploadId) }, { actorId: 'usr_002', now: new Date(), deps: c.deps });
    expect(prepared).toEqual({ shots: [{ blobKey: expect.stringMatching(/^db-mode\//), type: 'image/png' }, { blobKey: expect.stringMatching(/^db-mode\//), type: 'image/jpeg' }] });
  });
});
