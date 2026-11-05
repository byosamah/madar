import { describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import type { ServerCallCtx } from '../core/types';
import { snapshotOf } from '../data/officeCache';
import { fakeFilesDb } from '../files/fakeFilesDb';
import { fakeDeps } from '../test/fakes/deps';
import { filesLink, filesUploadStart } from './files';

/**
 * files.link and files.uploadStart of the Resources page (fbk_078, owner 2026-11-05). Every active person gets a link to a file of Resources, except a file
 * in a locked folder: a person without the switch "Locked folders" gets the answer of a missing file and no link is signed, also an agent of that person.
 * An upload link into Resources needs the switch "Manage office resources". usr_001 is the Admin (both switches), usr_002 holds neither, usr_003 holds only
 * the lock switch, usr_004 holds only the manage switch, usr_005 is the agent of usr_004, usr_006 the agent of usr_003, usr_007 is turned off.
 */
const NOW = new Date('2026-10-04T06:00:00Z');
const user = (id: string, o: Partial<User> = {}): User =>
  ({ id, name: id, email: `${id}@madar.test`, avatarUrl: null, kind: 'human', systemRole: 'member', discipline: 'Architect', active: true, ownerId: null, ...o }) as User;
const USERS: Record<string, User> = {
  usr_001: user('usr_001', { systemRole: 'admin' }), usr_002: user('usr_002'), usr_003: user('usr_003', { roleId: 'rol_001' }), usr_004: user('usr_004', { roleId: 'rol_002' }),
  usr_005: user('usr_005', { kind: 'agent', ownerId: 'usr_004' }), usr_006: user('usr_006', { kind: 'agent', ownerId: 'usr_003' }), usr_007: user('usr_007', { active: false }),
};
const folder = (id: string, locked: boolean) => ({ id, name: id, createdBy: 'usr_001', createdAt: '2026-10-04T09:00:00+03:00', ...(locked ? { locked: true } : {}) });
const office = snapshotOf({
  users: USERS, teams: {},
  settings: {
    roles: { custom: [{ id: 'rol_001', name: 'Keeper', nameAr: 'أمين', rights: ['folder.locked'] }, { id: 'rol_002', name: 'Curator', nameAr: 'مسؤول', rights: ['resources.manage'] }] },
    resourceFolders: [folder('fld_001', true), folder('fld_002', false)],
  } as never,
  clients: {}, stageTemplates: {}, taskTemplates: {}, projects: {}, members: {}, stages: {}, deadlines: {}, conversations: {},
}, 1);
const version = (key: string) => ({ letter: 'A', blobKey: key, mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_001', uploadedAt: '2026-10-04T09:00:00+03:00' });
const file = (id: string, name: string, key: string, folderId?: string) => ({ id, projectId: null, stageId: null, taskId: null, resource: true as const, ...(folderId ? { folderId } : {}), name, versions: [version(key)] });

function setup() {
  const db = fakeFilesDb({
    users: USERS,
    files: {
      fil_070: file('fil_070', 'Secret-policy.pdf', 'resources/upl-a/file', 'fld_001'),
      fil_071: file('fil_071', 'Open.pdf', 'resources/upl-b/file', 'fld_002'),
      fil_072: file('fil_072', 'Root.pdf', 'resources/upl-c/file'),
    },
  });
  const deps = fakeDeps({ db });
  deps.clock.set(NOW);
  const gets: string[] = [];
  const presignGet = deps.files.presignGet.bind(deps.files);
  deps.files.presignGet = async (key, get) => {
    gets.push(key);
    return presignGet(key, get);
  };
  const ctx = (userId: string): ServerCallCtx => ({
    deps, principal: USERS[userId].kind === 'agent' ? { userId, agent: { clientId: 'cli-1' } } : { userId }, office, batch: { storyRefs: new Map(), overviewCalls: 0 }, now: NOW,
  });
  return { ctx, gets, db };
}
const LINK = { variant: 'full', disposition: 'inline' } as const;
const fail = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return null;
  } catch (e) {
    return e as { code: string; message: string; details?: unknown };
  }
};
const swap = (e: { code: string; message: string; details?: unknown } | null, id: string) => (e === null ? null : JSON.parse(JSON.stringify({ code: e.code, message: e.message, details: e.details }).split(id).join('@')));

describe('files.link of a file in a locked folder of Resources', () => {
  it('signs no link for a person without the lock switch, also for an agent and a holder of the manage switch, and answers as for a missing file', async () => {
    const { ctx, gets } = setup();
    for (const person of ['usr_002', 'usr_004', 'usr_005']) {
      const hidden = await fail(() => filesLink({ id: 'fil_070', ...LINK }, ctx(person)));
      const gone = await fail(() => filesLink({ id: 'fil_999', ...LINK }, ctx(person)));
      expect(hidden, person).toMatchObject({ code: 'not_found', message: 'File fil_070 does not exist.' });
      expect(swap(hidden, 'fil_070'), person).toEqual(swap(gone, 'fil_999'));
      expect(JSON.stringify(hidden), person).not.toMatch(/Secret|fld_001/);
    }
    expect(gets).toEqual([]);
  });

  it('signs a link for the Admin, a holder of the lock switch and the agent of a holder', async () => {
    const { ctx, gets } = setup();
    for (const person of ['usr_001', 'usr_003', 'usr_006']) await expect(filesLink({ id: 'fil_070', ...LINK }, ctx(person)), person).resolves.toBeDefined();
    expect(gets).toHaveLength(3);
  });

  it('signs a link for a file in an open folder and a file at the root, for every active person and agent', async () => {
    const { ctx, gets } = setup();
    for (const person of ['usr_001', 'usr_002', 'usr_003', 'usr_004', 'usr_005', 'usr_006']) {
      await expect(filesLink({ id: 'fil_071', ...LINK }, ctx(person)), person).resolves.toBeDefined();
      await expect(filesLink({ id: 'fil_072', ...LINK }, ctx(person)), person).resolves.toBeDefined();
    }
    expect(gets).toHaveLength(12);
  });

  it('signs no link for a person who is turned off', async () => {
    const { ctx, gets } = setup();
    const refused = await fail(() => filesLink({ id: 'fil_072', ...LINK }, ctx('usr_007')));
    expect(refused).toMatchObject({ code: 'unauthenticated' });
    expect(gets).toEqual([]);
  });
});

describe('files.uploadStart into Resources', () => {
  const START = { resources: true, name: 'Code.pdf', size: 10, mimeType: 'application/pdf' } as const;

  it('signs an upload for a holder of the manage switch and for the agent of a holder, under the folder of Resources', async () => {
    const { ctx, db } = setup();
    for (const person of ['usr_001', 'usr_004', 'usr_005']) {
      const started = await filesUploadStart(START, ctx(person));
      expect(started.output.uploadId, person).toMatch(/^upl_/);
    }
    const keys = [...db.intents.values()].map((intent) => intent.key);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key).toMatch(/^resources\/upl-[a-z0-9]+\/file$/);
  });

  it('refuses a person without the manage switch, also the holder of the lock switch alone', async () => {
    const { ctx } = setup();
    for (const person of ['usr_002', 'usr_003', 'usr_006']) {
      const refused = await fail(() => filesUploadStart(START, ctx(person)));
      expect(refused, person).toMatchObject({ code: 'forbidden' });
    }
  });

  it('refuses a project, a chat, a meeting, a stage and a task next to resources', async () => {
    const { ctx } = setup();
    for (const extra of [{ projectId: 'prj_001' }, { conversationId: 'cnv_001' }, { meetingId: 'mtg_001' }, { stageId: 'stg_001' }, { taskId: 'tsk_001' }]) {
      const refused = await fail(() => filesUploadStart({ ...START, ...extra } as never, ctx('usr_001')));
      expect(refused, JSON.stringify(extra)).toMatchObject({ code: 'invalid_input' });
    }
  });

  it('takes the limit of a project file, 500 MB, and refuses a larger file', async () => {
    const { ctx } = setup();
    const refused = await fail(() => filesUploadStart({ ...START, size: 501 * 1024 * 1024 }, ctx('usr_001')));
    expect(refused).toMatchObject({ code: 'invalid_input', details: { reason: 'file_too_large' } });
  });
});
