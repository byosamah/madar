import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it } from 'vitest';
import { emptyState } from '../../src/api/store';
import type { After } from '../core/after';
import type { Db, Query } from '../core/ports';
import { OFFICE_COLLECTIONS } from '../core/types';
import { META_COUNTERS_SQL, META_SQL, OFFICE_DELETES_SQL, OFFICE_ROWS_SQL, createOfficeCache, userIdOfAuth, type OfficeCache } from './officeCache';
import {
  COPY_DELTA_ROWS, COPY_MAX_AGE_MS, COPY_ROW, GONE_ROW, OFFICE_COLD_SQL, OFFICE_COPY_FORMAT, OFFICE_COPY_UPSERT_SQL, decodeCopy, encodeCopy, type CopyTables,
} from './officeCopy';
import { tableOf } from './tables';

/**
 * The compressed office copy (tsk_496) against a fake of the statements the cache sends. The fake follows the rules of the real
 * SQL (the copy is used only when it is not newer than the database and not too old; the upsert keeps the newest version).
 * server/it/officeCopy.it.test.ts runs the real SQL on Postgres.
 */

type Row = { c: string; id: string; ord: number; doc: Record<string, unknown>; chg: number; auth: string | null };
type Copy = { version: number; at: number; rows: number; body: string };
const DAY = 24 * 60 * 60 * 1000;

function fakeOffice() {
  const db = {
    version: 0,
    now: new Date('2026-11-01T06:00:00Z').getTime(),
    rows: [] as Row[],
    deletes: [] as { tbl: string; id: string; chg: number }[],
    ord: 0,
    own: false,
    copy: undefined as Copy | undefined,
    /** The version and the "at" that the fake gives for a copy it holds, whatever the SQL filter says (to test the checks of the cache). */
    ignoreFilter: false,
    asked: [] as { sql: string; values?: unknown[]; inTx: boolean }[],
    save(write: { c: string; doc: Record<string, unknown>; auth?: string }[], remove: { c: string; id: string }[] = []) {
      db.version += 1;
      for (const gone of remove) {
        db.rows = db.rows.filter((row) => !(row.c === gone.c && row.id === gone.id));
        db.deletes.push({ tbl: tableOf(gone.c as never).table, id: gone.id, chg: db.version });
      }
      for (const item of write) {
        const id = tableOf(item.c as never).key(item.doc);
        const known = db.rows.find((row) => row.c === item.c && row.id === id);
        if (known) Object.assign(known, { doc: item.doc, chg: db.version, auth: item.auth ?? known.auth });
        else db.rows.push({ c: item.c, id, ord: (db.ord += 1), doc: item.doc, chg: db.version, auth: item.auth ?? null });
      }
    },
  };
  const plain = (row: Row) => ({ c: row.c, id: row.id, ord: String(row.ord), doc: structuredClone(row.doc), auth: row.auth, snap_at: null, body: null });
  const answer = async <R,>(sql: string, values: unknown[] | undefined, inTx: boolean): Promise<R[]> => {
    db.asked.push({ sql, values, inTx });
    if (sql === META_SQL) return [{ version: String(db.version), at: new Date(db.now), own: db.own }] as R[];
    if (sql === META_COUNTERS_SQL) return [{ version: String(db.version), at: new Date(db.now), own: db.own, counters: { tsk: 7 } }] as R[];
    if (sql === OFFICE_ROWS_SQL) return db.rows.filter((row) => row.chg > Number(values![0])).map(plain) as R[];
    if (sql === OFFICE_DELETES_SQL) return db.deletes.filter((row) => row.chg > Number(values![0])).map(({ tbl, id }) => ({ tbl, id })) as R[];
    if (sql === OFFICE_COLD_SQL) {
      const version = Number(values![0]);
      const oldest = (values![1] as Date).getTime();
      const copy = db.copy && (db.ignoreFilter || (db.copy.version <= version && db.copy.at >= oldest)) ? db.copy : undefined;
      const above = copy ? copy.version : -1;
      const copyRow = copy ? [{ c: COPY_ROW, id: String(copy.version), ord: '0', doc: null, auth: null, snap_at: new Date(copy.at), body: copy.body }] : [];
      const gone = copy ? db.deletes.filter((row) => row.chg > above).map((row) => ({ c: GONE_ROW, id: row.id, ord: '0', doc: null, auth: null, snap_at: null, body: row.tbl })) : [];
      return [...copyRow, ...db.rows.filter((row) => row.chg > above).map(plain), ...gone] as R[];
    }
    if (sql === OFFICE_COPY_UPSERT_SQL) {
      const [version, at, count, body] = values as [number, Date, number, string];
      const old = db.copy;
      if (!old || old.version < version || (old.version === version && old.at <= at.getTime()) || old.version > db.version) {
        db.copy = { version, at: at.getTime(), rows: count, body };
      }
      return [];
    }
    throw new Error(`The fake office does not know: ${sql.slice(0, 60)}`);
  };
  /** Mimics pgDb: a transaction is an async context, `statement` refuses inside one, and `detached` leaves it. */
  const context = new AsyncLocalStorage<boolean>();
  const q: Query = <R,>(sql: string, values?: unknown[]) => answer<R>(sql, values, context.getStore() === true);
  const tx = <T,>(_mode: 'read' | 'write', work: (inner: Query) => Promise<T>) => context.run(true, () => work(q));
  const handle = {
    tx,
    statement: async <R,>(_mode: string, sql: string, values?: unknown[]) => {
      if (context.getStore()) throw new Error('db.statement runs on its own connection, so it cannot run inside a transaction.');
      return answer<R>(sql, values, false);
    },
    detached: <T,>(work: () => T): T => context.exit(work),
  } as unknown as Db;
  return { db, q, tx, handle, context };
}

const project = (id: string, name: string) => ({ id, code: `KH-26-${id.slice(-3)}`, name, status: 'active', leaderId: 'usr_001' });
const user = (id: string) => ({ id, name: id, kind: 'human', active: true, ownerId: null, systemRole: 'member' });
const member = (projectId: string, userId: string) => ({ projectId, userId, discipline: 'Architect' });

function seeded() {
  const office = fakeOffice();
  office.db.save([
    { c: 'settings', doc: emptyState('').settings as never },
    { c: 'users', doc: user('usr_001'), auth: 'auth-1' },
    { c: 'users', doc: user('usr_002') },
    { c: 'projects', doc: project('prj_001', 'Tower') },
    { c: 'projects', doc: project('prj_002', 'Villa') },
    { c: 'members', doc: member('prj_001', 'usr_002') },
  ]);
  return office;
}

/** A cache with the copy on, and the work that the request hands to its "after". */
function copyCache(office: ReturnType<typeof fakeOffice>, o: { withAfter?: boolean; keepMs?: number } = {}) {
  const pending: Promise<unknown>[] = [];
  const after: After = (work) => void pending.push(work);
  const warned: unknown[] = [];
  const deps = { db: office.handle, log: { warn: (...args: unknown[]) => void warned.push(args), info: () => undefined, error: () => undefined } } as never;
  const cache = createOfficeCache({ copy: true, after: () => (o.withAfter === false ? undefined : after), ...(o.keepMs ? { keepMs: o.keepMs } : {}) });
  const read = (own = false) => {
    office.db.own = own;
    return office.tx('read', (inner) => cache.read(deps, inner));
  };
  const settle = async () => {
    await Promise.all(pending.splice(0));
  };
  return { cache, deps, read, settle, pending, warned };
}

/** The full read of an office (no copy), the reference. */
async function fullRead(office: ReturnType<typeof fakeOffice>) {
  return createOfficeCache().read({ db: office.handle }, office.q);
}

const asked = (office: ReturnType<typeof fakeOffice>, sql: string) => office.db.asked.filter((ask) => ask.sql === sql);

/** A cache has written a copy of the office as it stands. */
async function writeCopy(office: ReturnType<typeof fakeOffice>) {
  office.db.copy = undefined as Copy | undefined;
  const first = copyCache(office);
  await first.read();
  await first.settle();
  expect(office.db.copy?.version).toBe(office.db.version);
}

function expectSameOffice(actual: Awaited<ReturnType<typeof fullRead>>, expected: Awaited<ReturnType<typeof fullRead>>) {
  expect(actual.version).toBe(expected.version);
  for (const c of OFFICE_COLLECTIONS) {
    expect(actual.lists[c], c).toEqual(expected.lists[c]);
    // The order of a list is the order of its keys.
    if (c !== 'settings') expect(Object.keys(actual.lists[c] as object), `${c} order`).toEqual(Object.keys(expected.lists[c] as object));
  }
  expect(JSON.stringify(actual.lists)).toBe(JSON.stringify(expected.lists));
  for (const auth of ['auth-1', 'auth-2', 'auth-3']) expect(userIdOfAuth(actual, auth), auth).toBe(userIdOfAuth(expected, auth));
}

describe('the office copy text (server/data/officeCopy.ts)', () => {
  const tables = (): CopyTables =>
    new Map(OFFICE_COLLECTIONS.map((c) => [c, new Map<string, { ord: number; doc: Record<string, unknown>; auth?: string | null }>()])) as CopyTables;

  function sample(): CopyTables {
    const t = tables();
    t.get('users')!.set('usr_001', { ord: 1, doc: user('usr_001'), auth: 'auth-1' });
    t.get('users')!.set('usr_002', { ord: 4, doc: user('usr_002'), auth: null });
    t.get('projects')!.set('prj_002', { ord: 9, doc: project('prj_002', 'Villa'), auth: null });
    t.get('projects')!.set('prj_001', { ord: 2, doc: project('prj_001', 'Tower'), auth: null });
    t.get('settings')!.set('office', { ord: 1, doc: emptyState('').settings as never, auth: null });
    return t;
  }

  it('gives back the same entries, with the same ord and sign-in link, in a form that gzip makes small', async () => {
    const { body, rows } = await encodeCopy(7, sample());
    expect(rows).toBe(5);
    expect(body).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const back = (await decodeCopy(body, 7))!;
    expect([...back.get('projects')!.keys()]).toEqual(['prj_002', 'prj_001']);
    expect(back.get('projects')!.get('prj_002')).toEqual({ ord: 9, doc: project('prj_002', 'Villa'), auth: null });
    expect(back.get('users')!.get('usr_001')!.auth).toBe('auth-1');
    expect([...back.keys()]).toEqual([...OFFICE_COLLECTIONS]);
  });

  it('makes a big office much smaller than its JSON', async () => {
    const t = tables();
    for (let i = 1; i <= 300; i += 1) {
      const id = `prj_${String(i).padStart(3, '0')}`;
      t.get('projects')!.set(id, { ord: i, doc: { ...project(id, `Project number ${i}`), description: 'A villa with two floors and a roof garden for a family', startDate: '2026-01-01', endDate: '2026-12-31' }, auth: null });
    }
    const json = JSON.stringify([...t.get('projects')!.values()].map((entry) => entry.doc)).length;
    const { body } = await encodeCopy(3, t);
    expect(body.length).toBeLessThan(json / 3);
    expect((await decodeCopy(body, 3))!.get('projects')!.size).toBe(300);
  });

  it('returns null for every copy that is not good', async () => {
    const good = (await encodeCopy(7, sample())).body;
    expect(await decodeCopy(good, 7)).not.toBeNull();
    expect(await decodeCopy('', 7)).toBeNull();
    expect(await decodeCopy('not base64 !!', 7)).toBeNull();
    expect(await decodeCopy(btoa('plain text that is no gzip'), 7)).toBeNull();
    // A cut and a changed copy: gzip checks its length and checksum.
    expect(await decodeCopy(good.slice(0, Math.floor(good.length / 2)), 7)).toBeNull();
    const flipped = good.slice(0, 40) + (good[40] === 'A' ? 'B' : 'A') + good.slice(41);
    expect(await decodeCopy(flipped, 7)).toBeNull();
    // The version of the text must be the version of the row.
    expect(await decodeCopy(good, 8)).toBeNull();
  });

  async function zipped(value: unknown): Promise<string> {
    const stream = new Blob([new TextEncoder().encode(JSON.stringify(value))]).stream().pipeThrough(new CompressionStream('gzip'));
    return btoa(String.fromCharCode(...new Uint8Array(await new Response(stream).arrayBuffer())));
  }
  const lists = (extra: Record<string, unknown[]> = {}) => Object.fromEntries(OFFICE_COLLECTIONS.map((c) => [c, extra[c] ?? []]));

  it('returns null for a text of another form, a wrong count, a missing list, and a wrong entry', async () => {
    const entry = ['prj_001', 1, project('prj_001', 'Tower'), null];
    const ok = { f: OFFICE_COPY_FORMAT, version: 5, rows: 1, t: lists({ projects: [entry] }) };
    expect(await decodeCopy(await zipped(ok), 5)).not.toBeNull();
    expect(await decodeCopy(await zipped({ ...ok, f: 2 }), 5)).toBeNull();
    expect(await decodeCopy(await zipped({ ...ok, rows: 2 }), 5)).toBeNull();
    expect(await decodeCopy(await zipped({ ...ok, t: { ...ok.t, users: undefined } }), 5)).toBeNull();
    expect(await decodeCopy(await zipped({ ...ok, t: lists({ projects: [['prj_009', 1, project('prj_001', 'Tower'), null]] }) }), 5)).toBeNull();
    expect(await decodeCopy(await zipped({ ...ok, t: lists({ projects: [['prj_001', '1', project('prj_001', 'Tower'), null]] }) }), 5)).toBeNull();
    expect(await decodeCopy(await zipped({ ...ok, t: lists({ projects: [['prj_001', 1, 'doc', null]] }) }), 5)).toBeNull();
    expect(await decodeCopy(await zipped({ ...ok, t: lists({ projects: [['prj_001', 1, project('prj_001', 'Tower'), 7]] }) }), 5)).toBeNull();
    expect(await decodeCopy(await zipped({ ...ok, t: lists({ projects: [entry, entry] }), rows: 2 }), 5)).toBeNull();
    expect(await decodeCopy(await zipped({ ...ok, t: lists({ projects: [[...entry, 'extra']] }) }), 5)).toBeNull();
    expect(await decodeCopy(await zipped([]), 5)).toBeNull();
  });
});

describe('a cold office read with the copy', () => {
  it('sends one statement and no full read when the copy is current, and gives the office of a full read', async () => {
    const office = seeded();
    await writeCopy(office);
    office.db.asked.length = 0;
    const { read } = copyCache(office);
    const snapshot = await read();
    expect(office.db.asked.map((ask) => ask.sql)).toEqual([META_SQL, OFFICE_COLD_SQL]);
    expectSameOffice(snapshot, await fullRead(office));
  });

  it('is a full read in the same statement when no copy exists, and then writes one after the answer', async () => {
    const office = seeded();
    const { read, settle, pending } = copyCache(office);
    const snapshot = await read();
    expect(office.db.asked.map((ask) => ask.sql)).toEqual([META_SQL, OFFICE_COLD_SQL]);
    expect(office.db.copy).toBeUndefined();
    expect(pending).toHaveLength(1);
    await settle();
    expect(office.db.copy?.version).toBe(1);
    expect(office.db.copy?.rows).toBe(6);
    expectSameOffice(snapshot, await fullRead(office));
  });

  it('merges the delta of changes, deletes and an Undo into the copy: the same office as a full read, in the same order', async () => {
    const office = seeded();
    await writeCopy(office);
    office.db.save([{ c: 'projects', doc: project('prj_002', 'Villa renamed') }, { c: 'users', doc: user('usr_002'), auth: 'auth-2' }]);
    office.db.save([{ c: 'projects', doc: project('prj_003', 'Mosque') }]);
    office.db.save([], [{ c: 'members', id: 'prj_001:usr_002' }]);
    // An Undo: the row is deleted and then written again, so it gets a new ord and goes last.
    office.db.save([], [{ c: 'projects', id: 'prj_001' }]);
    office.db.save([{ c: 'projects', doc: project('prj_001', 'Tower back') }]);
    const snapshot = await copyCache(office).read();
    expect(snapshot.version).toBe(office.db.version);
    expectSameOffice(snapshot, await fullRead(office));
    expect(Object.keys(snapshot.lists.projects)).toEqual(['prj_002', 'prj_003', 'prj_001']);
    expect(snapshot.lists.members).toEqual({});
  });

  it('gives the office of a full read after many random saves between the copy and the read', async () => {
    let seed = 17;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 25; round += 1) {
      const office = seeded();
      await writeCopy(office);
      for (let step = 0, steps = 1 + random(12); step < steps; step += 1) {
        const id = `prj_${String(1 + random(6)).padStart(3, '0')}`;
        const kind = random(4);
        const exists = office.db.rows.some((row) => row.c === 'projects' && row.id === id);
        if (kind === 0 && exists) office.db.save([], [{ c: 'projects', id }]);
        else if (kind === 1 && exists) {
          office.db.save([], [{ c: 'projects', id }]);
          office.db.save([{ c: 'projects', doc: project(id, `Back ${round}`) }]);
        } else if (kind === 2) office.db.save([{ c: 'users', doc: user(`usr_${100 + random(4)}`), auth: random(2) ? `auth-${1 + random(3)}` : undefined }]);
        else office.db.save([{ c: 'projects', doc: project(id, `Name ${round} ${step}`) }]);
      }
      // Auth links are unique in the real table; the fake does not check it, so the test compares with the same rows.
      expectSameOffice(await copyCache(office).read(), await fullRead(office));
    }
  });

  it('keeps a warm cache working: the next request with the same version reads office_meta only', async () => {
    const office = seeded();
    await writeCopy(office);
    const { read } = copyCache(office);
    const first = await read();
    office.db.asked.length = 0;
    expect(await read()).toBe(first);
    expect(office.db.asked.map((ask) => ask.sql)).toEqual([META_SQL]);
    // A change after the cold read goes through the warm path of before, not through the copy.
    office.db.save([{ c: 'projects', doc: project('prj_002', 'Villa renamed') }]);
    office.db.asked.length = 0;
    expect((await read()).lists.projects.prj_002.name).toBe('Villa renamed');
    expect(office.db.asked.map((ask) => ask.sql)).toEqual([META_SQL, OFFICE_ROWS_SQL, OFFICE_DELETES_SQL]);
  });

  it('gives the counters of a write from the statement of the version, as before', async () => {
    const office = seeded();
    await writeCopy(office);
    const { cache, deps } = copyCache(office);
    const read = await office.tx('write', (inner) => cache.readWithCounters(deps, inner));
    expect(read.counters).toEqual({ tsk: 7 });
    expectSameOffice(read.office, await fullRead(office));
  });

  it('reads the copy for an own read, but keeps nothing and writes nothing', async () => {
    const office = seeded();
    await writeCopy(office);
    office.db.save([{ c: 'projects', doc: project('prj_003', 'Tried') }]);
    const { read, cache, pending } = copyCache(office);
    const snapshot = await read(true);
    expect(Object.keys(snapshot.lists.projects)).toContain('prj_003');
    expect(cache.version()).toBeNull();
    expect(pending).toHaveLength(0);
  });
});

describe('a copy that cannot be used', () => {
  /**
   * The read gives the office of a full read. "second": the statement gave a copy that the cache refused, so a second statement read
   * every row. "same": the statement left the copy out, so its own rows were the whole office.
   */
  async function expectFallback(office: ReturnType<typeof fakeOffice>, how: 'second' | 'same' = 'second') {
    office.db.asked.length = 0;
    const { read, settle } = copyCache(office);
    const snapshot = await read();
    expect(asked(office, OFFICE_ROWS_SQL).map((ask) => Number(ask.values![0]))).toEqual(how === 'second' ? [-1] : []);
    expect(asked(office, OFFICE_COLD_SQL)).toHaveLength(1);
    expectSameOffice(snapshot, await fullRead(office));
    await settle();
    return snapshot;
  }

  it('reads every row when the body is not base64, not gzip, cut, or of another form', async () => {
    for (const body of ['!!!', btoa('no gzip here'), 'H4sIAAAA', '']) {
      const office = seeded();
      await writeCopy(office);
      office.db.copy!.body = body;
      await expectFallback(office);
      expect(await decodeCopy(office.db.copy!.body, office.db.version)).not.toBeNull();
    }
  });

  it('reads every row when the version of the row is not the version inside the body', async () => {
    const office = seeded();
    await writeCopy(office);
    office.db.save([{ c: 'projects', doc: project('prj_003', 'Mosque') }]);
    office.db.copy!.version = 2;
    await expectFallback(office);
  });

  it('never uses a copy that is newer than the database (the SQL leaves it out; the cache checks it too)', async () => {
    const office = seeded();
    await writeCopy(office);
    office.db.copy!.version = 50;
    // The SQL filter drops it: this is a full read with no copy row.
    await expectFallback(office, 'same');
    // The cache checks it even when a statement gives it.
    const again = seeded();
    await writeCopy(again);
    again.db.copy!.version = 50;
    again.db.ignoreFilter = true;
    await expectFallback(again);
  });

  it('reads every row when the copy is older than the delete window, and then writes a fresh one', async () => {
    const office = seeded();
    await writeCopy(office);
    office.db.now += 6 * DAY + 1000;
    office.db.save([{ c: 'projects', doc: project('prj_002', 'Villa renamed') }]);
    await expectFallback(office, 'same');
    expect(office.db.copy!.version).toBe(2);
    // The same with a statement that ignores its time filter: the cache checks the age itself.
    const again = seeded();
    await writeCopy(again);
    again.db.now += 6 * DAY + 1000;
    again.db.ignoreFilter = true;
    await expectFallback(again);
  });

  it('applies a delete that happened inside the window, and one that the copy was made before', async () => {
    const office = seeded();
    await writeCopy(office);
    office.db.now += 5 * DAY;
    office.db.save([], [{ c: 'projects', id: 'prj_002' }]);
    const snapshot = await copyCache(office).read();
    expect(Object.keys(snapshot.lists.projects)).toEqual(['prj_001']);
    expect(asked(office, OFFICE_ROWS_SQL)).toHaveLength(0);
  });
});

describe('the writer of the copy', () => {
  it('writes after the answer, on its own connection, and never inside the transaction of the call', async () => {
    const office = seeded();
    const { cache, deps, settle } = copyCache(office);
    await office.tx('read', (inner) => cache.read(deps, inner));
    await settle();
    const upload = office.db.asked.find((ask) => ask.sql === OFFICE_COPY_UPSERT_SQL)!;
    expect(upload.inTx).toBe(false);
    expect(office.db.asked.filter((ask) => ask.inTx).every((ask) => ask.sql !== OFFICE_COPY_UPSERT_SQL)).toBe(true);
  });

  it('would fail inside a transaction on this fake, so the test above proves the use of detached', async () => {
    const office = seeded();
    await expect(office.tx('read', () => office.handle.statement('write', OFFICE_COPY_UPSERT_SQL, [1, new Date(), 0, '']))).rejects.toThrow(/inside a transaction/);
  });

  it('writes nothing when the request has no "after", and a copy is never written inline', async () => {
    const office = seeded();
    const { read, pending } = copyCache(office, { withAfter: false });
    await read();
    expect(pending).toHaveLength(0);
    expect(office.db.copy).toBeUndefined();
  });

  it('writes nothing when the copy is off', async () => {
    const office = seeded();
    const pending: Promise<unknown>[] = [];
    const cache = createOfficeCache({ after: () => (work) => void pending.push(work) });
    await office.tx('read', (inner) => cache.read({ db: office.handle }, inner));
    expect(pending).toHaveLength(0);
    expect(asked(office, OFFICE_COLD_SQL)).toHaveLength(0);
  });

  it('writes one copy for a burst of reads of one version in one worker', async () => {
    const office = seeded();
    const { read, pending, cache } = copyCache(office);
    await read();
    cache.clear();
    await read();
    expect(pending).toHaveLength(1);
  });

  it('writes again after a big delta, but not after a small one', async () => {
    const small = seeded();
    await writeCopy(small);
    small.db.save([{ c: 'projects', doc: project('prj_002', 'Villa renamed') }]);
    const smallRun = copyCache(small);
    await smallRun.read();
    expect(smallRun.pending).toHaveLength(0);

    const big = seeded();
    await writeCopy(big);
    big.db.save(Array.from({ length: COPY_DELTA_ROWS }, (_, i) => ({ c: 'projects', doc: project(`prj_1${String(i).padStart(2, '0')}`, `Many ${i}`) })));
    const bigRun = copyCache(big);
    await bigRun.read();
    expect(bigRun.pending).toHaveLength(1);
    await bigRun.settle();
    expect(big.db.copy!.version).toBe(big.db.version);
    expectSameOffice(await copyCache(big).read(), await fullRead(big));
  });

  it('writes again after a delta of many bytes in a few rows', async () => {
    const office = seeded();
    await writeCopy(office);
    office.db.save([{ c: 'projects', doc: { ...project('prj_002', 'Villa'), description: 'x'.repeat(9000) } }]);
    const run = copyCache(office);
    await run.read();
    expect(run.pending).toHaveLength(1);
  });

  it('refreshes a copy that is older than a day, with the same version', async () => {
    const office = seeded();
    await writeCopy(office);
    const first = office.db.copy!.at;
    office.db.now += COPY_MAX_AGE_MS + 1000;
    const run = copyCache(office);
    await run.read();
    expect(run.pending).toHaveLength(1);
    await run.settle();
    expect(office.db.copy!.version).toBe(office.db.version);
    expect(office.db.copy!.at).toBeGreaterThan(first);
  });

  it('keeps the newest version when two writers meet, in any order', async () => {
    const office = seeded();
    await writeCopy(office);
    const v1 = { ...office.db.copy! };
    office.db.save([{ c: 'projects', doc: project('prj_002', 'Villa renamed') }]);
    await writeCopy(office);
    const v2 = { ...office.db.copy! };
    expect(v2.version).toBe(2);
    // The writer of version 1 comes late.
    await office.handle.statement('write', OFFICE_COPY_UPSERT_SQL, [v1.version, new Date(v1.at), v1.rows, v1.body]);
    expect(office.db.copy!.version).toBe(2);
    // A copy that is newer than the database (a database that went back) is replaced.
    office.db.copy = { ...v2, version: 99 };
    await office.handle.statement('write', OFFICE_COPY_UPSERT_SQL, [v2.version, new Date(v2.at), v2.rows, v2.body]);
    expect(office.db.copy.version).toBe(2);
  });

  it('logs a failed write once for that write and keeps serving: the answer never depends on it', async () => {
    const office = seeded();
    const failing = { ...office.handle, statement: async () => { throw new Error('connection lost'); } } as unknown as Db;
    const warned: unknown[] = [];
    const pending: Promise<unknown>[] = [];
    const cache: OfficeCache = createOfficeCache({ copy: true, after: () => (work) => void pending.push(work) });
    const deps = { db: { ...failing, tx: office.handle.tx, detached: office.handle.detached }, log: { warn: (...a: unknown[]) => void warned.push(a) } } as never;
    const snapshot = await office.tx('read', (inner) => cache.read(deps, inner));
    await Promise.all(pending);
    expect(snapshot.version).toBe(1);
    expect(warned).toHaveLength(1);
  });
});
