import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyState, type State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import type { After } from '../core/after';
import type { Db, Query } from '../core/ports';
import { OFFICE_COLLECTIONS } from '../core/types';
import { createOfficeCache, META_SQL, OFFICE_ROWS_SQL, userIdOfAuth } from '../data/officeCache';
import { COPY_ROW, GONE_ROW, OFFICE_COLD_SQL, OFFICE_COPY_UPSERT_SQL, decodeCopy } from '../data/officeCopy';
import { save } from '../data/save';
import { loadWhole, writeState } from '../data/whole';
import { yearOffice } from '../office/test/yearOffice';
import { applyMigrations, dropSchema, localClient } from './migrate';

/**
 * The compressed office copy (tsk_496) on the local database: the migration, the real cold read statement, the upsert rule, a copy plus
 * a delta against a full read, and the bytes that a cold read receives with and without the copy. It needs the local stack and the Docker
 * lock, and talks only to 127.0.0.1.
 */

const TODAY = '2026-11-01';
const STORY = { storyId: 'sty_copy', actorId: 'usr_001' };
const SERVER = 'madar_server';

describe('the office copy on the local database', () => {
  const schema = `madar_copy_${process.pid}`;
  let db: pg.Client;
  /** The connection of the writer: a statement of the copy writer never shares the connection of a transaction of a call. */
  let writer: pg.Client;
  const q: Query = async <R,>(text: string, values?: unknown[]) => (await db.query(text, values)).rows as R[];

  /** The bytes that the client socket received while the work ran: the real size of the answers on the wire. */
  async function received(work: () => Promise<unknown>): Promise<number> {
    const stream = (db as unknown as { connection: { stream: { bytesRead: number } } }).connection.stream;
    const from = stream.bytesRead;
    await work();
    return stream.bytesRead - from;
  }

  async function inTx<T>(mode: 'read' | 'write', work: () => Promise<T>): Promise<T> {
    await db.query(mode === 'read' ? 'begin isolation level repeatable read, read only' : 'begin');
    try {
      const result = await work();
      await db.query('commit');
      return result;
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
  }

  /** A Db for the cache: transactions run on the client, and a statement runs on the connection of the writer. */
  const handle = {
    tx: <T,>(mode: 'read' | 'write', work: (inner: Query) => Promise<T>) => inTx(mode, () => work(q)),
    statement: async <R,>(_mode: string, text: string, values?: unknown[]) => (await writer.query(text, values)).rows as R[],
  } as unknown as Db;

  /** A cache with the copy on, and the work that it hands to "after". */
  function copyCache() {
    const pending: Promise<unknown>[] = [];
    const after: After = (work) => void pending.push(work);
    const cache = createOfficeCache({ copy: true, after: () => after });
    return { cache, pending, settle: async () => void (await Promise.all(pending.splice(0))), read: () => handle.tx('read', (inner) => cache.read({ db: handle }, inner)) };
  }

  async function fullRead() {
    return handle.tx('read', (inner) => createOfficeCache().read({ db: handle }, inner));
  }

  async function change(edit: (state: State) => void) {
    return inTx('write', async () => {
      const before = await loadWhole(q, { today: TODAY });
      const after = structuredClone(before);
      edit(after);
      return save(q, before, after, { story: STORY });
    });
  }

  function expectSame(actual: Awaited<ReturnType<typeof fullRead>>, expected: Awaited<ReturnType<typeof fullRead>>) {
    expect(actual.version).toBe(expected.version);
    expect(JSON.stringify(actual.lists)).toBe(JSON.stringify(expected.lists));
    for (const c of OFFICE_COLLECTIONS) if (c !== 'settings') expect(Object.keys(actual.lists[c] as object), c).toEqual(Object.keys(expected.lists[c] as object));
    for (const auth of ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']) expect(userIdOfAuth(actual, auth)).toBe(userIdOfAuth(expected, auth));
  }

  const copyRow = async () => (await db.query('select version::int as version, at, row_count, length(body) as size from office_copy')).rows;

  beforeAll(async () => {
    db = await localClient();
    await applyMigrations(db, schema);
    await db.query(`set search_path to ${schema}`);
    writer = await localClient();
    await writer.query(`set search_path to ${schema}`);
    const seed = await buildSeed(TODAY, async () => undefined);
    await inTx('write', () => writeState(q, seed));
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await writer?.end();
    await dropSchema(db, schema);
    await db.end();
  });

  it('has the table with RLS on, one policy for madar_server, and no right for the browser roles', async () => {
    const { rows: flags } = await db.query('select relrowsecurity from pg_class where oid = $1::regclass', ['office_copy']);
    expect(flags[0].relrowsecurity).toBe(true);
    const { rows: policies } = await db.query('select policyname, roles::text from pg_policies where schemaname = $1 and tablename = $2', [schema, 'office_copy']);
    expect(policies).toEqual([{ policyname: 'server_all', roles: `{${SERVER}}` }]);
    const { rows: grants } = await db.query(
      `select grantee, privilege_type from information_schema.role_table_grants where table_schema = $1 and table_name = 'office_copy' and grantee in ('anon', 'authenticated', 'public', $2) order by 1, 2`,
      [schema, SERVER],
    );
    expect(grants).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'].map((privilege_type) => ({ grantee: SERVER, privilege_type })));
    // Only one row may exist.
    await expect(db.query("insert into office_copy (id, version, at, row_count, body) values (2, 1, now(), 0, '')")).rejects.toThrow(/office_copy_id_check/);
  });

  it('a first cold read is the full read in one statement, and writes the copy after the answer', async () => {
    const run = copyCache();
    const first = await run.read();
    expectSame(first, await fullRead());
    await run.settle();
    const [row] = await copyRow();
    expect(row).toMatchObject({ version: first.version });
    expect(row.row_count).toBeGreaterThan(50);
    const body = (await db.query('select body from office_copy')).rows[0].body as string;
    expect(await decodeCopy(body, first.version)).not.toBeNull();
  });

  it('a cold read with the copy gives the office of a full read, from the copy and the rows above it, and sends fewer bytes', async () => {
    const { rows: before } = await db.query('select version::int as version from office_meta');
    await change((state) => {
      state.projects.prj_002.name = 'Renamed after the copy';
    });
    const key = Object.keys((await fullRead()).lists.members)[0];
    await change((state) => {
      delete state.members[key];
      state.clients[Object.keys(state.clients)[0]].name = 'Client renamed';
    });
    // An Undo: a deadline is removed and comes back with a new ord, so it goes last.
    const deadline = Object.keys((await fullRead()).lists.deadlines)[0];
    const saved = structuredClone((await fullRead()).lists.deadlines[deadline]);
    await change((state) => {
      delete state.deadlines[deadline];
    });
    expect((await fullRead()).lists.deadlines[deadline]).toBeUndefined();
    await change((state) => {
      state.deadlines[deadline] = saved as never;
    });
    const expected = await fullRead();
    expect(expected.version).toBeGreaterThan(before[0].version);

    const run = copyCache();
    let snapshot!: Awaited<ReturnType<typeof fullRead>>;
    const copyBytes = await received(async () => void (snapshot = await run.read()));
    expectSame(snapshot, expected);
    const fullBytes = await received(() => fullRead());
    expect(snapshot.lists.projects.prj_002.name).toBe('Renamed after the copy');
    expect(Object.keys(snapshot.lists.members)).not.toContain(key);
    expect(Object.keys(snapshot.lists.deadlines).at(-1)).toBe(deadline);
    process.stdout.write(`office copy, sample office: full read ${fullBytes} bytes, cold read with the copy ${copyBytes} bytes\n`);
    expect(copyBytes).toBeLessThan(fullBytes);
  });

  it('uses the statement of the cache: one copy row, then only the rows above its version', async () => {
    const [meta] = await q<{ version: string; at: Date }>(META_SQL);
    const rows = await q<{ c: string; id: string }>(OFFICE_COLD_SQL, [meta.version, new Date(new Date(meta.at).getTime() - 6 * 86_400_000)]);
    expect(rows.filter((row) => row.c === COPY_ROW)).toHaveLength(1);
    const copyVersion = Number((await q<{ version: string }>('select version from office_copy'))[0].version);
    const above = (await q(OFFICE_ROWS_SQL, [copyVersion])).length;
    expect(above).toBeGreaterThan(0);
    expect(rows.filter((row) => row.c !== COPY_ROW && row.c !== GONE_ROW)).toHaveLength(above);
  });

  it('leaves the copy out when it is newer than the database or older than the window, and then the same statement is the full read', async () => {
    const [meta] = await q<{ version: string; at: Date }>(META_SQL);
    const now = new Date(meta.at).getTime();
    const full = (await q(OFFICE_ROWS_SQL, [-1])).length;
    const none = await q<{ c: string }>(OFFICE_COLD_SQL, [meta.version, new Date(now + 3_600_000)]);
    expect(none.some((row) => row.c === COPY_ROW)).toBe(false);
    expect(none).toHaveLength(full);
    // The price of the two extra columns when no copy is used: the same rows, in the same one statement.
    const plain = await received(() => q(OFFICE_ROWS_SQL, [-1]));
    const cold = await received(() => q(OFFICE_COLD_SQL, [meta.version, new Date(now + 3_600_000)]));
    process.stdout.write(`office copy, no copy used: the rows statement ${plain} bytes, the cold statement ${cold} bytes\n`);
    expect(cold).toBeLessThan(plain * 1.1);
    const newer = await q<{ c: string }>(OFFICE_COLD_SQL, [Number(meta.version) - 1000, new Date(now - 6 * 86_400_000)]);
    expect(newer.some((row) => row.c === COPY_ROW)).toBe(false);
    expect(newer).toHaveLength(full);
  });

  it('keeps the newest version when two writers meet, and replaces a copy that is newer than office_meta', async () => {
    const live = Number((await q<{ version: string }>('select version from office_meta'))[0].version);
    const body = (await q<{ body: string }>('select body from office_copy'))[0].body;
    const at = new Date();
    await q(OFFICE_COPY_UPSERT_SQL, [live, at, 1, body]);
    // Two writers at once: the old one comes in any order and never wins.
    await Promise.all([db.query(OFFICE_COPY_UPSERT_SQL, [live - 1, at, 2, body]), writer.query(OFFICE_COPY_UPSERT_SQL, [live - 2, at, 3, body])]);
    expect(await copyRow()).toMatchObject([{ version: live, row_count: 1 }]);
    // A copy above the version of the database (a database that went back) is replaced by the version of this writer.
    await q('update office_copy set version = $1', [live + 500]);
    await q(OFFICE_COPY_UPSERT_SQL, [live, at, 4, body]);
    expect(await copyRow()).toMatchObject([{ version: live, row_count: 4 }]);
  });

  it('two requests that start cold at once and write at once leave one good copy', async () => {
    const live = Number((await q<{ version: string }>('select version from office_meta'))[0].version);
    await q('truncate office_copy');
    const [a, b] = [copyCache(), copyCache()];
    await a.read();
    await b.read();
    await Promise.all([a.settle(), b.settle()]);
    const [row] = await copyRow();
    expect(row.version).toBe(live);
    expectSame(await copyCache().read(), await fullRead());
  });

  it('measures a cold read on a larger office (the year office lists)', async () => {
    const year = await yearOffice(TODAY);
    const lists = emptyState(TODAY);
    for (const c of OFFICE_COLLECTIONS) (lists as unknown as Record<string, unknown>)[c] = (year as unknown as Record<string, unknown>)[c];
    const big = `${schema}_year`;
    await applyMigrations(db, big);
    await db.query(`set search_path to ${big}`);
    await writer.query(`set search_path to ${big}`);
    try {
      await inTx('write', () => writeState(q, lists));
      const run = copyCache();
      await run.read();
      await run.settle();
      const fullBytes = await received(() => fullRead());
      const warmRun = copyCache();
      let snapshot!: Awaited<ReturnType<typeof fullRead>>;
      const copyBytes = await received(async () => void (snapshot = await warmRun.read()));
      expectSame(snapshot, await fullRead());
      const keys = Object.values(snapshot.lists).reduce((n, list) => n + Object.keys(list as object).length, 0);
      const [row] = await copyRow();
      process.stdout.write(`office copy, year office lists (${keys} keys): full read ${fullBytes} bytes, cold read with the copy ${copyBytes} bytes, copy text ${row.size} bytes\n`);
      expect(copyBytes).toBeLessThan(fullBytes);
    } finally {
      await db.query(`set search_path to ${schema}`);
      await writer.query(`set search_path to ${schema}`);
      await dropSchema(db, big);
    }
  }, 120_000);
});
