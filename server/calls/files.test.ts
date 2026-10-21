import { describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import { MAX_FILE_BYTES } from '../../src/api/contract/entities';
import { EFFECTS_OF } from '../core/effects';
import type { ServerCallCtx } from '../core/types';
import { snapshotOf } from '../data/officeCache';
import { fakeFilesDb } from '../files/fakeFilesDb';
import { insertIntents, type Intent } from '../files/intents';
import { fakeDeps, type FakeDeps } from '../test/fakes/deps';
import { filesLink, filesUploadHooks, filesUploadStart, projectsDeleteHooks } from './files';

/**
 * files.uploadStart, files.link and the server hooks of files.upload and projects.delete (plan 5.2; plan 2b, points 1 and 7;
 * proof.md, Z0a item 6; task F2), on fake ports and the fake files database. The same calls run on the local stack in
 * server/it/files.it.test.ts.
 */

const NOW = new Date('2026-10-04T06:00:00Z');
const MB = 1024 * 1024;

const user = (id: string, o: Partial<User> = {}): User =>
  ({ id, name: id, email: `${id}@madar.test`, avatarUrl: null, kind: 'human', systemRole: 'member', discipline: 'Architect', active: true, ownerId: null, ...o }) as User;

const USERS: Record<string, User> = {
  usr_001: user('usr_001', { systemRole: 'admin' }),
  usr_002: user('usr_002'),
  usr_003: user('usr_003', { active: false }),
  usr_004: user('usr_004'),
  usr_005: user('usr_005'),
  usr_009: user('usr_009', { kind: 'agent', ownerId: 'usr_001' }),
  usr_010: user('usr_010', { kind: 'agent', ownerId: 'usr_003' }),
};

const office = snapshotOf({
  users: USERS, teams: {}, settings: {} as never, clients: {}, stageTemplates: {}, taskTemplates: {},
  projects: { prj_001: { id: 'prj_001', leaderId: 'usr_002' } as never, prj_002: { id: 'prj_002', leaderId: 'usr_004' } as never },
  members: {}, stages: { stg_001: { id: 'stg_001', projectId: 'prj_001' } as never, stg_009: { id: 'stg_009', projectId: 'prj_002' } as never },
  deadlines: {}, conversations: {},
}, 1);

const version = (letter: string, o: Record<string, unknown> = {}) => ({
  letter, blobKey: `prj-001/upl-${letter.toLowerCase()}/file`, mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_002', uploadedAt: '2026-10-04T09:00:00+03:00', ...o,
});

function setup(o: { kind?: 'supabase' | 'r2' } = {}) {
  const db = fakeFilesDb({
    users: USERS,
    tasks: {
      tsk_001: { projectId: 'prj_001' }, tsk_009: { projectId: 'prj_002' },
      // An office task (owner, 2026-10-06): usr_004 made it, usr_002 leads it. usr_005 is on no office task.
      tsk_050: { id: 'tsk_050', projectId: null, createdBy: 'usr_004', ownerId: 'usr_002', helperIds: [] },
    },
    files: {
      fil_050: { id: 'fil_050', projectId: null, taskId: 'tsk_050', name: 'Licence.pdf', versions: [version('A', { blobKey: 'office/tsk-050/upl-o/file' })] },
      // A file whose office task is gone.
      fil_051: { id: 'fil_051', projectId: null, taskId: 'tsk_404', name: 'Old.pdf', versions: [version('A', { blobKey: 'office/tsk-404/upl-p/file' })] },
      fil_001: { id: 'fil_001', projectId: 'prj_001', name: 'مخطط الطابق الأرضي.pdf', versions: [version('A'), version('B', { thumbKey: 'prj-001/upl-b/thumb', size: 20 })] },
      fil_002: { id: 'fil_002', projectId: 'prj_001', name: 'page.html', versions: [version('A', { mimeType: 'text/html', blobKey: 'prj-001/upl-h/file' })] },
    },
  });
  const deps = fakeDeps({ db, config: o.kind === 'r2' ? { fileStore: 'r2', limits: { maxFileBytes: 250 * MB, filesTotalBytes: 10 * 1024 * MB } } : {} });
  deps.clock.set(NOW);
  const gets: { key: string; disposition: string; filename: string; mimeType: string }[] = [];
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

const START = { projectId: 'prj_001', name: 'plan.pdf', size: 1200, mimeType: 'application/pdf' };

describe('files.uploadStart', () => {
  it('signs a PUT for the staging key, and writes an intent with the final key and the link life of Storage (2 hours)', async () => {
    const { db, deps, ctx } = setup();
    const { output } = await filesUploadStart({ ...START, mimeType: 'Application/PDF' }, ctx('usr_002'));
    expect(output.uploadId).toMatch(/^upl_[a-z2-7]{22}$/);
    const part = output.uploadId.replace('_', '-');
    expect(output.put.url).toBe(`https://files.test/put/up/${part}/file`);
    expect(output.thumbPut).toBeUndefined();
    expect(db.intents.get(output.uploadId)).toEqual({
      id: output.uploadId, actorId: 'usr_002', projectId: 'prj_001', stagingKey: `up/${part}/file`, key: `prj-001/${part}/file`, thumbKey: null,
      size: 1200, mimeType: 'application/pdf', expiresAt: new Date('2026-10-04T08:00:00Z'), usedAt: null,
    });
    expect(deps.files.calls).toEqual([{ op: 'presignPut', key: `up/${part}/file` }]);
  });

  it('signs a second PUT for a small picture, and lets an intent on R2 live for the 10-minute link plus 60 minutes', async () => {
    const { db, ctx } = setup({ kind: 'r2' });
    const { output } = await filesUploadStart({ ...START, thumb: { size: 300, mimeType: 'image/webp' } }, ctx('usr_009'));
    const part = output.uploadId.replace('_', '-');
    expect(output.thumbPut?.url).toBe(`https://files.test/put/up/${part}/thumb`);
    expect(db.intents.get(output.uploadId)).toMatchObject({ actorId: 'usr_009', thumbKey: `prj-001/${part}/thumb`, expiresAt: new Date('2026-10-04T07:10:00Z') });
  });

  it('takes a JPEG small picture as a WebP one: it signs the PUT with the JPEG type, and the preflight keeps it (performance audit BGR-M1)', async () => {
    // Safari and the browsers of an iPhone or iPad cannot write WebP, so the screens send a JPEG small picture of a JPEG photo.
    const { deps, ctx } = setup();
    const { output } = await filesUploadStart({ ...START, name: 'IMG_0412.jpg', mimeType: 'image/jpeg', thumb: { size: 300, mimeType: 'image/jpeg' } }, ctx('usr_002'));
    const part = output.uploadId.replace('_', '-');
    expect(output.thumbPut).toMatchObject({ url: `https://files.test/put/up/${part}/thumb`, headers: { 'Content-Type': 'image/jpeg' } });
    deps.files.objects.set(`up/${part}/file`, { size: 1200, mimeType: 'image/jpeg' });
    deps.files.objects.set(`up/${part}/thumb`, { size: 300, mimeType: 'image/jpeg' });
    const upload = { projectId: 'prj_001', uploadId: output.uploadId, name: 'IMG_0412.jpg', stageId: null, taskId: null, asCover: false, receivedFromClient: false };
    expect(await filesUploadHooks.preflight!(upload, { actorId: 'usr_002', now: NOW, deps })).toEqual({
      blobKey: `prj-001/${part}/file`, size: 1200, mimeType: 'image/jpeg', thumbKey: `prj-001/${part}/thumb`,
    });
  });

  it('refuses an inactive person and an agent whose person is off before it signs or writes anything (plan 2b, point 7)', async () => {
    for (const userId of ['usr_003', 'usr_010']) {
      const { db, deps, ctx } = setup();
      await expect(filesUploadStart(START, ctx(userId))).rejects.toMatchObject({ code: 'unauthenticated', details: { reason: 'account_off' } });
      expect([deps.files.calls, db.statements, db.intents.size]).toEqual([[], [], 0]);
    }
  });

  it('refuses a person who may not post in the project, a missing project, a stage or a task of another project', async () => {
    const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
      ['usr_004', {}, { code: 'forbidden', details: { action: 'file.upload' } }],
      ['usr_002', { projectId: 'prj_404' }, { code: 'not_found' }],
      ['usr_002', { stageId: 'stg_009' }, { code: 'invalid_input', details: { fields: ['stageId'] } }],
      ['usr_002', { taskId: 'tsk_009' }, { code: 'invalid_input', details: { fields: ['taskId'] } }],
      ['usr_002', { taskId: 'tsk_404' }, { code: 'invalid_input', details: { fields: ['taskId'] } }],
    ];
    for (const [userId, more, error] of cases) {
      const { db, deps, ctx } = setup();
      await expect(filesUploadStart({ ...START, ...more } as never, ctx(userId)), JSON.stringify(more)).rejects.toMatchObject(error);
      expect([deps.files.calls, db.intents.size]).toEqual([[], 0]);
    }
    const { ctx } = setup();
    await expect(filesUploadStart({ ...START, stageId: 'stg_001', taskId: 'tsk_001' }, ctx('usr_002'))).resolves.toBeDefined();
  });

  it('refuses a file over the limit of the active store with file_too_large and that limit', async () => {
    const { db, ctx } = setup();
    await expect(filesUploadStart({ ...START, size: 50 * MB + 1 }, ctx('usr_002'))).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['size'], reason: 'file_too_large', limit: 50 * MB },
    });
    await expect(filesUploadStart({ ...START, size: 50 * MB }, ctx('usr_002'))).resolves.toBeDefined();
    const r2 = setup({ kind: 'r2' });
    await expect(filesUploadStart({ ...START, size: MAX_FILE_BYTES + 1 }, r2.ctx('usr_002'))).rejects.toMatchObject({ details: { reason: 'file_too_large', limit: MAX_FILE_BYTES } });
    expect(db.intents.size).toBe(1);
  });

  it('refuses a small picture that is not an inline-safe picture', async () => {
    const { ctx } = setup();
    await expect(filesUploadStart({ ...START, thumb: { size: 30, mimeType: 'image/svg+xml' } }, ctx('usr_002'))).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['thumb'] } });
  });
});

describe('files.link', () => {
  it('signs a download link for the newest version, with the file name, type and size', async () => {
    const { ctx, gets } = setup();
    const { output } = await filesLink({ id: 'fil_001', variant: 'full', disposition: 'attachment' }, ctx('usr_004'));
    expect(output).toEqual({ url: 'https://files.test/get/prj-001/upl-b/file?disposition=attachment', expiresAt: '2099-01-01T00:00:00.000Z', name: 'مخطط الطابق الأرضي.pdf', mimeType: 'application/pdf', size: 20 });
    expect(gets).toEqual([{ key: 'prj-001/upl-b/file', disposition: 'attachment', filename: 'مخطط الطابق الأرضي.pdf', mimeType: 'application/pdf' }]);
  });

  it('signs a version by its letter, and the small picture when the version has one', async () => {
    const { ctx, gets } = setup();
    expect((await filesLink({ id: 'fil_001', letter: 'A', variant: 'full', disposition: 'inline' }, ctx('usr_009'))).output.size).toBe(10);
    await filesLink({ id: 'fil_001', letter: 'B', variant: 'thumb', disposition: 'inline' }, ctx('usr_002'));
    await filesLink({ id: 'fil_001', letter: 'A', variant: 'thumb', disposition: 'inline' }, ctx('usr_002'));
    expect(gets.map((g) => g.key)).toEqual(['prj-001/upl-a/file', 'prj-001/upl-b/thumb', 'prj-001/upl-a/file']);
    expect(gets[1]).toMatchObject({ disposition: 'inline', mimeType: 'image/webp' });
  });

  it('passes the recorded type to the store, which keeps an HTML file a download', async () => {
    const { ctx, gets } = setup();
    await filesLink({ id: 'fil_002', variant: 'full', disposition: 'inline' }, ctx('usr_002'));
    expect(gets).toEqual([{ key: 'prj-001/upl-h/file', disposition: 'inline', filename: 'page.html', mimeType: 'text/html' }]);
  });

  it('refuses an inactive person and an agent whose person is off before it reads the file or signs (plan 2b, point 7)', async () => {
    for (const userId of ['usr_003', 'usr_010']) {
      const { db, gets, ctx } = setup();
      await expect(filesLink({ id: 'fil_001', variant: 'full', disposition: 'inline' }, ctx(userId))).rejects.toMatchObject({ code: 'unauthenticated', details: { reason: 'account_off' } });
      expect([db.statements, gets]).toEqual([[], []]);
    }
  });

  it('refuses a missing file and a missing version', async () => {
    const { ctx, gets } = setup();
    await expect(filesLink({ id: 'fil_404', variant: 'full', disposition: 'inline' }, ctx('usr_002'))).rejects.toMatchObject({ code: 'not_found' });
    await expect(filesLink({ id: 'fil_001', letter: 'Z', variant: 'full', disposition: 'inline' }, ctx('usr_002'))).rejects.toMatchObject({ code: 'not_found' });
    expect(gets).toEqual([]);
  });
});

describe('the server hooks of files.upload', () => {
  const intent = (o: Partial<Intent> = {}): Intent => ({
    id: 'upl_a', actorId: 'usr_002', projectId: 'prj_001', stagingKey: 'up/upl-a/file', key: 'prj-001/upl-a/file', thumbKey: null,
    size: 12, mimeType: 'application/pdf', expiresAt: new Date('2026-10-04T08:00:00Z'), usedAt: null, ...o,
  });
  const UPLOAD = { projectId: 'prj_001', uploadId: 'upl_a', name: 'plan.pdf', stageId: null, taskId: null, asCover: false, receivedFromClient: false };
  const hookCtx = (deps: FakeDeps, actorId = 'usr_002') => ({ actorId, now: NOW, deps });

  async function withIntent(o: Partial<Intent> = {}) {
    const s = setup();
    await insertIntents(s.db, [intent(o)]);
    // A new intent is never used: the insert writes no used_at.
    if (o.usedAt) s.db.intents.get('upl_a')!.usedAt = o.usedAt;
    return s;
  }

  it('the preflight checks and copies the object, and gives run() the final key, the size, the declared type and the thumb', async () => {
    const { deps } = await withIntent({ thumbKey: 'prj-001/upl-a/thumb' });
    deps.files.objects.set('up/upl-a/file', { size: 12, mimeType: 'application/pdf' });
    deps.files.objects.set('up/upl-a/thumb', { size: 300, mimeType: 'image/webp' });
    expect(await filesUploadHooks.preflight!(UPLOAD, hookCtx(deps))).toEqual({ blobKey: 'prj-001/upl-a/file', size: 12, mimeType: 'application/pdf', thumbKey: 'prj-001/upl-a/thumb' });
    expect([...deps.files.objects.keys()].sort()).toEqual(['prj-001/upl-a/file', 'prj-001/upl-a/thumb']);
  });

  it('the preflight refuses another actor, another project and an intent past expires_at, used or not, before any store call', async () => {
    const cases: [Partial<Intent>, string, string][] = [
      [{}, 'usr_004', 'not_found'],
      [{ projectId: 'prj_002' }, 'usr_002', 'invalid_input'],
      [{ expiresAt: NOW }, 'usr_002', 'invalid_input'],
      [{ usedAt: NOW }, 'usr_004', 'not_found'],
      [{ usedAt: NOW, projectId: 'prj_002' }, 'usr_002', 'invalid_input'],
      [{ usedAt: NOW, expiresAt: NOW }, 'usr_002', 'invalid_input'],
    ];
    for (const [o, actorId, code] of cases) {
      const { deps } = await withIntent(o);
      deps.files.objects.set('up/upl-a/file', { size: 12, mimeType: 'application/pdf' });
      await expect(filesUploadHooks.preflight!(UPLOAD, hookCtx(deps, actorId)), JSON.stringify(o)).rejects.toMatchObject({ code });
      expect(deps.files.calls).toEqual([]);
    }
  });

  it('the preflight refuses an object whose type differs from the intent, and removes it', async () => {
    const { deps } = await withIntent();
    deps.files.objects.set('up/upl-a/file', { size: 12, mimeType: 'application/octet-stream' });
    await expect(filesUploadHooks.preflight!(UPLOAD, hookCtx(deps))).rejects.toMatchObject({ code: 'invalid_input' });
    expect(deps.files.objects.size).toBe(0);
  });

  it('the preflight lets a used intent of the same actor pass with no store call, so runCall replays the stored answer; prepare refuses it', async () => {
    const { db, deps } = await withIntent({ usedAt: NOW, thumbKey: 'prj-001/upl-a/thumb' });
    // A late second PUT sits on the staging key: the preflight must not head, copy or remove anything.
    deps.files.objects.set('up/upl-a/file', { size: 12, mimeType: 'application/pdf' });
    deps.files.objects.set('prj-001/upl-a/file', { size: 12, mimeType: 'application/pdf' });
    const prepared = await filesUploadHooks.preflight!(UPLOAD, hookCtx(deps));
    expect(prepared).toEqual({ blobKey: 'prj-001/upl-a/file', size: 12, mimeType: 'application/pdf', thumbKey: 'prj-001/upl-a/thumb' });
    expect(deps.files.calls).toEqual([]);
    expect(deps.files.objects.size).toBe(2);
    // With no stored answer for the key, the call never makes a second version.
    await expect(filesUploadHooks.prepare!(UPLOAD, { ...hookCtx(deps), q: db.q }, prepared)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('prepare marks the intent used inside the lock, once', async () => {
    const { db, deps } = await withIntent();
    const prepared = { blobKey: 'prj-001/upl-a/file', size: 12, mimeType: 'application/pdf' };
    expect(await filesUploadHooks.prepare!(UPLOAD, { ...hookCtx(deps), q: db.q }, prepared)).toEqual(prepared);
    expect(db.intents.get('upl_a')?.usedAt).toEqual(NOW);
    await expect(filesUploadHooks.prepare!(UPLOAD, { ...hookCtx(deps), q: db.q }, prepared)).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('the prepare hook of projects.delete', () => {
  it('lists the stored keys of the project inside the lock, and hands them to the r2.delete row of the same transaction', async () => {
    const { db, deps } = setup();
    const prepared = await projectsDeleteHooks.prepare!({ id: 'prj_001', confirm: true }, { actorId: 'usr_001', now: NOW, deps, q: db.q }, undefined);
    expect(prepared.blobKeys.sort()).toEqual(['prj-001/upl-a/file', 'prj-001/upl-b/file', 'prj-001/upl-b/thumb', 'prj-001/upl-h/file']);
    const [producer] = EFFECTS_OF['projects.delete'] ?? [];
    expect(await producer({ deleted: true }, {} as never, db.q)).toEqual([{ kind: 'r2.delete', payload: { keys: prepared.blobKeys } }]);
  });
});

describe('the files of an office task (owner, 2026-10-06)', () => {
  const OFFICE_START = { name: 'licence.pdf', size: 1200, mimeType: 'application/pdf', taskId: 'tsk_050' };

  it('files.uploadStart writes an intent with no project and a final key under office/<task>', async () => {
    const { db, ctx } = setup();
    const { output } = await filesUploadStart({ ...OFFICE_START, thumb: { size: 300, mimeType: 'image/webp' } }, ctx('usr_002'));
    const part = output.uploadId.replace('_', '-');
    expect(db.intents.get(output.uploadId)).toMatchObject({
      projectId: null, stagingKey: `up/${part}/file`, key: `office/tsk-050/${part}/file`, thumbKey: `office/tsk-050/${part}/thumb`,
    });
    for (const userId of ['usr_004', 'usr_001', 'usr_009']) await expect(filesUploadStart(OFFICE_START, ctx(userId)), userId).resolves.toBeDefined();
  });

  it('files.uploadStart refuses a person who does not see the task, a project task, a missing task and a stage, before it signs', async () => {
    const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
      ['usr_005', {}, { code: 'not_found' }],
      ['usr_002', { taskId: 'tsk_404' }, { code: 'not_found' }],
      ['usr_002', { taskId: 'tsk_001' }, { code: 'invalid_input', details: { reason: 'office_needs_task' } }],
      ['usr_002', { taskId: undefined }, { code: 'invalid_input', details: { reason: 'office_needs_task' } }],
      ['usr_002', { stageId: 'stg_001' }, { code: 'invalid_input', details: { reason: 'office_no_stage' } }],
    ];
    for (const [userId, more, error] of cases) {
      const { db, deps, ctx } = setup();
      await expect(filesUploadStart({ ...OFFICE_START, ...more } as never, ctx(userId)), JSON.stringify(more)).rejects.toMatchObject(error);
      expect([deps.files.calls, db.intents.size]).toEqual([[], 0]);
    }
  });

  it('files.link signs only for the people of the task and the Admin; a file whose task is gone, for the Admin only', async () => {
    for (const userId of ['usr_002', 'usr_004', 'usr_001', 'usr_009']) {
      const { ctx } = setup();
      await expect(filesLink({ id: 'fil_050', variant: 'full', disposition: 'inline' }, ctx(userId)), userId).resolves.toMatchObject({ output: { name: 'Licence.pdf' } });
    }
    const { ctx, gets } = setup();
    await expect(filesLink({ id: 'fil_050', variant: 'full', disposition: 'inline' }, ctx('usr_005'))).rejects.toMatchObject({ code: 'not_found', message: 'File fil_050 does not exist.' });
    await expect(filesLink({ id: 'fil_051', variant: 'full', disposition: 'inline' }, ctx('usr_004'))).rejects.toMatchObject({ code: 'not_found', message: 'File fil_051 does not exist.' });
    expect(gets).toEqual([]);
    await expect(filesLink({ id: 'fil_051', variant: 'full', disposition: 'inline' }, ctx('usr_001'))).resolves.toBeDefined();
  });

  it('the preflight of files.upload takes an office intent only for its own task, and never for a project', async () => {
    const office: Intent = {
      id: 'upl_a', actorId: 'usr_002', projectId: null, stagingKey: 'up/upl-a/file', key: 'office/tsk-050/upl-a/file', thumbKey: null, size: 12,
      mimeType: 'application/pdf', expiresAt: new Date('2026-10-04T08:00:00Z'), usedAt: null,
    };
    const upload = { uploadId: 'upl_a', name: 'licence.pdf', stageId: null, taskId: 'tsk_050', asCover: false, receivedFromClient: false };
    const run = async (intent: Intent, input: Record<string, unknown>) => {
      const s = setup();
      await insertIntents(s.db, [intent]);
      s.deps.files.objects.set('up/upl-a/file', { size: 12, mimeType: 'application/pdf' });
      return filesUploadHooks.preflight!(input, { actorId: 'usr_002', now: NOW, deps: s.deps });
    };
    await expect(run(office, upload)).resolves.toMatchObject({ blobKey: 'office/tsk-050/upl-a/file' });
    await expect(run(office, { ...upload, taskId: 'tsk_051' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(run(office, { ...upload, projectId: 'prj_001' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(run({ ...office, projectId: 'prj_001', key: 'prj-001/upl-a/file' }, upload)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(run({ ...office, key: 'feedback/upl-a/file' }, upload)).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

