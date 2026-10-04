import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import type { PoolClient } from 'pg';
import { afterAll, afterEach, beforeEach, inject, vi, type TestContext } from 'vitest';
import type { State } from '../../src/api/store';
import { setNow } from '../../src/lib/dates';
import { useDbTestApi } from '../../src/test/factories';
import type { RunCall } from '../core/runCall';
import type { Db, Query } from '../core/ports';
import type { CallEntry } from '../core/serverCallMap';
import { clearOfficeCaches } from '../data/officeCache';
import { COUNTERS_UPSERT_SQL, OFFICE_DELETES_SQL, deleteSql, docOf, rowOf, rowsParam, upsertSql, type Row } from '../data/rows';
import { pgDb } from '../data/sql';
import { TABLES, rowsOf, type TableSpec } from '../data/tables';
import { loadWhole } from '../data/whole';
import { localClient } from '../it/migrate';
import { skipReason } from './db-mode.skip';
import { createDbApi, type MirrorBackend } from './dbApi';
import { fakeDeps, type FakeDeps } from './fakes/deps';
import { harnessDbUrl, workerBaseline, workerLockKey, workerSchema, type ProvidedDb, type WorkerStats } from './global-setup';
import { SCHEMA_TABLES_SQL, checksumSql } from './invariants';
import { standInUses } from './uploads';

/**
 * The setup file of the db project (plan 7.2; TM 3.3 and 5; task D1). It registers the mirror store of dbApi.ts with testApi(),
 * on this worker's schema of the local stack:
 *
 * - One schema for each worker (madar_w<VITEST_POOL_ID>), made by global-setup.ts. A worker beyond the ones the global setup made
 *   applies the migrations into its own schema with its first file (workerBaseline).
 * - One connection for each test file. It signs in as postgres (the setup role) and keeps the schema on its search_path, and it
 *   checks that the search_path took (a pooler drops it). It refuses any database host except 127.0.0.1 and localhost.
 * - Fresh fakes (files, mail, auth, signals, clock) for each test, as the rollback gives a fresh database.
 * - The server code (runCall, the call map, every handler) loads with the first call, not with this file: a test file's vi.mock
 *   does not reach a module that the setup file loaded first.
 * - One transaction for each test: BEGIN on the first call, ROLLBACK in afterEach. Each transaction of runCall becomes a savepoint
 *   inside it (pgDb with callerClient). After each rollback the office caches go (clearOfficeCaches), so a cache never holds a
 *   version that the rollback took back.
 * - Each call runs as madar_server ("set local role"), with the office lock key of the schema (TM R6). The write-down of the
 *   test's own edits runs as postgres, so it may also change or remove an event (it turns the events trigger off for that one
 *   statement, inside the test transaction).
 * - The leak guard: after the last test of the file, the checksum of the schema must equal the checksum of the fresh schema.
 * - The skip list of db-mode.skip.ts.
 */

type Rec = Record<string, unknown>;

/** The SET of runCall: the "set local" statements that the call's savepoint leaves behind, and the role. */
const AS_SERVER = 'set local role madar_server';
const AS_SETUP = 'set local role none';
/** The deferred foreign keys of each call are checked at its own end; the next call starts deferred again (TM R11). */
const DEFERRED = 'set constraints all deferred';

/** JSON with sorted keys and without undefined, so two records with the same fields in another order are the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item ?? null)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const rec = value as Rec;
    return `{${Object.keys(rec).filter((key) => rec[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(rec[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

type DownChange = { spec: TableSpec; deleted: string[]; upserts: Row[]; touchesOld: boolean };

/** The differences from before to after, by table, in the database form of each record (docOf). */
export function downChanges(before: State, after: State): { tables: DownChange[]; counters: Record<string, number>; removedCounters: string[] } {
  const tables: DownChange[] = [];
  for (const spec of TABLES) {
    const was = new Map((before[spec.collection] || spec.collection === 'settings' ? rowsOf(before, spec) : []).map((row) => [row.id, row.doc]));
    const now = (after[spec.collection] || spec.collection === 'settings' ? rowsOf(after, spec) : []).filter((row) => row.doc !== undefined);
    const keep = new Set(now.map((row) => row.id));
    const deleted = [...was.keys()].filter((id) => !keep.has(id));
    const upserts = now
      .filter((row) => !was.has(row.id) || canonical(docOf(spec, was.get(row.id) as Rec)) !== canonical(docOf(spec, row.doc)))
      .map((row) => rowOf(spec, row.doc, after));
    if (deleted.length > 0 || upserts.length > 0) {
      const touchesOld = spec.collection === 'events' && (deleted.length > 0 || upserts.some((row) => was.has(row.id)));
      tables.push({ spec, deleted, upserts, touchesOld });
    }
  }
  const counters = Object.fromEntries(Object.entries(after.counters ?? {}).filter(([prefix, n]) => before.counters?.[prefix] !== n));
  const removedCounters = Object.keys(before.counters ?? {}).filter((prefix) => !(prefix in (after.counters ?? {})));
  return { tables, counters, removedCounters };
}

/**
 * Writes the test's own edits as postgres, with no rule check, inside a savepoint. A deferred foreign key is checked at the end,
 * so test data that breaks a database rule fails here with the rule's name, and not inside the next call.
 */
export async function writeDown(q: Query, before: State, after: State): Promise<boolean> {
  const { tables, counters, removedCounters } = downChanges(before, after);
  if (tables.length === 0 && Object.keys(counters).length === 0 && removedCounters.length === 0) return false;
  await q('savepoint madar_down');
  try {
    let version: number | undefined;
    if (tables.some((change) => change.spec.office)) {
      // The rule of every office write (server/data/officeCache.ts): a new version, and "chg" of each written row.
      const [meta] = await q<{ version: string | number }>('update office_meta set version = version + 1 returning version');
      version = Number(meta.version);
    }
    for (const change of tables) {
      const { spec } = change;
      if (change.touchesOld) await q('alter table events disable trigger events_append_only');
      if (change.deleted.length > 0) {
        await q(deleteSql(spec), [change.deleted]);
        if (spec.office) await q(OFFICE_DELETES_SQL, [spec.table, change.deleted, version]);
      }
      if (change.upserts.length > 0) {
        const sql = spec.collection === 'events' ? `${upsertSql(spec)} on conflict (id) do update set doc = excluded.doc` : upsertSql(spec);
        await q(sql, spec.office ? [rowsParam(change.upserts), version] : [rowsParam(change.upserts)]);
      }
      if (change.touchesOld) await q('alter table events enable trigger events_append_only');
    }
    if (removedCounters.length > 0) await q('delete from counters where prefix = any($1::text[])', [removedCounters]);
    if (Object.keys(counters).length > 0) await q(COUNTERS_UPSERT_SQL, [JSON.stringify(counters)]);
    await q('set constraints all immediate');
    await q(DEFERRED);
    await q('release savepoint madar_down');
  } catch (error) {
    await q('rollback to savepoint madar_down');
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`db mode: the test's own edits break a database rule, so they cannot go to the database: ${message}`);
  }
  return true;
}

/**
 * The test gate. A test that times out leaves its calls running; after the ROLLBACK they would run with no test transaction, so
 * they would commit for real and break the next test. So each backend binds to the test that first uses it, a call after that
 * test ended fails at once, and the end of a test waits for the database step that still runs before the ROLLBACK.
 */
export type Gate = {
  start(testId: string): void;
  end(): Promise<void>;
  /** A wrapper for the database steps of one backend. */
  binding(): <T>(work: () => Promise<T>) => Promise<T>;
};

export function createGate(): Gate {
  let current: string | undefined;
  const inflight = new Set<Promise<unknown>>();
  return {
    start(testId) {
      current = testId;
    },
    async end() {
      current = undefined;
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
    },
    binding() {
      let bound: string | undefined;
      return async <T>(work: () => Promise<T>): Promise<T> => {
        if (current === undefined || (bound !== undefined && bound !== current)) {
          throw new Error('db mode: this call came after its test ended, so it does not touch the database.');
        }
        bound ??= current;
        const running = work();
        inflight.add(running);
        try {
          return await running;
        } finally {
          inflight.delete(running);
        }
      };
    },
  };
}

/** One open connection of a worker: the client on its schema, the Db of runCall on that client, and the fresh-schema checksum. */
export type Session = {
  client: { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };
  db: Db;
  baseline: string;
  close(): Promise<void>;
};

/** The real connection: the schema made or found as postgres, then one pooled client with the schema on its search_path. */
async function openSession(worker: Worker): Promise<Session> {
  const setup = await localClient(worker.url);
  let baseline: string;
  try {
    baseline = await workerBaseline(setup, worker.schema, worker.provided);
  } finally {
    await setup.end();
  }
  const pool = new pg.Pool({ connectionString: worker.url, max: 1, options: `-c search_path=${worker.schema}` });
  pool.on('error', () => undefined);
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    await pool.end();
    throw error;
  }
  return {
    client,
    db: pgDb({ writeUrl: worker.url, readUrl: worker.url }, { callerClient: client }),
    baseline,
    async close() {
      client.release();
      await pool.end();
    },
  };
}

let runCallModule: Promise<typeof import('../core/runCall')> | undefined;

/** One worker's connection, transaction and backend. */
export class Worker {
  readonly schema = workerSchema(process.env.VITEST_POOL_ID);
  readonly lockKey = workerLockKey(this.schema);
  readonly url: string;
  readonly provided: ProvidedDb | undefined;
  readonly #opener: (worker: Worker) => Promise<Session>;
  #session?: Session;
  #open = false;
  #sumSql?: string;
  #runs = new WeakMap<ReadonlyMap<string, CallEntry>, RunCall>();
  /** How many calls ran on the database in this file, and their time in ms, for the speed gate of TM 4.1 (25 ms a call). */
  #calls = { n: 0, ms: 0 };
  /** The stand-in count of the worker when this file started, so the report counts this file only. */
  readonly #standInsAtStart = standInUses();
  readonly backend: MirrorBackend;
  #deps?: FakeDeps;

  constructor(o: { provided?: ProvidedDb; open?: (worker: Worker) => Promise<Session> } = {}) {
    this.provided = o.provided ?? inject('madarDb');
    this.#opener = o.open ?? openSession;
    // The worker checks the host again, so a URL that reached it some other way still cannot leave the Mac.
    this.url = harnessDbUrl({ DATABASE_URL: this.provided?.url });
    const worker = this;
    this.backend = {
      owner: undefined,
      begin: () => worker.begin(),
      writeDown: async (before, after) => {
        const wrote = await writeDown(worker.q, before, after);
        if (wrote) clearOfficeCaches();
        return wrote;
      },
      run: (req, calls) => worker.run(req, calls),
      readBack: () => loadWhole(worker.q, { withEvents: true }),
      checksum: () => worker.checksum(),
      get signals() {
        return worker.deps.signal.sent;
      },
      get clock() {
        return worker.deps.clock;
      },
      get files() {
        return worker.deps.files;
      },
    };
  }

  /** The fakes of the running test. begin() makes new ones for each test. */
  get deps(): FakeDeps {
    if (!this.#deps) throw new Error('db mode: the backend is used before its test transaction opened.');
    return this.#deps;
  }

  /** A backend for one mirror, behind the test gate. The owner mark stays one for the worker. */
  backendFor(gate: Gate): MirrorBackend {
    const bind = gate.binding();
    const base = this.backend;
    return {
      get owner() {
        return base.owner;
      },
      set owner(value) {
        base.owner = value;
      },
      begin: () => bind(() => base.begin()),
      writeDown: (before, after) => bind(() => base.writeDown(before, after)),
      run: (req, calls) => bind(() => base.run(req, calls)),
      readBack: () => bind(() => base.readBack()),
      checksum: () => bind(() => base.checksum()),
      get signals() {
        return base.signals;
      },
      get clock() {
        return base.clock;
      },
      get files() {
        return base.files;
      },
    };
  }

  readonly q: Query = async <R = Rec>(text: string, values?: unknown[]): Promise<R[]> => {
    if (!this.#session) throw new Error('db mode: no connection.');
    return (await this.#session.client.query(text, values)).rows as R[];
  };

  async #connect(): Promise<void> {
    if (this.#session) return;
    const session = await this.#opener(this);
    try {
      // A pooler (Supavisor, port 54329) drops the search_path of the startup options with no error, and every query would then
      // run on the public schema of the local stack.
      const [row] = (await session.client.query('select current_schema() as s')).rows as { s: string | null }[];
      if (row?.s !== this.schema) {
        throw new Error(
          `db mode: the connection works in the schema ${row?.s ?? '(none)'}, not in ${this.schema}. The harness needs a direct connection to the local database (port 54322), not the pooler.`,
        );
      }
      const tables = ((await session.client.query(SCHEMA_TABLES_SQL, [this.schema])).rows as { tablename: string }[]).map((r) => r.tablename);
      this.#sumSql = checksumSql(this.schema, tables);
    } catch (error) {
      await session.close();
      throw error;
    }
    this.#session = session;
  }

  /** Opens the transaction of a test, once, with fresh fakes: the rollback takes back the rows, these go with it. */
  async begin(): Promise<void> {
    await this.#connect();
    if (this.#open) return;
    await this.q('begin');
    this.#open = true;
    this.#deps = fakeDeps({ db: this.#session!.db, config: { lockKey: this.lockKey, supabaseUrl: `http://db-mode.${this.schema}` } });
  }

  async run(req: Parameters<MirrorBackend['run']>[0], calls: ReadonlyMap<string, CallEntry>) {
    let run = this.#runs.get(calls);
    if (!run) {
      const { createRunCall } = await (runCallModule ??= import('../core/runCall'));
      run = createRunCall({ calls });
      this.#runs.set(calls, run);
    }
    await this.q(AS_SERVER);
    const started = performance.now();
    try {
      return await run(this.deps, req);
    } finally {
      this.#calls.n += 1;
      this.#calls.ms += performance.now() - started;
      await this.q(AS_SETUP);
      await this.q(DEFERRED);
    }
  }

  async checksum(): Promise<string> {
    const [row] = await this.q<{ sum: string }>(this.#sumSql!);
    return row.sum;
  }

  /** ROLLBACK of the test transaction, then no cached office survives it. */
  async rollback(): Promise<void> {
    this.backend.owner = undefined;
    if (!this.#open) return;
    this.#open = false;
    try {
      await this.q('rollback');
    } finally {
      clearOfficeCaches();
    }
  }

  /**
   * The leak guard (TM 5, point 4): no row of any test is left. Then the connection closes, and the file's call count and time go
   * into the run folder, where the global teardown adds them up for the speed gate (speedGate of global-setup.ts).
   */
  async close(): Promise<void> {
    const session = this.#session;
    if (!session) return;
    const stats: WorkerStats = { ...this.#calls, standIns: standInUses() - this.#standInsAtStart };
    try {
      await this.rollback();
      if ((await this.checksum()) !== session.baseline) {
        throw new Error(`db mode, leak guard: the schema ${this.schema} holds rows that a test committed outside its transaction.`);
      }
    } finally {
      this.#session = undefined;
      await session.close();
      if (this.provided?.stats) writeFileSync(join(this.provided.stats, `${this.schema}-${randomUUID()}.json`), JSON.stringify(stats));
    }
  }
}

/** The full name of a test as Vitest prints it: the describe names and the test name, joined by spaces. */
function fullName(task: TestContext['task']): string {
  const names = [task.name];
  for (let suite = task.suite; suite && suite !== (task.file as unknown); suite = suite.suite) if (suite.name) names.unshift(suite.name);
  return names.join(' ');
}

if (process.env.MADAR_DB === '1') {
  // A call on the database takes far longer than in memory, and the sample-office tests make many. The speed gate of TM 4.1
  // (120 s, 25 ms a call) is in the global teardown (speedGate); this limit only keeps a slow machine from failing a test that is right.
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
  const worker = new Worker();
  const gate = createGate();
  useDbTestApi((calls, state) => createDbApi(calls, state, worker.backendFor(gate)));

  beforeEach((ctx) => {
    const reason = skipReason(ctx.task.file.filepath, fullName(ctx.task));
    if (reason) ctx.skip(`db mode: ${reason}`);
    gate.start(ctx.task.id);
  });

  afterEach(async () => {
    await gate.end();
    await worker.rollback();
  });

  afterAll(async () => {
    await worker.close();
  });
}

afterEach(() => {
  // Many API tests call setNow without their own reset.
  setNow(null);
});
