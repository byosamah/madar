import { describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import type { ServerCallCtx } from '../core/types';
import { snapshotOf } from '../data/officeCache';
import { fakeFilesDb } from '../files/fakeFilesDb';
import { fakeDeps } from '../test/fakes/deps';
import { filesLink, filesUploadStart } from './files';

/**
 * The files of a hidden project on the server (hidden projects, owner 2026-10-22): files.link and files.uploadStart. A person who does not
 * see the project gets the answer of a missing file or a missing project, never a refusal, and no link is signed. prj_001 is open;
 * prj_002 is hidden (leader usr_002, team usr_004, chosen usr_005). usr_006 is outside; usr_007 is the agent of usr_006.
 */
const NOW = new Date('2026-10-04T06:00:00Z');
const user = (id: string, o: Partial<User> = {}): User =>
  ({ id, name: id, email: `${id}@madar.test`, avatarUrl: null, kind: 'human', systemRole: 'member', discipline: 'Architect', active: true, ownerId: null, ...o }) as User;
const USERS: Record<string, User> = {
  usr_001: user('usr_001', { systemRole: 'admin' }), usr_002: user('usr_002'), usr_004: user('usr_004'), usr_005: user('usr_005'), usr_006: user('usr_006'),
  usr_007: user('usr_007', { kind: 'agent', ownerId: 'usr_006' }),
};
const office = snapshotOf({
  users: USERS, teams: {}, settings: {} as never, clients: {}, stageTemplates: {}, taskTemplates: {},
  projects: {
    prj_001: { id: 'prj_001', leaderId: 'usr_002' } as never,
    prj_002: { id: 'prj_002', leaderId: 'usr_002', access: { hidden: true, viewerIds: ['usr_005'] } } as never,
  },
  members: { 'prj_002:usr_004': { projectId: 'prj_002', userId: 'usr_004', discipline: 'Architect' } as never }, stages: {}, deadlines: {}, conversations: {},
}, 1);
const version = (o: Record<string, unknown> = {}) => ({
  letter: 'A', blobKey: 'p/prj-002/upl-a/file', mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_002', uploadedAt: '2026-10-04T09:00:00+03:00', ...o,
});

function setup() {
  const db = fakeFilesDb({
    users: USERS,
    files: {
      fil_070: { id: 'fil_070', projectId: 'prj_002', stageId: null, taskId: null, name: 'Secret-plan.pdf', versions: [version()] },
      fil_071: { id: 'fil_071', projectId: 'prj_001', stageId: null, taskId: null, name: 'Open-plan.pdf', versions: [version({ blobKey: 'p/prj-001/upl-b/file' })] },
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

describe('files.link of a file of a hidden project', () => {
  it('signs no link for a person who does not see the project, and answers as for a missing file', async () => {
    const { ctx, gets } = setup();
    for (const person of ['usr_006', 'usr_007']) {
      const hidden = await fail(() => filesLink({ id: 'fil_070', ...LINK }, ctx(person)));
      const gone = await fail(() => filesLink({ id: 'fil_999', ...LINK }, ctx(person)));
      expect(hidden, person).toMatchObject({ code: 'not_found', message: 'File fil_070 does not exist.' });
      expect(swap(hidden, 'fil_070'), person).toEqual(swap(gone, 'fil_999'));
    }
    expect(gets).toEqual([]);
  });

  it('signs a link for the team, the chosen person, the leader and the Admin, and for an open file for the outsider', async () => {
    const { ctx, gets } = setup();
    for (const person of ['usr_004', 'usr_005', 'usr_002', 'usr_001']) await expect(filesLink({ id: 'fil_070', ...LINK }, ctx(person)), person).resolves.toBeDefined();
    await expect(filesLink({ id: 'fil_071', ...LINK }, ctx('usr_006'))).resolves.toBeDefined();
    expect(gets).toHaveLength(5);
  });
});

describe('files.uploadStart into a hidden project', () => {
  const START = { name: 'plan.pdf', size: 100, mimeType: 'application/pdf' };

  it('answers a person who does not see the project as for a missing project', async () => {
    const { ctx } = setup();
    const hidden = await fail(() => filesUploadStart({ ...START, projectId: 'prj_002' }, ctx('usr_006')));
    const gone = await fail(() => filesUploadStart({ ...START, projectId: 'prj_999' }, ctx('usr_006')));
    expect(hidden).toMatchObject({ code: 'not_found' });
    expect(swap(hidden, 'prj_002')).toEqual(swap(gone, 'prj_999'));
  });

  it('lets the team upload, and refuses the chosen person with a refusal that needs the team (they see it, so the refusal is honest)', async () => {
    const { ctx } = setup();
    await expect(filesUploadStart({ ...START, projectId: 'prj_002' }, ctx('usr_004'))).resolves.toBeDefined();
    await expect(filesUploadStart({ ...START, projectId: 'prj_002' }, ctx('usr_005'))).rejects.toMatchObject({ code: 'forbidden' });
  });
});
