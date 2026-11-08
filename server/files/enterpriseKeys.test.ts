import { describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import { filesUploadStart } from '../calls/files';
import type { FilesPort } from '../core/ports';
import type { ServerCallCtx } from '../core/types';
import { snapshotOf } from '../data/officeCache';
import { ENT_VADO } from '../enterprise/ids';
import { fakeDeps } from '../test/fakes/deps';
import { fakeFilesDb } from './fakeFilesDb';
import { assertKeyOf, FILE_KEY_REFUSED, guardFilesPort } from './guard';
import { checkIntent, type Intent } from './intents';
import { enterpriseKeyPrefix, isObjectKey, keyBelongsTo, keysOf, uploadKey } from './keys';

/**
 * Madar enterprises, plan D task 3 (design 5.11): the file keys of every enterprise except ENT_VADO start with e/<ent>/, and the file
 * port refuses a key outside the folder of its enterprise.
 */

const KEY_FORM = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;
const NOW = new Date('2026-11-08T06:00:00Z');

describe('the key folders of an enterprise', () => {
  it('makes the same key folders under e/ent-002/ for another enterprise', () => {
    const two = keysOf('ent_002');
    expect(enterpriseKeyPrefix('ent_002')).toBe('e/ent-002/');
    expect(two.uploadKey('prj_001', 'upl_1')).toBe('e/ent-002/prj-001/upl-1/file');
    expect(two.objectKey('prj_001', 'fil_001', 2)).toBe('e/ent-002/prj-001/fil-001/2/file');
    expect(two.stagingKey('upl_1')).toBe('e/ent-002/up/upl-1/file');
    expect(two.officeUploadKey('tsk_001', 'upl_1')).toBe('e/ent-002/office/tsk-001/upl-1/file');
    expect(two.resourcesUploadKey('upl_1')).toBe('e/ent-002/resources/upl-1/file');
    expect(two.screenshotKey('upl_1')).toBe('e/ent-002/feedback/upl-1/file');
    // ENT_VADO keeps the keys it has: the module functions are its key book.
    expect(keysOf(ENT_VADO).uploadKey('prj_001', 'upl_1')).toBe(uploadKey('prj_001', 'upl_1'));
    expect(uploadKey('prj_001', 'upl_1')).toBe('prj-001/upl-1/file');
    expect(enterpriseKeyPrefix(ENT_VADO)).toBe('');
  });

  it('gives every key function a key of the object key form', () => {
    const two = keysOf('ent_002');
    const keys = [
      two.objectKey('prj_001', 'fil_001', 1), two.thumbKey('prj_001', 'fil_001', 1), two.uploadKey('prj_001', 'upl_1'), two.uploadThumbKey('prj_001', 'upl_1'),
      two.stagingKey('upl_1'), two.stagingThumbKey('upl_1'), two.officeUploadKey('tsk_001', 'upl_1'), two.officeUploadThumbKey('tsk_001', 'upl_1'),
      two.chatUploadKey('cnv_001', 'upl_1'), two.chatUploadThumbKey('cnv_001', 'upl_1'), two.meetingUploadKey('mtg_001', 'upl_1'),
      two.meetingUploadThumbKey('mtg_001', 'upl_1'), two.resourcesUploadKey('upl_1'), two.resourcesUploadThumbKey('upl_1'), two.screenshotKey('upl_1'),
    ];
    for (const key of keys) {
      expect(isObjectKey(key)).toBe(true);
      expect(key).toMatch(KEY_FORM);
      expect(key.startsWith('e/ent-002/')).toBe(true);
      expect(keyBelongsTo('ent_002', key)).toBe(true);
      expect(keyBelongsTo('ent_003', key)).toBe(false);
      expect(keyBelongsTo(ENT_VADO, key)).toBe(false);
    }
  });

  it('knows a staging key only under the prefix of its own enterprise', () => {
    const key = 'e/ent-002/up/x/file';
    expect(keysOf('ent_002').isStagingKey(key)).toBe(true);
    expect(keysOf(ENT_VADO).isStagingKey(key)).toBe(false);
    expect(keysOf('ent_002').isStagingKey('up/x/file')).toBe(false);
  });

  it('refuses an id that is not an enterprise id, so two spellings never share a folder', () => {
    for (const bad of ['ENT_002', 'ent-002', 'ent_2', '', 'ent_002/x']) expect(() => keysOf(bad)).toThrow(/not valid/);
  });

  it('keeps a key of ENT_VADO out of the folder e/', () => {
    // No first part of a key of ENT_VADO is "e": a project part is prj-..., and the folders are up, office, chat, meeting, resources, feedback.
    expect(keyBelongsTo(ENT_VADO, 'prj-001/fil-001/1/file')).toBe(true);
    expect(keyBelongsTo(ENT_VADO, 'e/ent-002/prj-001/fil-001/1/file')).toBe(false);
  });
});

describe('guardFilesPort', () => {
  function recordingPort() {
    const calls: string[] = [];
    const port: FilesPort = {
      kind: 'r2',
      maxFileBytes: 1,
      presignPut: async (key) => (calls.push(`putSign ${key}`), { url: 'u', headers: {}, expiresAt: 'x' }),
      presignGet: async (key) => (calls.push(`getSign ${key}`), { url: 'u', expiresAt: 'x' }),
      head: async (key) => (calls.push(`head ${key}`), null),
      copy: async (from, to) => void calls.push(`copy ${from}>${to}`),
      remove: async (keys) => void calls.push(`remove ${keys.join(',')}`),
    };
    return { port, calls };
  }
  const MINE = 'e/ent-002/prj-001/fil-001/1/file';
  const BARE = 'prj-001/fil-001/1/file';
  const OTHER = 'e/ent-003/prj-001/fil-001/1/file';

  it('passes the keys of its enterprise through', async () => {
    const { port, calls } = recordingPort();
    const guarded = guardFilesPort(port, 'ent_002');
    await guarded.presignPut(MINE, { mimeType: 'application/pdf' });
    await guarded.presignGet(MINE, { disposition: 'inline', filename: 'a.pdf', mimeType: 'application/pdf' });
    await guarded.head(MINE);
    await guarded.copy('e/ent-002/up/x/file', MINE);
    await guarded.remove([MINE, 'e/ent-002/up/x/file']);
    expect(calls).toHaveLength(5);
    expect(guarded.kind).toBe('r2');
  });

  it('refuses a key of another enterprise on presignPut, presignGet, head, copy and remove', async () => {
    for (const [ent, key] of [['ent_002', BARE], ['ent_002', OTHER], [ENT_VADO, MINE]] as const) {
      const { port, calls } = recordingPort();
      const guarded = guardFilesPort(port, ent);
      await expect(guarded.presignPut(key, { mimeType: 'a/b' })).rejects.toThrow(FILE_KEY_REFUSED);
      await expect(guarded.presignGet(key, { disposition: 'inline', filename: 'a', mimeType: 'a/b' })).rejects.toThrow(FILE_KEY_REFUSED);
      await expect(guarded.head(key)).rejects.toThrow(FILE_KEY_REFUSED);
      await expect(guarded.copy(key, key)).rejects.toThrow(FILE_KEY_REFUSED);
      await expect(guarded.remove([key])).rejects.toThrow(FILE_KEY_REFUSED);
      expect(calls).toEqual([]);
    }
  });

  it('refuses a copy whose second key is wrong, and a remove with one wrong key in three, and calls the store for neither', async () => {
    const { port, calls } = recordingPort();
    const guarded = guardFilesPort(port, 'ent_002');
    await expect(guarded.copy(MINE, BARE)).rejects.toThrow(FILE_KEY_REFUSED);
    await expect(guarded.copy(OTHER, MINE)).rejects.toThrow(FILE_KEY_REFUSED);
    await expect(guarded.remove([MINE, OTHER, MINE])).rejects.toThrow(FILE_KEY_REFUSED);
    expect(calls).toEqual([]);
  });

  it('refuses a key that climbs out of its folder or has a wrong form', async () => {
    const { port, calls } = recordingPort();
    const guarded = guardFilesPort(port, 'ent_002');
    for (const key of ['e/ent-002/../ent-003/x/file', 'e/ent-002//x', 'e/ent-002/', 'e/ent-002', 'E/ent-002/x/file', 'e/ent-002/x file', '']) {
      await expect(guarded.head(key)).rejects.toThrow(FILE_KEY_REFUSED);
    }
    expect(calls).toEqual([]);
  });

  it('names no key and no enterprise in the refusal text', () => {
    let text = '';
    try {
      assertKeyOf('ent_002', OTHER);
    } catch (error) {
      text = (error as Error).message;
    }
    expect(text).toBe('The file key is not valid.');
    expect(text).not.toContain('ent-003');
    expect(text).not.toContain('ent_002');
  });
});

describe('checkIntent', () => {
  const intent = (o: Partial<Intent> = {}): Intent => ({
    id: 'upl_aaaaaaaaaaaaaaaaaaaaaa', actorId: 'usr_002', projectId: 'prj_001', stagingKey: 'e/ent-002/up/upl-aaaaaaaaaaaaaaaaaaaaaa/file',
    key: 'e/ent-002/prj-001/upl-aaaaaaaaaaaaaaaaaaaaaa/file', thumbKey: null, size: 12, mimeType: 'application/pdf',
    expiresAt: new Date(NOW.getTime() + 7_200_000), usedAt: null, ...o,
  });
  const base = { id: 'upl_aaaaaaaaaaaaaaaaaaaaaa', actorId: 'usr_002', now: NOW, field: 'uploadId', projectId: 'prj_001' };

  it('accepts the intent of the same enterprise', () => {
    expect(checkIntent(intent(), { ...base, ent: 'ent_002' }).key.startsWith('e/ent-002/')).toBe(true);
  });

  it('refuses an intent whose key has another prefix, with invalid_input and a text that names no key', () => {
    const cases: [string | undefined, Intent][] = [
      ['ent_002', intent({ key: 'prj-001/upl-a/file' })],
      ['ent_002', intent({ key: 'e/ent-003/prj-001/upl-a/file' })],
      ['ent_002', intent({ stagingKey: 'up/upl-a/file' })],
      [undefined, intent()],
    ];
    for (const [ent, row] of cases) {
      let error: { code?: string; message?: string } = {};
      try {
        checkIntent(row, { ...base, ...(ent ? { ent } : {}) });
      } catch (caught) {
        error = caught as typeof error;
      }
      expect(error.code).toBe('invalid_input');
      expect(error.message ?? '').not.toContain('ent-00');
      expect(error.message ?? '').not.toContain('prj-001/');
    }
  });

  it('finds the screenshot and the office folders under the prefix of the enterprise', () => {
    const shot = intent({ projectId: null, key: 'e/ent-002/feedback/upl-a/file' });
    expect(checkIntent(shot, { ...base, projectId: null, ent: 'ent_002' })).toBe(shot);
    const task = intent({ projectId: null, key: 'e/ent-002/office/tsk-001/upl-a/file' });
    expect(checkIntent(task, { ...base, projectId: null, officeTaskId: 'tsk_001', ent: 'ent_002' })).toBe(task);
  });
});

describe('files.uploadStart in another enterprise', () => {
  const USERS: Record<string, User> = {
    usr_002: { id: 'usr_002', name: 'usr_002', email: 'usr_002@madar.test', avatarUrl: null, kind: 'human', systemRole: 'member', discipline: 'Architect', active: true, ownerId: null } as User,
  };
  const office = snapshotOf({
    users: USERS, teams: {}, settings: {} as never, clients: {}, stageTemplates: {}, taskTemplates: {},
    projects: { prj_001: { id: 'prj_001', leaderId: 'usr_002' } as never }, members: {}, stages: {}, deadlines: {}, conversations: {},
  }, 1);

  it('gives a staging key and an intent key that both start with e/ent-002/', async () => {
    const db = fakeFilesDb({ users: USERS, tasks: {}, files: {} });
    const deps = fakeDeps({ db, config: { ent: 'ent_002' } });
    deps.clock.set(NOW);
    const ctx: ServerCallCtx = { deps, principal: { userId: 'usr_002' }, office, batch: { storyRefs: new Map(), overviewCalls: 0 }, now: NOW };
    const { output } = await filesUploadStart({ projectId: 'prj_001', name: 'plan.pdf', size: 1200, mimeType: 'application/pdf' }, ctx);
    const part = output.uploadId.replace('_', '-');
    expect(output.put.url).toBe(`https://files.test/put/e/ent-002/up/${part}/file`);
    expect(db.intents.get(output.uploadId)).toMatchObject({ stagingKey: `e/ent-002/up/${part}/file`, key: `e/ent-002/prj-001/${part}/file` });
    expect(deps.files.calls).toEqual([{ op: 'presignPut', key: `e/ent-002/up/${part}/file` }]);
  });
});
