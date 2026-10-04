import pg from 'pg';
import type { PoolClient } from 'pg';
import { afterAll, afterEach, beforeEach, inject, type TestContext } from 'vitest';
import type { State } from '../../src/api/store';
import { setNow } from '../../src/lib/dates';
import { useDbTestApi } from '../../src/test/factories';
import { createRunCall, type RunCall } from '../core/runCall';
import type { Query } from '../core/ports';
import type { CallEntry } from '../core/serverCallMap';
import { clearOfficeCaches } from '../data/officeCache';
import { COUNTERS_UPSERT_SQL, OFFICE_DELETES_SQL, deleteSql, docOf, rowOf, rowsParam, upsertSql, type Row } from '../data/rows';
import { pgDb } from '../data/sql';
import { TABLES, rowsOf, type TableSpec } from '../data/tables';
import { loadWhole } from '../data/whole';
import { applyMigrations, localClient } from '../it/migrate';
import { skipReason } from './db-mode.skip';
import { createDbApi, type MirrorBackend } from './dbApi';
import { fakeDeps } from './fakes/deps';
import { harnessDbUrl, workerLockKey, workerSchema } from './global-setup';
import { SCHEMA_TABLES_SQL, checksumSql } from './invariants';

/**
 * The setup file of the db project (plan 7.2; TM 3.3 and 5; task D1). It registers the mirror store of dbApi.ts with testApi(),
 * on this worker's schema of the local stack:
 *
 * - One schema for each worker (madar_w<VITEST_POOL_ID>), made by global-setup.ts. A worker beyond the ones the global setup made
 *   applies the migrations into its own schema.
 * - One connection for each test file. It signs in as postgres (the setup role) and keeps the schema on its search_path. It
 *   refuses any database host except 127.0.0.1 and localhost (harnessDbUrl).
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

/** One worker's connection, transaction and backend. */
class Worker {
  readonly schema = workerSchema(process.env.VITEST_POOL_ID);
  readonly lockKey = workerLockKey(this.schema);
  readonly url: string;
  readonly baseline: string | undefined;
  #pool?: pg.Pool;
  #client?: PoolClient;
  #open = false;
  #sumSql?: string;
  #ownBaseline?: string;
  #runs = new WeakMap<ReadonlyMap<string, CallEntry>, RunCall>();
  /** How many calls ran on the database in this file, and their time in ms, for the gate of TM 4.1 (25 ms a call). */
  #calls = { n: 0, ms: 0 };
  readonly backend: MirrorBackend;
  #deps?: ReturnType<typeof fakeDeps>;

  constructor() {
    const provided = inject('madarDb');
    // The worker checks the host again, so a URL that reached it some other way still cannot leave the Mac.
    this.url = harnessDbUrl({ DATABASE_URL: provided?.url });
    this.baseline = provided?.baselines[this.schema];
    const deps = () => {
      if (!this.#deps) throw new Error('db mode: the backend is used before its connection opened.');
      return this.#deps;
    };
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
        return deps().signal.sent;
      },
      get clock() {
        return deps().clock;
      },
    };
  }

  readonly q: Query = async <R = Rec>(text: string, values?: unknown[]): Promise<R[]> => {
    if (!this.#client) throw new Error('db mode: no connection.');
    return (await this.#client.query(text, values)).rows as R[];
  };

  async #connect(): Promise<PoolClient> {
    if (this.#client) return this.#client;
    const exists = await localClient(this.url);
    try {
      const [row] = (await exists.query('select to_regclass($1) as found', [`${this.schema}.office_meta`])).rows as { found: string | null }[];
      if (!row.found) {
        await applyMigrations(exists, this.schema);
        this.#ownBaseline = await (async () => {
          await exists.query(`set search_path to ${this.schema}`);
          const tables = (await exists.query(SCHEMA_TABLES_SQL, [this.schema])).rows.map((r: { tablename: string }) => r.tablename);
          return ((await exists.query(checksumSql(tables))).rows[0] as { sum: string }).sum;
        })();
      }
    } finally {
      await exists.end();
    }
    this.#pool = new pg.Pool({ connectionString: this.url, max: 1, options: `-c search_path=${this.schema}` });
    this.#pool.on('error', () => undefined);
    this.#client = await this.#pool.connect();
    const db = pgDb({ writeUrl: this.url, readUrl: this.url }, { callerClient: this.#client });
    this.#deps = fakeDeps({ db, config: { lockKey: this.lockKey, supabaseUrl: `http://db-mode.${this.schema}` } });
    const tables = (await this.q<{ tablename: string }>(SCHEMA_TABLES_SQL, [this.schema])).map((row) => row.tablename);
    this.#sumSql = checksumSql(tables);
    return this.#client;
  }

  async begin(): Promise<void> {
    await this.#connect();
    if (this.#open) return;
    await this.q('begin');
    this.#open = true;
  }

  async run(req: Parameters<MirrorBackend['run']>[0], calls: ReadonlyMap<string, CallEntry>) {
    let run = this.#runs.get(calls);
    if (!run) {
      run = createRunCall({ calls });
      this.#runs.set(calls, run);
    }
    await this.q(AS_SERVER);
    const started = performance.now();
    try {
      return await run(this.#deps!, req);
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

  /** The leak guard (TM 5, point 4): no row of any test is left. Then the connection closes. */
  async close(): Promise<void> {
    if (!this.#client) return;
    const { n, ms } = this.#calls;
    console.info(`db mode: ${n} calls on the database in ${this.schema}, ${n > 0 ? (ms / n).toFixed(1) : 0} ms a call in runCall.`);
    try {
      await this.rollback();
      const expected = this.#ownBaseline ?? this.baseline;
      const now = await this.checksum();
      if (expected !== undefined && now !== expected) {
        throw new Error(`db mode, leak guard: the schema ${this.schema} holds rows that a test committed outside its transaction.`);
      }
    } finally {
      this.#client.release();
      await this.#pool!.end();
      this.#client = undefined;
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
  const worker = new Worker();
  useDbTestApi((calls, state) => createDbApi(calls, state, worker.backend));

  beforeEach((ctx) => {
    const reason = skipReason(ctx.task.file.filepath, fullName(ctx.task));
    if (reason) ctx.skip(`db mode: ${reason}`);
  });

  afterEach(async () => {
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
