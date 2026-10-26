import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { State } from '../../src/api/store';
import type { AuthAdmin } from '../auth/admin';
import { liteAuthAdmin } from '../auth/own/liteAdmin';
import type { RunCall } from '../core/runCall';
import type { CallEntry } from '../core/serverCallMap';
import { liteData } from '../data/lite/callData';
import { liteDb, type LiteDb } from '../data/lite/db';
import { nodeHost } from '../data/lite/host';
import { writeOfficeSnapshot } from '../data/lite/office';
import { insertRow } from '../data/lite/save';
import { applyLiteSchema, EVENT_GUARDS, eventGuardsSql } from '../data/lite/schema';
import { liteLoadWhole } from '../data/lite/whole';
import type { MirrorBackend } from './dbApi';
import { downChanges } from './down';
import { runWithCode } from './confirmGuard';
import { fakeDeps, type FakeDeps } from './fakes/deps';
import type { Gate } from './gate';
import type { WorkerStats } from './speed';

/**
 * The SQLite mirror backend of test:lite (Supabase exit, wave 1): the rule tests of src/api and the shadow run on node:sqlite,
 * with no Docker. Each test gets a new in-memory office with the schema; the end of the test throws it away, so there is no test
 * transaction, no worker schema and no leak guard. dbApi.ts, shadow.ts and invariants.ts stay as they are.
 */

/** The server calls that have no SQLite form yet: none since waves 2 and 3. A new server call with no SQLite form fails test:lite. */
export const LATER_CALLS: ReadonlySet<string> = new Set();
/** The effect kinds that have no SQLite form yet: none since wave 2. A new kind with no SQLite form fails test:lite. */
export const LATER_KINDS: ReadonlySet<string> = new Set();

/** The words of the host refusal of a Postgres text (server/data/lite/host.ts): a caller with no SQLite form yet. */
const NO_FORM = 'Give the caller a SQLite form';

/** One checksum over the rows of every table, in table name and rowid order. */
export function liteChecksum(raw: DatabaseSync): string {
  const hash = createHash('sha256');
  const tables = raw.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as { name: string }[];
  for (const { name } of tables) {
    hash.update(`${name}:`);
    for (const row of raw.prepare(`select * from "${name}" order by rowid`).all()) hash.update(JSON.stringify(row));
  }
  return hash.digest('hex');
}

/**
 * Writes the test's own edits with no rule check: the event guards go for the write and come back, and an office change raises
 * office_meta.version and writes the snapshot (the rule of server/data/lite/office.ts).
 */
export async function liteWriteDown(db: LiteDb, before: State, after: State): Promise<boolean> {
  const { tables, counters, removedCounters } = downChanges(before, after);
  if (tables.length === 0 && Object.keys(counters).length === 0 && removedCounters.length === 0) return false;
  try {
    await db.tx('write', async (q) => {
      const old = tables.some((change) => change.touchesOld);
      if (old) for (const name of EVENT_GUARDS) db.host.exec(`drop trigger ${name}`, []);
      for (const change of tables) {
        for (const id of change.deleted) await q(`delete from ${change.spec.table} where id = ?`, [id]);
        for (const row of change.upserts) await insertRow(q, change.spec, row, after, 'update');
      }
      for (const prefix of removedCounters) await q('delete from counters where prefix = ?', [prefix]);
      for (const [prefix, n] of Object.entries(counters)) await q('insert into counters (prefix, n) values (?, ?) on conflict (prefix) do update set n = excluded.n', [prefix, n]);
      if (tables.some((change) => change.spec.office)) {
        const [meta] = await q<{ version: number }>('update office_meta set version = version + 1 where id = 1 returning version');
        await writeOfficeSnapshot(q, after, Number(meta.version));
      }
      if (old) for (const text of eventGuardsSql()) db.host.exec(text, []);
    });
  } catch (error) {
    throw new Error(`lite mode: the test's own edits break a database rule, so they cannot go to the database: ${error instanceof Error ? error.message : String(error)}`);
  }
  return true;
}

/** The fakes of a test office, with the Auth admin port over the sign-in rows of that office (Supabase exit, wave 2). */
type LiteDeps = Omit<FakeDeps, 'authAdmin'> & { authAdmin: AuthAdmin };

export class LiteWorker {
  readonly #stats: string | undefined;
  #raw?: DatabaseSync;
  #db?: LiteDb;
  #deps?: LiteDeps;
  #runs = new WeakMap<ReadonlyMap<string, CallEntry>, RunCall>();
  #calls: WorkerStats = { n: 0, ms: 0 };
  readonly backend: MirrorBackend;

  constructor(o: { stats?: string } = {}) {
    this.#stats = o.stats;
    const worker = this;
    this.backend = {
      owner: undefined,
      begin: () => worker.begin(),
      writeDown: (before, after) => liteWriteDown(worker.db, before, after),
      run: (req, calls) => worker.run(req, calls),
      readBack: () => worker.db.tx('read', (q) => liteLoadWhole(q, { withEvents: true })),
      checksum: async () => liteChecksum(worker.raw),
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

  get raw(): DatabaseSync {
    if (!this.#raw) throw new Error('lite mode: the backend is used before its test office opened.');
    return this.#raw;
  }

  get db(): LiteDb {
    if (!this.#db) throw new Error('lite mode: the backend is used before its test office opened.');
    return this.#db;
  }

  get deps(): LiteDeps {
    if (!this.#deps) throw new Error('lite mode: the backend is used before its test office opened.');
    return this.#deps;
  }

  /** A backend for one mirror, behind the test gate (as Worker.backendFor of server/test/db.ts). */
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

  /** Opens the office of a test, once: a new in-memory database with the schema, and new fakes. */
  async begin(): Promise<void> {
    if (this.#db) return;
    const raw = new DatabaseSync(':memory:');
    const host = nodeHost(raw);
    await applyLiteSchema(host);
    this.#raw = raw;
    this.#db = liteDb(host);
    const base = fakeDeps({ db: this.#db, config: { lockKey: 0, supabaseUrl: 'http://lite-mode' } });
    this.#deps = { ...base, authAdmin: liteAuthAdmin({ db: this.#db, clock: base.clock }) };
  }

  async run(req: Parameters<MirrorBackend['run']>[0], calls: ReadonlyMap<string, CallEntry>) {
    let run = this.#runs.get(calls);
    if (!run) {
      // The server code loads with the first call, not with the setup file: a test file's vi.mock must reach it (as db.ts).
      const { createRunCall } = await import('../core/runCall');
      run = createRunCall({ calls, data: liteData });
      this.#runs.set(calls, run);
    }
    const from = this.deps.logs.length;
    const started = performance.now();
    try {
      const result = await runWithCode((one) => run(this.deps, one), req, this.deps.mail.sent);
      // A text with no SQLite form fails inside runCall or inside an effect, and both log it: a call or kind of a later wave may.
      const missing = this.deps.logs.slice(from).filter((line) => {
        const text = `${line.message} ${String(line.fields?.error ?? '')}`;
        if (!text.includes(NO_FORM)) return false;
        return !LATER_KINDS.has(String(line.fields?.kind)) && !LATER_CALLS.has(req.name);
      });
      if (missing.length > 0) throw new Error(`lite mode: ${req.name} sent a text with no SQLite form: ${String(missing[0].fields?.error ?? missing[0].message)}`);
      return result;
    } finally {
      this.#calls.n += 1;
      this.#calls.ms += performance.now() - started;
    }
  }

  /** The end of a test: the office goes, with every row of the test. */
  end(): void {
    this.backend.owner = undefined;
    this.#raw?.close();
    this.#raw = undefined;
    this.#db = undefined;
    this.#deps = undefined;
  }

  /** The end of the file: the call count and time go into the run folder for the speed gate. */
  close(): void {
    this.end();
    if (this.#stats) writeFileSync(join(this.#stats, `lite-${randomUUID()}.json`), JSON.stringify(this.#calls));
  }
}
