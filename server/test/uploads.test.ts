import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import type { CallEntry, ServerEntry } from '../core/serverCallMap';
import type { ServerCallCtx } from '../core/types';
import { fakeDeps } from './fakes/deps';
import { fakeFiles, type FakeFiles } from './fakes/files';
import { browserPut, keyOfLink, standInUses, storedContent, withStandIns } from './uploads';

describe('the file data of db mode (task D2)', () => {
  it('reads the object key of a link of the fake file store, and refuses any other link', () => {
    expect(keyOfLink('https://files.test/put/up/upl_1')).toBe('up/upl_1');
    expect(keyOfLink('https://files.test/get/prj-001/a%20b/1?disposition=inline')).toBe('prj-001/a b/1');
    expect(() => keyOfLink('https://evil.example/put/up/upl_1')).toThrow(/not a link of the fake file store/);
  });

  it('keeps the content of each object: a browser upload puts it, a copy takes it along, a remove takes it away', async () => {
    const files = fakeFiles();
    browserPut(files, 'https://files.test/put/up/upl_1', new Blob(['abc'], { type: 'image/png' }));
    expect(files.objects.get('up/upl_1')).toEqual({ size: 3, mimeType: 'image/png' });
    await files.copy('up/upl_1', 'final/1');
    expect(await storedContent(files).get('final/1')?.text()).toBe('abc');
    await files.remove(['up/upl_1']);
    expect(storedContent(files).has('up/upl_1')).toBe(false);
    expect(storedContent(files).has('final/1')).toBe(true);
  });
});

describe('the stand-ins for the upload steps of track F', () => {
  const ctx = () => {
    const deps = fakeDeps();
    const office = { lists: { projects: { prj_001: { id: 'prj_001' } } } } as unknown as ServerCallCtx['office'];
    return { deps, office, principal: { userId: 'usr_002' }, batch: { storyRefs: new Map(), overviewCalls: 0 }, now: new Date() } as ServerCallCtx;
  };
  const start = (call: ServerEntry['call']): CallEntry => ({
    kind: 'server', name: 'files.uploadStart', call, input: {} as never, output: {} as never, readOnly: false,
  });
  const input = { projectId: 'prj_001', name: 'a.pdf', size: 3, mimeType: 'application/pdf' };

  it('runs a stand-in only while the real step answers not_built, and counts it', async () => {
    const stub = start(async () => {
      throw new ApiError('failed', 'files.uploadStart is not built yet.', { reason: 'not_built' });
    });
    const before = standInUses();
    const entry = withStandIns(new Map([['files.uploadStart', stub]])).get('files.uploadStart') as ServerEntry;
    const result = await entry.call(input, ctx());
    expect(result.output).toMatchObject({ uploadId: expect.stringMatching(/^upl_dbmode_/), put: { url: expect.stringMatching(/^https:\/\/files\.test\/put\/up\//) } });
    expect(standInUses()).toBe(before + 1);
  });

  it('keeps the answer and every other refusal of a real step', async () => {
    const real = withStandIns(new Map([['files.uploadStart', start(async () => ({ output: { real: true }, changed: false }))]])).get('files.uploadStart') as ServerEntry;
    expect((await real.call(input, ctx())).output).toEqual({ real: true });
    const refusing = withStandIns(new Map([['files.uploadStart', start(async () => {
      throw new ApiError('forbidden', 'No.');
    })]])).get('files.uploadStart') as ServerEntry;
    const before = standInUses();
    await expect(refusing.call(input, ctx())).rejects.toMatchObject({ code: 'forbidden' });
    expect(standInUses()).toBe(before);
  });

  it('confirms only an upload of the same person whose file arrived whole', async () => {
    const stub = start(async () => {
      throw new ApiError('failed', 'not built', { reason: 'not_built' });
    });
    const call = (withStandIns(new Map([['files.uploadStart', stub]])).get('files.uploadStart') as ServerEntry).call;
    const c = ctx();
    const { output } = await call(input, c);
    const { uploadId, put } = output as { uploadId: string; put: { url: string } };
    const hooksEntry: CallEntry = {
      kind: 'shared', name: 'files.upload', def: {} as never, input: {} as never, readOnly: false,
      hooks: {
        preflight: async () => { throw new ApiError('failed', 'not built', { reason: 'not_built' }); },
        prepare: async () => { throw new ApiError('failed', 'not built', { reason: 'not_built' }); },
      },
    };
    const hooks = (withStandIns(new Map([['files.upload', hooksEntry]])).get('files.upload') as Extract<CallEntry, { kind: 'shared' }>).hooks!;
    const hookCtx = { actorId: 'usr_002', now: new Date(), deps: c.deps };
    await expect(hooks.preflight!({ uploadId }, hookCtx)).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['uploadId'] } });
    browserPut(c.deps.files as FakeFiles, put.url, new Blob(['abc'], { type: 'application/pdf' }));
    await expect(hooks.preflight!({ uploadId }, { ...hookCtx, actorId: 'usr_003' })).rejects.toMatchObject({ code: 'invalid_input' });
    const prepared = await hooks.preflight!({ uploadId }, hookCtx);
    expect(prepared).toMatchObject({ size: 3, mimeType: 'application/pdf' });
    expect(await hooks.prepare!({ uploadId }, { ...hookCtx, q: (async () => []) as never }, prepared)).toBe(prepared);
  });
});
