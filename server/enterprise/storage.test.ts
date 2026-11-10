import { describe, expect, it } from 'vitest';
import type { FileRec } from '../../src/api/contract/entities';
import { emptyState, type State } from '../../src/api/store';
import { makeProject, makeWorld } from '../../src/test/factories';
import { liteSave } from '../data/lite/save';
import { freshLite } from '../data/lite/testDb';
import { importFinish } from '../office/import';
import { nodeWorld } from '../office/test/nodeWorld';
import { EnterpriseFacts } from './facts';
import type { Deps } from '../core/ports';
import { insertIntents, type Intent } from '../files/intents';
import { keysOf } from '../files/keys';
import { ENT_VADO } from './ids';
import { STORAGE_STEP, assertStorageRoom, bytesOfFile, recountStorage, settingsGetHooks, storageUsed } from './storage';
import { officeSteps } from '../office/jobs';

const ENT = 'ent_002';
const version = (letter: string, size: number) => ({ letter, blobKey: `k/${letter}/${size}`, mimeType: 'application/pdf', size, uploadedBy: 'usr_001', uploadedAt: '2026-10-04T09:00:00.000+03:00' });
const file = (id: string, sizes: number[], projectId: string | null = 'prj_001'): FileRec =>
  ({ id, projectId, stageId: null, taskId: null, name: `${id}.pdf`, versions: sizes.map((size, at) => version(String.fromCharCode(65 + at), size)) }) as unknown as FileRec;
const stateWith = (...files: FileRec[]): State => {
  const state = makeWorld();
  for (const one of files) state.files[one.id] = one;
  return state;
};
const clone = (state: State): State => structuredClone(state);

async function saved(initial: State) {
  const { db, raw } = await freshLite();
  await db.tx('write', (q) => liteSave(q, emptyState('2026-10-04'), initial));
  const total = () => (raw.prepare('select storage_bytes from enterprise_use').get() as { storage_bytes: number }).storage_bytes;
  return { db, raw, total, save: (a: State, b: State) => db.tx('write', (q) => liteSave(q, a, b)) };
}

describe('bytesOfFile', () => {
  it('sums the version sizes', () => {
    expect(bytesOfFile(file('fil_001', [100, 50]))).toBe(150);
    expect(bytesOfFile(undefined)).toBe(0);
    expect(bytesOfFile({})).toBe(0);
  });
});

describe('the running total follows every write', () => {
  it('adds a new file, adds a new version, and takes the file away on a delete', async () => {
    const empty = makeWorld();
    const t = await saved(empty);
    expect(t.total()).toBe(0);
    const one = stateWith(file('fil_001', [400]));
    await t.save(empty, one);
    expect(t.total()).toBe(400);
    const two = clone(one);
    two.files.fil_001 = file('fil_001', [400, 300]);
    await t.save(one, two);
    expect(t.total()).toBe(700);
    const three = clone(two);
    delete three.files.fil_001;
    await t.save(two, three);
    expect(t.total()).toBe(0);
  });

  it('takes both files away when a project and its files go together', async () => {
    const before = stateWith(file('fil_001', [100]), file('fil_002', [20, 30]));
    const t = await saved(before);
    expect(t.total()).toBe(150);
    const after = clone(before);
    delete after.files.fil_001;
    delete after.files.fil_002;
    delete after.projects.prj_001;
    await t.save(before, after);
    expect(t.total()).toBe(0);
  });

  it('counts a file with a rename only once: a change that keeps the sizes adds nothing', async () => {
    const before = stateWith(file('fil_001', [100]));
    const t = await saved(before);
    const after = clone(before);
    after.files.fil_001 = { ...file('fil_001', [100]), name: 'renamed.pdf' } as FileRec;
    await t.save(before, after);
    expect(t.total()).toBe(100);
  });
});

describe('recount, the daily step and the import', () => {
  it('repairs a wrong total by recountStorage and by the step storage', async () => {
    const before = stateWith(file('fil_001', [100, 50]), file('fil_002', [7]));
    const t = await saved(before);
    t.raw.exec('update enterprise_use set storage_bytes = 5');
    expect(await storageUsed(t.db)).toBe(5);
    expect(await t.db.tx('write', (q) => recountStorage(q))).toBe(157);
    expect(t.total()).toBe(157);
    t.raw.exec('update enterprise_use set storage_bytes = 9');
    await STORAGE_STEP.run({ db: t.db } as never, new Date());
    expect(t.total()).toBe(157);
  });

  it('puts the step into the first run of the day only', () => {
    expect(officeSteps(new Date('2026-11-08T00:05:00Z')).map((step) => step.name)).toContain('storage');
    expect(officeSteps(new Date('2026-11-08T06:15:00Z')).map((step) => step.name)).not.toContain('storage');
  });

  it('ends an import with the right total', async () => {
    const before = stateWith(file('fil_001', [100, 50]));
    const t = await saved(before);
    t.raw.exec('update enterprise_use set storage_bytes = 0');
    await importFinish(t.db, { counters: [], officeSeq: 0, version: 0, personSeq: [], mailLog: [], usageMonth: [], usageWarnings: [], jobRuns: [], googleConnections: [], googleEvents: [], googleCalendars: [], daftraClients: [], daftraInvoices: [] }, [], new Date());
    expect(t.total()).toBe(150);
  });
});

describe('assertStorageRoom (limit 1000)', () => {
  async function room(used: number, limit: number | null) {
    const { db, raw } = await freshLite();
    raw.exec(`update enterprise_use set storage_bytes = ${used}`);
    const facts = new EnterpriseFacts();
    facts.set({ limits: { people: null, storageBytes: limit } });
    return { db, enterprise: facts, config: { ent: ENT } as Deps['config'] };
  }

  it('passes at the limit and fails one byte above', async () => {
    const deps = await room(700, 1000);
    await expect(assertStorageRoom(deps, 300)).resolves.toBeUndefined();
    await expect(assertStorageRoom(deps, 301)).rejects.toMatchObject({ code: 'conflict', details: { reason: 'storage_limit' } });
  });

  it('never refuses with no limit or with no facts', async () => {
    await expect(assertStorageRoom(await room(999_999, null), 1_000_000)).resolves.toBeUndefined();
    const { db } = await freshLite();
    await expect(assertStorageRoom({ db, enterprise: undefined, config: {} as Deps['config'] }, 1e12)).resolves.toBeUndefined();
  });
});

describe('assertStorageRoom counts the open uploads of the person, but not the report screenshots of any company (review finding 8)', () => {
  const NOW = new Date('2026-10-04T06:00:00Z');
  const intent = (key: string, size: number): Intent => ({
    id: 'upl_001', actorId: 'usr_001', projectId: null, stagingKey: 'up/upl-001/file', key, thumbKey: null, size, mimeType: 'image/png',
    expiresAt: new Date('2026-10-04T08:00:00Z'), usedAt: null,
  });
  async function room(ent: string, key: string, size: number) {
    const { db } = await freshLite();
    await insertIntents(db, [intent(key, size)]);
    const facts = new EnterpriseFacts();
    facts.set({ limits: { people: null, storageBytes: 100 } });
    return { db, enterprise: facts, config: { ent } as Deps['config'] };
  }
  const who = { now: NOW, actorId: 'usr_001' };

  it('leaves the open screenshot of another company out of the count', async () => {
    const deps = await room('ent_002', keysOf('ent_002').screenshotKey('upl_001'), 90);
    await expect(assertStorageRoom(deps, 50, who)).resolves.toBeUndefined();
  });

  it('leaves the open screenshot of ENT_VADO out of the count', async () => {
    const deps = await room(ENT_VADO, keysOf(ENT_VADO).screenshotKey('upl_001'), 90);
    await expect(assertStorageRoom(deps, 50, who)).resolves.toBeUndefined();
  });

  it('still counts an open file upload of the same company', async () => {
    const deps = await room('ent_002', keysOf('ent_002').uploadKey('prj_001', 'upl_001'), 90);
    await expect(assertStorageRoom(deps, 50, who)).rejects.toMatchObject({ code: 'conflict', details: { reason: 'storage_limit' } });
  });
});

describe('through the object', () => {
  async function world(limit: number | null) {
    const state = makeWorld();
    const w = await nodeWorld({ ents: [ENT], seeds: { [ENT]: state } });
    await w.signins([{ id: 'auth-usr_001', email: 'usr_001@madar.test', password_hash: null, email_confirmed: true, banned: false, password_set: true, user_id: 'usr_001' }], ENT);
    const one = w.ents.get(ENT)!;
    await one.stub.setLimits({ ent: ENT, limits: { people: 4, storageBytes: limit } });
    const run = async (name: string, input: unknown) => {
      const out = await one.stub.batch({ ent: ENT, who: { kind: 'browser', authUserId: 'auth-usr_001' }, calls: [{ i: 0, name, input }], overviewCalls: 0, worker: 0 }, w.netFor(ENT));
      if (!out.ok) throw new Error(out.error.message);
      return JSON.parse(out.body).results[0] as { ok: boolean; output?: Record<string, any>; error?: { code: string; details?: { reason?: string } } };
    };
    return { w, one, run };
  }
  const start = (size: number) => ({ projectId: 'prj_001', name: 'Plan.pdf', size, mimeType: 'application/pdf' });

  it('refuses an upload start above the room with storage_limit and allows one that fits', async () => {
    const { one, run } = await world(1000);
    one.raw.exec('update enterprise_use set storage_bytes = 700');
    expect((await run('files.uploadStart', start(300))).ok).toBe(true);
    expect(await run('files.uploadStart', start(301))).toMatchObject({ ok: false, error: { code: 'conflict', details: { reason: 'storage_limit' } } });
  });

  it('never refuses with no storage limit', async () => {
    const { run } = await world(null);
    expect((await run('files.uploadStart', start(5_000_000))).ok).toBe(true);
  });

  it('gives the Admin the use in settings.get, and a Member nothing', async () => {
    const { one, run } = await world(1000);
    one.raw.exec('update enterprise_use set storage_bytes = 123');
    const got = await run('settings.get', {});
    expect(got.output).toMatchObject({ usage: { storage: { used: 123, limit: 1000 }, people: { limit: 4 } } });
    expect(typeof got.output!.usage.people.used).toBe('number');
  });

  it('settingsGetHooks gives nothing without the facts of an enterprise', async () => {
    const { db } = await freshLite();
    expect(await settingsGetHooks.preflight!({}, { actorId: 'usr_001', now: new Date(), deps: { db } as never })).toBeUndefined();
  });
});
