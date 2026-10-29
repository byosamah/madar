import { describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import type { ServerCallCtx } from '../core/types';
import { snapshotOf } from '../data/officeCache';
import { fakeFilesDb } from '../files/fakeFilesDb';
import { fakeDeps } from '../test/fakes/deps';
import { filesLink } from './files';

/**
 * files.link of a file in a locked folder (fbk_074, owner 2026-10-29). The file sits in the locked folder fld_001 of the open project prj_001. A
 * person without the switch "Locked folders" gets the answer of a missing file and no link is signed, also the agent of that person. The Admin, a
 * holder and the agent of a holder get a link. fil_071 sits in the open folder fld_002 and fil_072 at the root: everyone with the view gets a link.
 * usr_002 leads the project, usr_006 is outside the team (and sees it), usr_007 is the agent of usr_006. usr_008 holds the switch by a custom role,
 * usr_009 is the agent of usr_008.
 */
const NOW = new Date('2026-10-04T06:00:00Z');
const user = (id: string, o: Partial<User> = {}): User =>
  ({ id, name: id, email: `${id}@madar.test`, avatarUrl: null, kind: 'human', systemRole: 'member', discipline: 'Architect', active: true, ownerId: null, ...o }) as User;
const USERS: Record<string, User> = {
  usr_001: user('usr_001', { systemRole: 'admin' }), usr_002: user('usr_002'), usr_006: user('usr_006'),
  usr_007: user('usr_007', { kind: 'agent', ownerId: 'usr_006' }), usr_008: user('usr_008', { roleId: 'rol_001' }),
  usr_009: user('usr_009', { kind: 'agent', ownerId: 'usr_008' }),
};
const folder = (id: string, locked: boolean) => ({ id, stageId: null, name: id, createdBy: 'usr_002', createdAt: '2026-10-04T09:00:00+03:00', ...(locked ? { locked: true } : {}) });
const office = snapshotOf({
  users: USERS, teams: {}, settings: { roles: { custom: [{ id: 'rol_001', name: 'Keeper', nameAr: 'أمين', rights: ['folder.locked'] }] } } as never,
  clients: {}, stageTemplates: {}, taskTemplates: {},
  projects: { prj_001: { id: 'prj_001', leaderId: 'usr_002', folders: [folder('fld_001', true), folder('fld_002', false)] } as never },
  members: {}, stages: {}, deadlines: {}, conversations: {},
}, 1);
const version = (key: string) => ({ letter: 'A', blobKey: key, mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_002', uploadedAt: '2026-10-04T09:00:00+03:00' });

function setup() {
  const db = fakeFilesDb({
    users: USERS,
    files: {
      fil_070: { id: 'fil_070', projectId: 'prj_001', stageId: null, taskId: null, folderId: 'fld_001', name: 'Contract.pdf', versions: [version('p/prj-001/upl-a/file')] },
      fil_071: { id: 'fil_071', projectId: 'prj_001', stageId: null, taskId: null, folderId: 'fld_002', name: 'Open.pdf', versions: [version('p/prj-001/upl-b/file')] },
      fil_072: { id: 'fil_072', projectId: 'prj_001', stageId: null, taskId: null, name: 'Root.pdf', versions: [version('p/prj-001/upl-c/file')] },
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
  return { ctx, gets };
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

describe('files.link of a file in a locked folder', () => {
  it('signs no link for a person without the switch, also for the leader and an agent, and answers as for a missing file', async () => {
    const { ctx, gets } = setup();
    for (const person of ['usr_002', 'usr_006', 'usr_007']) {
      const hidden = await fail(() => filesLink({ id: 'fil_070', ...LINK }, ctx(person)));
      const gone = await fail(() => filesLink({ id: 'fil_999', ...LINK }, ctx(person)));
      expect(hidden, person).toMatchObject({ code: 'not_found', message: 'File fil_070 does not exist.' });
      expect(swap(hidden, 'fil_070'), person).toEqual(swap(gone, 'fil_999'));
      expect(JSON.stringify(hidden), person).not.toMatch(/Contract|fld_001/);
    }
    expect(gets).toEqual([]);
  });

  it('signs a link for the Admin, a holder and the agent of a holder', async () => {
    const { ctx, gets } = setup();
    for (const person of ['usr_001', 'usr_008', 'usr_009']) await expect(filesLink({ id: 'fil_070', ...LINK }, ctx(person)), person).resolves.toBeDefined();
    expect(gets).toHaveLength(3);
  });

  it('signs a link for a file in an open folder and a file at the root, for everyone who sees the project', async () => {
    const { ctx, gets } = setup();
    for (const person of ['usr_002', 'usr_006', 'usr_007']) {
      await expect(filesLink({ id: 'fil_071', ...LINK }, ctx(person)), person).resolves.toBeDefined();
      await expect(filesLink({ id: 'fil_072', ...LINK }, ctx(person)), person).resolves.toBeDefined();
    }
    expect(gets).toHaveLength(6);
  });
});
