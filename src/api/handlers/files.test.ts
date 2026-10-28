import { beforeEach, describe, expect, it } from 'vitest';
import { fileCalls, nextLetter } from './files';
import { MAX_FILE_BYTES } from '../contract/entities';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));
const pdf = (text: string) => new Blob([text], { type: 'application/pdf' });

describe('nextLetter', () => {
  it('counts like spreadsheet columns', () => {
    expect(['A', 'Z', 'AZ', 'ZZ'].map(nextLetter)).toEqual(['B', 'AA', 'BA', 'AAA']);
  });
});

describe('files', () => {
  it('adds a new version for the same name', async () => {
    const t = testApi(fileCalls);
    t.as('usr_003');
    const a = await t.api.call('files.upload', { projectId: 'prj_001', name: 'GF plan.pdf', blob: pdf('rev A') });
    expect(a.latest).toMatchObject({ letter: 'A', mimeType: 'application/pdf', size: 5 });
    const b = await t.api.call('files.upload', { projectId: 'prj_001', name: 'gf PLAN.pdf', blob: pdf('rev B2') });
    expect(b.file.id).toBe(a.file.id);
    expect(b.latest.letter).toBe('B');
    expect(b.file.versions).toHaveLength(2);
    const got = await t.api.call('files.get', { id: a.file.id, letter: 'A' });
    expect(got.version.letter).toBe('A');
    expect(got.blob.size).toBe(5);
    expect(await t.api.call('files.list', { projectId: 'prj_001' })).toHaveLength(1);
  });

  it('refuses a file over 500 MB, from its declared size', async () => {
    const t = testApi(fileCalls);
    t.as('usr_003');
    // A real 500 MB blob would slow the test, so the blob declares its size (test map 8.3).
    class BigBlob extends Blob {
      override get size(): number {
        return MAX_FILE_BYTES + 1;
      }
    }
    const big = new BigBlob(['x']);
    await expect(t.api.call('files.upload', { projectId: 'prj_001', name: 'huge.zip', blob: big })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['blob'] },
    });
  });

  it('takes a project file up to 500 MB and a file of a chat up to 250 MB only (fbk_070)', async () => {
    const t = testApi(fileCalls);
    t.as('usr_003');
    const sized = (bytes: number) => new (class extends Blob { override get size(): number { return bytes; } })(['x'], { type: 'application/pdf' });
    const MB = 1024 * 1024;
    // The shadow run (test:lite) puts the files on a 50 MB store, so only the prototype takes the full 500 MB here. server/calls/files.test.ts pins R2.
    if (!process.env.MADAR_LITE) await expect(t.api.call('files.upload', { projectId: 'prj_001', name: 'ok.pdf', blob: sized(500 * MB) })).resolves.toBeDefined();
    await expect(t.api.call('files.upload', { projectId: 'prj_001', name: 'big.pdf', blob: sized(500 * MB + 1) })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['blob'] } });
    // A chat file over 250 MB fails the size check before the chat is read.
    await expect(t.api.call('files.upload', { conversationId: 'cnv_001', name: 'chat.pdf', blob: sized(250 * MB + 1) })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['blob'] } });
    await expect(t.api.call('files.upload', { meetingId: 'mtg_001', name: 'm.pdf', blob: sized(250 * MB + 1) })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['blob'] } });
  });

  it('takes exactly one of a blob and an upload ID; the prototype has no uploads, so it refuses the ID', async () => {
    const t = testApi(fileCalls);
    t.as('usr_003');
    const both = { projectId: 'prj_001', name: 'a.pdf', blob: pdf('x'), uploadId: 'upl_001' };
    await expect(t.api.call('files.upload', both)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', uploadId: 'upl_001' })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['uploadId'] },
    });
    expect(await t.api.call('files.list', { projectId: 'prj_001' })).toHaveLength(0);
  });

  it('sends the upload ID form on the wire, never a blob', () => {
    const wire = fileCalls['files.upload'].wire?.input;
    expect(wire?.safeParse({ projectId: 'prj_001', name: 'a.pdf', uploadId: 'upl_001' }).success).toBe(true);
    expect(wire?.safeParse({ projectId: 'prj_001', name: 'a.pdf', blob: pdf('x') }).success).toBe(false);
    expect(wire?.parse({ projectId: 'prj_001', name: 'a.pdf', uploadId: 'upl_001' })).toEqual({
      projectId: 'prj_001', name: 'a.pdf', uploadId: 'upl_001', stageId: null, taskId: null, asCover: false, receivedFromClient: false,
    });
  });

  it('lets only the leader set the cover', async () => {
    const t = testApi(fileCalls);
    const svg = () => new Blob(['x'], { type: 'image/svg+xml' });
    t.as('usr_003');
    await expect(t.api.call('files.upload', { projectId: 'prj_001', name: 'cover.svg', blob: svg(), asCover: true })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    const view = await t.api.call('files.upload', { projectId: 'prj_001', name: 'cover.svg', blob: svg(), asCover: true });
    expect(t.store.state.projects.prj_001.coverFileId).toBe(view.file.id);
  });

  it('lets the uploader or the leader delete a file', async () => {
    const t = testApi(fileCalls);
    t.as('usr_003');
    const mine = await t.api.call('files.upload', { projectId: 'prj_001', name: 'mine.pdf', blob: pdf('x') });
    t.as('usr_004');
    await expect(t.api.call('files.delete', { id: mine.file.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    await t.api.call('files.delete', { id: mine.file.id });
    expect(t.store.state.files[mine.file.id]).toBeUndefined();
  });
});
