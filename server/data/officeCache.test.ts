import { describe, expect, it } from 'vitest';
import { emptyState, type State } from '../../src/api/store';
import type { Db, Query } from '../core/ports';
import { OFFICE_COLLECTIONS } from '../core/types';
import { AUTH_LINK_SQL, createOfficeCache, META_SQL, OFFICE_DELETES_KEEP_DAYS, OFFICE_DELETES_SQL, OFFICE_ROWS_SQL, readOffice, setAuthUserId, snapshotOf, userIdOfAuth } from './officeCache';
import { tableOf } from './tables';

/**
 * The office cache (plan 4.7; task C2) against a small fake of the three statements it sends: office_meta, the office rows above
 * a version, and the office_deletes rows above a version. server/it/officeCache.it.test.ts runs the same rules on the database.
 */

type Row = { c: string; id: string; ord: number; doc: Record<string, unknown>; chg: number; auth: string | null };
const DAY = 24 * 60 * 60 * 1000;

function fakeOffice() {
  const db = {
    version: 0,
    now: new Date('2026-10-04T06:00:00Z').getTime(),
    rows: [] as Row[],
    deletes: [] as { tbl: string; id: string; chg: number }[],
    ord: 0,
    /** True while the office_meta row that the fake gives was written by the open transaction of the reader. */
    own: false,
    asked: [] as { sql: string; values?: unknown[] }[],
    /** One save: the rows it writes and the rows it deletes get the next version, as the save step does (plan 4.7). */
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
  const q: Query = async <R,>(sql: string, values?: unknown[]) => {
    db.asked.push({ sql, values });
    if (sql === META_SQL) return [{ version: String(db.version), at: new Date(db.now), own: db.own }] as R[];
    if (sql === AUTH_LINK_SQL) {
      db.version += 1;
      const row = db.rows.find((r) => r.c === 'users' && r.id === values![0]);
      if (row) Object.assign(row, { auth: values![1], chg: db.version });
      return (row ? [{ id: row.id }] : []) as R[];
    }
    if (sql === OFFICE_ROWS_SQL) {
      const above = Number(values![0]);
      return db.rows.filter((row) => row.chg > above).map((row) => ({ c: row.c, id: row.id, ord: String(row.ord), doc: structuredClone(row.doc), auth: row.auth })) as R[];
    }
    if (sql === OFFICE_DELETES_SQL) return db.deletes.filter((row) => row.chg > Number(values![0])).map(({ tbl, id }) => ({ tbl, id })) as R[];
    throw new Error(`The fake office does not know: ${sql}`);
  };
  const rowsAsked = () => db.asked.filter((ask) => ask.sql === OFFICE_ROWS_SQL).map((ask) => Number(ask.values![0]));
  return { db, q, rowsAsked };
}

const project = (id: string, name: string) => ({ id, code: `KH-26-${id.slice(-3)}`, name, status: 'active', leaderId: 'usr_001' });
const user = (id: string) => ({ id, name: id, kind: 'human', active: true, ownerId: null, systemRole: 'member' });
const member = (projectId: string, userId: string) => ({ projectId, userId, discipline: 'Architect' });

/** An office of two people, two projects and one member, saved once. */
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

const deps = { db: undefined as unknown as Db };

describe('the office cache', () => {
  it('loads every office row on a cold start, in insertion order, and keeps the version it read', async () => {
    const { db, q, rowsAsked } = seeded();
    const cache = createOfficeCache();
    const snapshot = await cache.read(deps, q);
    expect(rowsAsked()).toEqual([-1]);
    expect(snapshot.version).toBe(1);
    expect(Object.keys(snapshot.lists.projects)).toEqual(['prj_001', 'prj_002']);
    expect(snapshot.lists.members['prj_001:usr_002']).toEqual(member('prj_001', 'usr_002'));
    expect(snapshot.lists.settings).toEqual(emptyState('').settings);
    expect(Object.keys(snapshot.lists).sort()).toEqual([...OFFICE_COLLECTIONS].sort());
    expect(cache.version()).toBe(db.version);
  });

  it('reads only office_meta while the version stays, and gives the same snapshot', async () => {
    const { q, rowsAsked } = seeded();
    const cache = createOfficeCache();
    const first = await cache.read(deps, q);
    const second = await cache.read(deps, q);
    expect(second).toBe(first);
    expect(rowsAsked()).toEqual([-1]);
  });

  it('reloads only the rows above its version: a change of one project is one row', async () => {
    const { db, q, rowsAsked } = seeded();
    const cache = createOfficeCache();
    await cache.read(deps, q);
    db.save([{ c: 'projects', doc: project('prj_002', 'Villa renamed') }]);
    const snapshot = await cache.read(deps, q);
    expect(rowsAsked()).toEqual([-1, 1]);
    const asked = db.asked.at(-2)!;
    expect((await q(asked.sql, asked.values)).length).toBe(1);
    expect(snapshot.version).toBe(2);
    expect(snapshot.lists.projects.prj_002.name).toBe('Villa renamed');
    expect(Object.keys(snapshot.lists.projects)).toEqual(['prj_001', 'prj_002']);
    expect(snapshot.lists.users.usr_001).toEqual(user('usr_001'));
  });

  it('drops a deleted row that arrives through office_deletes, and keeps a row that an Undo brought back', async () => {
    const { db, q } = seeded();
    const cache = createOfficeCache();
    await cache.read(deps, q);
    db.save([], [{ c: 'members', id: 'prj_001:usr_002' }]);
    expect((await cache.read(deps, q)).lists.members).toEqual({});
    db.save([], [{ c: 'projects', id: 'prj_002' }]);
    db.save([{ c: 'projects', doc: project('prj_002', 'Villa back') }]);
    const snapshot = await cache.read(deps, q);
    expect(snapshot.lists.projects.prj_002.name).toBe('Villa back');
    // A row that comes back after a delete gets a new ord, so it goes last, as in the prototype.
    expect(Object.keys(snapshot.lists.projects)).toEqual(['prj_001', 'prj_002']);
  });

  it('loads everything again when it was last known current before the delete window of the job', async () => {
    const { db, q, rowsAsked } = seeded();
    const cache = createOfficeCache();
    await cache.read(deps, q);
    db.now += (OFFICE_DELETES_KEEP_DAYS - 1) * DAY + 1000;
    db.save([{ c: 'projects', doc: project('prj_001', 'Tower renamed') }]);
    const snapshot = await cache.read(deps, q);
    expect(rowsAsked()).toEqual([-1, -1]);
    expect(snapshot.lists.projects.prj_001.name).toBe('Tower renamed');
  });

  it('stays current while each request finds the same version, so a long-lived cache still loads only the change', async () => {
    const { db, q, rowsAsked } = seeded();
    const cache = createOfficeCache();
    for (let day = 0; day < 10; day += 1) {
      await cache.read(deps, q);
      db.now += DAY;
    }
    db.save([{ c: 'projects', doc: project('prj_001', 'Tower renamed') }]);
    await cache.read(deps, q);
    expect(rowsAsked()).toEqual([-1, 1]);
  });

  it('follows an older version when a transaction rolled back after it read (the db-mode harness)', async () => {
    const { db, q, rowsAsked } = seeded();
    const cache = createOfficeCache();
    db.save([{ c: 'projects', doc: project('prj_003', 'Tried') }]);
    expect(Object.keys((await cache.read(deps, q)).lists.projects)).toContain('prj_003');
    // The test transaction rolls back: the row and the version go back.
    db.version = 1;
    db.rows = db.rows.filter((row) => row.id !== 'prj_003');
    const snapshot = await cache.read(deps, q);
    expect(Object.keys(snapshot.lists.projects)).toEqual(['prj_001', 'prj_002']);
    expect(rowsAsked()).toEqual([-1, -1]);
  });

  it('never keeps a snapshot that its own open transaction wrote, so a rolled-back change is not served when a commit reuses its version', async () => {
    const { db, q } = seeded();
    const cache = createOfficeCache();
    await cache.read(deps, q);
    // Transaction T1 saves a change (version 2) and reads the cache inside the same transaction.
    db.save([{ c: 'projects', doc: project('prj_003', 'Tried') }]);
    db.own = true;
    expect(Object.keys((await cache.read(deps, q)).lists.projects)).toContain('prj_003');
    expect(cache.version()).toBe(1);
    // T1 rolls back. Another isolate commits a different change, which gets version 2 too.
    db.own = false;
    db.version = 1;
    db.rows = db.rows.filter((row) => row.id !== 'prj_003');
    db.save([{ c: 'projects', doc: project('prj_002', 'Villa committed') }]);
    const snapshot = await cache.read(deps, q);
    expect(Object.keys(snapshot.lists.projects)).toEqual(['prj_001', 'prj_002']);
    expect(snapshot.lists.projects.prj_002.name).toBe('Villa committed');
  });

  it('a warm cache finds a sign-in link that setAuthUserId writes, and drops a link it clears', async () => {
    const { q } = seeded();
    const cache = createOfficeCache();
    const first = await cache.read(deps, q);
    expect(userIdOfAuth(first, 'auth-2')).toBeUndefined();
    expect(await setAuthUserId(q, 'usr_002', 'auth-2')).toBe(true);
    const linked = await cache.read(deps, q);
    expect(linked.version).toBe(first.version + 1);
    expect(userIdOfAuth(linked, 'auth-2')).toBe('usr_002');
    await setAuthUserId(q, 'usr_001', null);
    const cleared = await cache.read(deps, q);
    expect(userIdOfAuth(cleared, 'auth-1')).toBeUndefined();
    expect(userIdOfAuth(cleared, 'auth-2')).toBe('usr_002');
    expect(await setAuthUserId(q, 'usr_404', 'auth-9')).toBe(false);
  });

  it('gives frozen objects: a write into the cache throws', async () => {
    const { q } = seeded();
    const snapshot = await createOfficeCache().read(deps, q);
    expect(Object.isFrozen(snapshot.lists.projects.prj_001)).toBe(true);
    expect(() => {
      (snapshot.lists.projects.prj_001 as { name: string }).name = 'Changed';
    }).toThrow(TypeError);
    expect(() => {
      (snapshot.lists.users as Record<string, unknown>).usr_009 = user('usr_009');
    }).toThrow(TypeError);
  });

  it('finds the Madar user of a sign-in from auth_user_id', async () => {
    const { db, q } = seeded();
    const cache = createOfficeCache();
    const first = await cache.read(deps, q);
    expect(userIdOfAuth(first, 'auth-1')).toBe('usr_001');
    expect(userIdOfAuth(first, 'auth-2')).toBeUndefined();
    db.save([{ c: 'users', doc: user('usr_002'), auth: 'auth-2' }]);
    expect(userIdOfAuth(await cache.read(deps, q), 'auth-2')).toBe('usr_002');
  });

  it('opens a read transaction of its own when no transaction is open', async () => {
    const { q } = seeded();
    const modes: string[] = [];
    const db = { tx: async (mode: 'read' | 'write', work: (inner: Query) => Promise<unknown>) => { modes.push(mode); return work(q); } } as unknown as Db;
    const snapshot = await createOfficeCache().read({ db }, undefined);
    expect(modes).toEqual(['read']);
    expect(snapshot.version).toBe(1);
  });

  it('keeps one cache for each office, through readOffice', async () => {
    const { q, rowsAsked } = seeded();
    const config = { supabaseUrl: 'http://127.0.0.1:54321', lockKey: 9_001 } as never;
    const full = { db: undefined as unknown as Db, config } as never;
    await readOffice(full, q);
    await readOffice(full, q);
    expect(rowsAsked()).toEqual([-1]);
  });

  it('makes a frozen snapshot from office lists, for tests and the harness', () => {
    const state: State = emptyState('');
    state.projects.prj_001 = project('prj_001', 'Tower') as never;
    const snapshot = snapshotOf(state, 4);
    expect(snapshot.version).toBe(4);
    expect(Object.isFrozen(snapshot.lists.projects.prj_001)).toBe(true);
    expect(state.projects.prj_001).not.toBe(snapshot.lists.projects.prj_001);
  });
});
