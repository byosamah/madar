import { describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import type { ServerCallCtx } from '../core/types';
import { snapshotOf } from '../data/officeCache';
import { freshLite } from '../data/lite/testDb';
import { EnterpriseFacts } from '../enterprise/facts';
import { insertIntents } from '../files/intents';
import { fakeDeps } from '../test/fakes/deps';
import type { FakeFiles } from '../test/fakes/files';
import { filesUploadHooks, filesUploadStart } from './files';

/**
 * The storage limit of an enterprise, inside the calls of the files (design 5.9). The start of an upload counts the used bytes, the bytes
 * of the open uploads of the same person and its own file with its small picture. The save of the file (files.upload) counts again inside the lock, because
 * many starts at once each pass the first check. Fake ports and a real SQLite office.
 */

const NOW = new Date('2026-10-04T06:00:00Z');
const user = (id: string, o: Partial<User> = {}): User =>
  ({ id, name: id, email: `${id}@madar.test`, avatarUrl: null, kind: 'human', systemRole: 'member', discipline: 'Architect', active: true, ownerId: null, ...o }) as User;
const USERS = { usr_002: user('usr_002'), usr_003: user('usr_003', { systemRole: 'admin' }) };
const office = snapshotOf({
  users: USERS, teams: {}, settings: {} as never, clients: {}, stageTemplates: {}, taskTemplates: {},
  projects: { prj_001: { id: 'prj_001', leaderId: 'usr_002' } as never }, members: {}, stages: {}, deadlines: {}, conversations: {},
}, 1);

async function setup(limit: number | null) {
  const lite = await freshLite();
  const deps = fakeDeps({ db: lite.db });
  deps.clock.set(NOW);
  const facts = new EnterpriseFacts();
  facts.set({ limits: { people: null, storageBytes: limit } });
  (deps as { enterprise?: EnterpriseFacts }).enterprise = facts;
  const ctxOf = (userId: string) => ({ deps, principal: { userId }, office, batch: { storyRefs: new Map(), overviewCalls: 0 }, get now() { return deps.clock.now(); } }) as ServerCallCtx;
  const start = async (size: number, thumb?: number, actor = 'usr_002') => {
    const { output } = await filesUploadStart(
      { projectId: 'prj_001', name: 'plan.pdf', size, mimeType: 'application/pdf', ...(thumb ? { thumb: { size: thumb, mimeType: 'image/webp' } } : {}) }, ctxOf(actor),
    );
    return output.uploadId;
  };
  const tryStart = (size: number, thumb?: number, actor?: string) => start(size, thumb, actor).then(() => 'ok', (error: { details?: { reason?: string } }) => error.details?.reason ?? 'failed');
  /** The browser put its file (and small picture); the save of files.upload then runs the preflight and the prepare, as runCall does. */
  const save = async (uploadId: string, size: number, thumb?: number, actor = 'usr_002') => {
    const part = uploadId.replace('_', '-');
    const files = deps.files as FakeFiles;
    files.objects.set(`up/${part}/file`, { size, mimeType: 'application/pdf' });
    if (thumb) files.objects.set(`up/${part}/thumb`, { size: thumb, mimeType: 'image/webp' });
    const input = { projectId: 'prj_001', uploadId, name: 'plan.pdf', stageId: null, taskId: null, asCover: false, receivedFromClient: false };
    const hook = { actorId: actor, now: NOW, deps };
    const prepared = await filesUploadHooks.preflight!(input, hook);
    await deps.db.tx('write', async (q) => {
      await filesUploadHooks.prepare!(input, { ...hook, q: q as never }, prepared);
      // The save step of the office adds the bytes of the new version to the running total (server/data/lite/save.ts).
      await q('update enterprise_use set storage_bytes = storage_bytes + ?1 where id = 1', [size]);
    });
  };
  const trySave = (uploadId: string, size: number, thumb?: number, actor?: string) => save(uploadId, size, thumb, actor).then(() => 'ok', (error: { details?: { reason?: string } }) => error.details?.reason ?? 'failed');
  const used = (uploadId: string) => (lite.raw.prepare('select used_at from upload_intents where id = ?').get(uploadId) as { used_at: string | null }).used_at;
  const total = () => (lite.raw.prepare('select storage_bytes from enterprise_use').get() as { storage_bytes: number }).storage_bytes;
  return { lite, deps, facts, start, tryStart, save, trySave, used, total };
}

describe('the storage limit at the save of a file (files.upload)', () => {
  it('lets two starts that each fit pass, and refuses the second save with storage_limit', async () => {
    // Many starts at once each read the room before any intent exists, so each one passes. The lite test database runs one
    // transaction at a time, so the test starts both under a high limit and then sets the real limit.
    const t = await setup(2000);
    const first = await t.start(600);
    const second = await t.start(600);
    t.facts.set({ limits: { people: null, storageBytes: 1000 } });
    expect(await t.trySave(first, 600)).toBe('ok');
    expect(await t.trySave(second, 600)).toBe('storage_limit');
    expect(t.total()).toBe(600);
    // The refused save rolled back: the upload is not used, and no byte was added.
    expect(t.used(second)).toBeNull();
  });

  it('lets the second save pass when the limit rises', async () => {
    const t = await setup(2000);
    const first = await t.start(600);
    const second = await t.start(600);
    t.facts.set({ limits: { people: null, storageBytes: 1000 } });
    await t.save(first, 600);
    expect(await t.trySave(second, 600)).toBe('storage_limit');
    t.facts.set({ limits: { people: null, storageBytes: 1200 } });
    expect(await t.trySave(second, 600)).toBe('ok');
    expect(t.total()).toBe(1200);
  });

  it('counts the small picture of the file at the save', async () => {
    const t = await setup(2000);
    const upload = await t.start(600, 300);
    t.lite.raw.exec('update enterprise_use set storage_bytes = 200');
    t.facts.set({ limits: { people: null, storageBytes: 1000 } });
    // 200 used and 600 for the file is 800, which fits. The small picture of 300 makes 1,100, which does not.
    expect(await t.trySave(upload, 600, 300)).toBe('storage_limit');
    expect(t.used(upload)).toBeNull();
    t.facts.set({ limits: { people: null, storageBytes: 1100 } });
    expect(await t.trySave(upload, 600, 300)).toBe('ok');
  });

  it('never refuses a save with no limit', async () => {
    const t = await setup(null);
    const upload = await t.start(5_000_000);
    expect(await t.trySave(upload, 5_000_000)).toBe('ok');
  });
});

describe('the storage limit at the start of an upload', () => {
  it('counts the small picture of this file', async () => {
    const t = await setup(1000);
    expect(await t.tryStart(600, 500)).toBe('storage_limit');
    expect(await t.tryStart(600, 400)).toBe('ok');
  });

  it('counts the open, unused upload of an earlier start of the same person', async () => {
    const t = await setup(1000);
    expect(await t.tryStart(600)).toBe('ok');
    expect(await t.tryStart(500)).toBe('storage_limit');
    expect(await t.tryStart(400)).toBe('ok');
  });

  it('counts the open uploads of the same person only, so one person cannot block the starts of the others', async () => {
    const t = await setup(1000);
    expect(await t.tryStart(600, undefined, 'usr_002')).toBe('ok');
    // The open upload of usr_002 is no reason to refuse usr_003: only the used bytes and the own open uploads count at the start.
    expect(await t.tryStart(600, undefined, 'usr_003')).toBe('ok');
    // usr_003 now holds 600 open bytes too, and a second start of 500 is above the room of the same person.
    expect(await t.tryStart(500, undefined, 'usr_003')).toBe('storage_limit');
  });

  it('still counts the own open uploads of the person who starts', async () => {
    const t = await setup(1000);
    expect(await t.tryStart(600, undefined, 'usr_002')).toBe('ok');
    expect(await t.tryStart(500, undefined, 'usr_002')).toBe('storage_limit');
    expect(await t.tryStart(400, undefined, 'usr_002')).toBe('ok');
  });

  it('still refuses the save of the second person above the limit, because the lock is the real guard', async () => {
    const t = await setup(1000);
    const first = await t.start(600, undefined, 'usr_002');
    const second = await t.start(600, undefined, 'usr_003');
    expect(await t.trySave(first, 600)).toBe('ok');
    expect(await t.trySave(second, 600, undefined, 'usr_003')).toBe('storage_limit');
    expect(t.total()).toBe(600);
    expect(t.used(second)).toBeNull();
  });

  it('counts an upload once: the used upload is in the running total, and an ended upload counts nothing', async () => {
    const t = await setup(1000);
    const first = await t.start(600);
    await t.save(first, 600);
    // 600 are in the total now. The used upload must not count a second time.
    expect(await t.tryStart(400)).toBe('ok');
    const ended = await setup(1000);
    expect(await ended.tryStart(900)).toBe('ok');
    expect(await ended.tryStart(200)).toBe('storage_limit');
    ended.deps.clock.set(new Date(NOW.getTime() + 3 * 60 * 60 * 1000));
    expect(await ended.tryStart(200)).toBe('ok');
  });

  it('counts the files of a project and not the screenshots of the reports', async () => {
    const t = await setup(1000);
    await insertIntents(t.deps.db, [{
      id: 'upl_shot', actorId: 'usr_002', projectId: null, stagingKey: 'up/upl-shot/file', key: 'feedback/upl-shot/file', thumbKey: null, size: 900,
      mimeType: 'image/png', expiresAt: new Date(NOW.getTime() + 3_600_000), usedAt: null,
    }]);
    expect(await t.tryStart(900)).toBe('ok');
  });

  it('never refuses with no limit or with no facts', async () => {
    const none = await setup(null);
    expect(await none.tryStart(5_000_000)).toBe('ok');
    expect(await none.tryStart(5_000_000)).toBe('ok');
  });
});
