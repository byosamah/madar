import { describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import type { ServerCallCtx } from '../core/types';
import { snapshotOf } from '../data/officeCache';
import { fakeFilesDb } from '../files/fakeFilesDb';
import { insertIntents, type Intent } from '../files/intents';
import { fakeDeps } from '../test/fakes/deps';
import { filesLink, filesUploadHooks, filesUploadStart } from './files';

/**
 * The files of a direct chat and of a group chat on the server (owner, 2026-10-19): files.uploadStart, files.link and the preflight
 * of files.upload, on fake ports. A chat file belongs to its chat. Exactly the people who read the messages of the chat sign a link
 * for it. Every refusal answers as for a missing file or a missing chat, with no file name in the text.
 */

const NOW = new Date('2026-10-04T06:00:00Z');

const user = (id: string, o: Partial<User> = {}): User =>
  ({ id, name: id, email: `${id}@madar.test`, avatarUrl: null, kind: 'human', systemRole: 'member', discipline: 'Architect', active: true, ownerId: null, ...o }) as User;

const USERS: Record<string, User> = {
  usr_001: user('usr_001', { systemRole: 'admin' }),
  usr_002: user('usr_002'),
  usr_003: user('usr_003', { active: false }),
  usr_004: user('usr_004'),
  usr_005: user('usr_005'),
  usr_006: user('usr_006'),
  usr_011: user('usr_011', { kind: 'agent', ownerId: 'usr_002' }),
};

const chat = (id: string, kind: 'group' | 'direct' | 'project', memberIds: string[], more: Record<string, unknown> = {}) =>
  ({ id, kind, projectId: kind === 'project' ? 'prj_001' : null, memberIds, createdAt: '2026-10-04T09:00:00+03:00', ...(kind === 'group' ? { name: 'Team', makerId: memberIds[0] } : {}), ...more }) as never;

const office = snapshotOf({
  users: USERS, teams: {}, settings: {} as never, clients: {}, stageTemplates: {}, taskTemplates: {},
  projects: { prj_001: { id: 'prj_001', leaderId: 'usr_002' } as never }, members: {}, stages: {}, deadlines: {},
  conversations: {
    // A group of usr_002, usr_004 and usr_005. usr_006 and the Admin are not in it.
    cnv_001: chat('cnv_001', 'group', ['usr_002', 'usr_004', 'usr_005']),
    // A direct chat of usr_002 and usr_004.
    cnv_002: chat('cnv_002', 'direct', ['usr_002', 'usr_004']),
    cnv_003: chat('cnv_003', 'project', []),
    // A group where the only other person is off.
    cnv_004: chat('cnv_004', 'group', ['usr_002', 'usr_003']),
  },
}, 1);

const version = (o: Record<string, unknown> = {}) => ({
  letter: 'A', blobKey: 'chat/cnv-001/upl-c/file', mimeType: 'image/jpeg', size: 10, uploadedBy: 'usr_002', uploadedAt: '2026-10-04T09:00:00+03:00', ...o,
});

function setup() {
  const db = fakeFilesDb({
    users: USERS,
    files: {
      fil_060: { id: 'fil_060', projectId: null, taskId: null, conversationId: 'cnv_001', name: 'Hidden-photo.jpg', versions: [version({ thumbKey: 'chat/cnv-001/upl-c/thumb' })] },
      // The file of a chat that is gone from the office.
      fil_061: { id: 'fil_061', projectId: null, taskId: null, conversationId: 'cnv_404', name: 'Lost.jpg', versions: [version({ blobKey: 'chat/cnv-404/upl-d/file' })] },
      fil_062: { id: 'fil_062', projectId: null, taskId: null, conversationId: 'cnv_002', name: 'Direct.pdf', versions: [version({ blobKey: 'chat/cnv-002/upl-e/file', mimeType: 'application/pdf' })] },
    },
  });
  const deps = fakeDeps({ db });
  deps.clock.set(NOW);
  const gets: { key: string; disposition: string }[] = [];
  const presignGet = deps.files.presignGet.bind(deps.files);
  deps.files.presignGet = async (key, get) => {
    gets.push({ key, ...get });
    return presignGet(key, get);
  };
  const ctx = (userId: string): ServerCallCtx => ({
    deps, principal: USERS[userId]?.kind === 'agent' ? { userId, agent: { clientId: 'cli-1' } } : { userId }, office, batch: { storyRefs: new Map(), overviewCalls: 0 }, now: NOW,
  });
  return { db, deps, ctx, gets };
}

const START = { name: 'photo.jpg', size: 1200, mimeType: 'image/jpeg', conversationId: 'cnv_001' };
const LINK = { variant: 'full', disposition: 'inline' } as const;

describe('files.uploadStart for a chat', () => {
  it('writes an intent with no project and a final key under chat/<chat>, and signs the file and its small picture', async () => {
    const { db, deps, ctx } = setup();
    const { output } = await filesUploadStart({ ...START, thumb: { size: 300, mimeType: 'image/webp' } }, ctx('usr_002'));
    const part = output.uploadId.replace('_', '-');
    expect(db.intents.get(output.uploadId)).toMatchObject({
      actorId: 'usr_002', projectId: null, stagingKey: `up/${part}/file`, key: `chat/cnv-001/${part}/file`, thumbKey: `chat/cnv-001/${part}/thumb`,
    });
    expect(output.put.url).toContain(`up/${part}/file`);
    expect(output.thumbPut).toBeDefined();
    expect(deps.files.calls.length).toBeGreaterThan(0);
    for (const userId of ['usr_004', 'usr_005']) await expect(filesUploadStart(START, ctx(userId)), userId).resolves.toBeDefined();
    await expect(filesUploadStart({ ...START, conversationId: 'cnv_002' }, ctx('usr_004'))).resolves.toBeDefined();
  });

  it('refuses a person outside the chat, the Admin who is not a member, and an agent, as for a chat that does not exist', async () => {
    for (const [userId, conversationId] of [['usr_006', 'cnv_001'], ['usr_001', 'cnv_001'], ['usr_001', 'cnv_002'], ['usr_005', 'cnv_002'], ['usr_011', 'cnv_001'], ['usr_002', 'cnv_404']] as const) {
      const { db, deps, ctx } = setup();
      await expect(filesUploadStart({ ...START, conversationId }, ctx(userId)), `${userId} ${conversationId}`)
        .rejects.toMatchObject({ code: 'not_found', message: `Conversation ${conversationId} does not exist.` });
      expect([deps.files.calls, db.intents.size], `${userId} ${conversationId}`).toEqual([[], 0]);
    }
  });

  it('refuses a project chat, a closed group, a stage, a task and the mix of a project and a chat, before it signs', async () => {
    const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
      ['usr_002', { conversationId: 'cnv_003' }, { code: 'invalid_input' }],
      ['usr_002', { conversationId: 'cnv_004' }, { code: 'forbidden', details: { reason: 'person_left' } }],
      ['usr_002', { stageId: 'stg_001' }, { code: 'invalid_input', details: { reason: 'file_chat' } }],
      ['usr_002', { taskId: 'tsk_001' }, { code: 'invalid_input', details: { reason: 'file_chat' } }],
      ['usr_002', { projectId: 'prj_001' }, { code: 'invalid_input' }],
    ];
    for (const [userId, more, error] of cases) {
      const { db, deps, ctx } = setup();
      await expect(filesUploadStart({ ...START, ...more } as never, ctx(userId)), JSON.stringify(more)).rejects.toMatchObject(error);
      expect([deps.files.calls, db.intents.size]).toEqual([[], 0]);
    }
  });

  it('refuses a person who is off before it reads the chat', async () => {
    const { ctx } = setup();
    await expect(filesUploadStart({ ...START, conversationId: 'cnv_004' }, ctx('usr_003'))).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('refuses a file over the limit of the active store', async () => {
    const { ctx } = setup();
    await expect(filesUploadStart({ ...START, size: 60 * 1024 * 1024 }, ctx('usr_002'))).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'file_too_large' } });
  });
});

describe('files.link for a chat file', () => {
  it('signs for each member of the chat, for the file and for its small picture', async () => {
    for (const userId of ['usr_002', 'usr_004', 'usr_005']) {
      const { ctx, gets } = setup();
      await expect(filesLink({ id: 'fil_060', ...LINK }, ctx(userId)), userId).resolves.toMatchObject({ output: { name: 'Hidden-photo.jpg' } });
      await expect(filesLink({ id: 'fil_060', variant: 'thumb', disposition: 'inline' }, ctx(userId)), userId).resolves.toBeDefined();
      expect(gets.map((g) => g.key)).toEqual(['chat/cnv-001/upl-c/file', 'chat/cnv-001/upl-c/thumb']);
    }
    const { ctx } = setup();
    await expect(filesLink({ id: 'fil_062', ...LINK }, ctx('usr_004'))).resolves.toMatchObject({ output: { name: 'Direct.pdf' } });
  });

  it('answers not_found, with no file name, to a person outside the chat, the Admin who is not a member, and an agent, and signs nothing', async () => {
    for (const [userId, id] of [['usr_006', 'fil_060'], ['usr_001', 'fil_060'], ['usr_001', 'fil_062'], ['usr_005', 'fil_062'], ['usr_011', 'fil_060']] as const) {
      const { ctx, gets } = setup();
      for (const variant of ['full', 'thumb'] as const) {
        const refused = await filesLink({ id, variant, disposition: 'attachment' }, ctx(userId)).then(() => null, (error: { code: string; message: string; details?: unknown }) => error);
        expect(refused, `${userId} ${id} ${variant}`).toMatchObject({ code: 'not_found', message: `File ${id} does not exist.` });
        expect(JSON.stringify(refused)).not.toMatch(/Hidden|Direct\.pdf/);
      }
      expect(gets, `${userId} ${id}`).toEqual([]);
    }
  });

  it('answers not_found to everyone, the Admin too, for a file whose chat is gone', async () => {
    for (const userId of ['usr_001', 'usr_002']) {
      const { ctx, gets } = setup();
      await expect(filesLink({ id: 'fil_061', ...LINK }, ctx(userId)), userId).rejects.toMatchObject({ code: 'not_found', message: 'File fil_061 does not exist.' });
      expect(gets).toEqual([]);
    }
  });

  it('refuses a person who is off, as it does for any file', async () => {
    const { ctx } = setup();
    await expect(filesLink({ id: 'fil_060', ...LINK }, ctx('usr_003'))).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

describe('the preflight of files.upload for a chat', () => {
  const intent = (o: Partial<Intent> = {}): Intent => ({
    id: 'upl_a', actorId: 'usr_002', projectId: null, stagingKey: 'up/upl-a/file', key: 'chat/cnv-001/upl-a/file', thumbKey: null, size: 12,
    mimeType: 'image/jpeg', expiresAt: new Date('2026-10-04T08:00:00Z'), usedAt: null, ...o,
  });
  const upload = { uploadId: 'upl_a', name: 'photo.jpg', stageId: null, taskId: null, asCover: false, receivedFromClient: false, conversationId: 'cnv_001' };
  const run = async (stored: Intent, input: Record<string, unknown>) => {
    const s = setup();
    await insertIntents(s.db, [stored]);
    s.deps.files.objects.set('up/upl-a/file', { size: 12, mimeType: 'image/jpeg' });
    return filesUploadHooks.preflight!(input, { actorId: 'usr_002', now: NOW, deps: s.deps });
  };

  it('takes a chat intent only for the chat that the call names', async () => {
    await expect(run(intent(), upload)).resolves.toMatchObject({ blobKey: 'chat/cnv-001/upl-a/file' });
    await expect(run(intent(), { ...upload, conversationId: 'cnv_002' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('never takes a chat intent for a project, an office task or a screenshot, and never takes those for a chat', async () => {
    const { conversationId: _chat, ...plain } = upload;
    await expect(run(intent(), { ...plain, projectId: 'prj_001' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(run(intent(), { ...plain, taskId: 'tsk_050' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(run(intent({ projectId: 'prj_001', key: 'prj-001/upl-a/file' }), upload)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(run(intent({ key: 'office/tsk-050/upl-a/file' }), upload)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(run(intent({ key: 'feedback/upl-a/file' }), upload)).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('takes the intent of the same person only', async () => {
    await expect(run(intent({ actorId: 'usr_004' }), upload)).rejects.toMatchObject({ code: 'not_found' });
  });
});
