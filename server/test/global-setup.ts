import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { LOCAL_DB_URL, applyMigrations, localClient } from '../it/migrate';
import { checksumOf } from './invariants';

/**
 * The global setup of the db project (plan 7.2; TM 5; task D1). As postgres, it drops and makes one schema for each test worker
 * (madar_w1, madar_w2, ...) and applies the non-platform migrations into it with server/it/migrate.ts, which holds the advisory
 * lock that keeps two appliers apart. It gives the workers the database URL and the checksum of each fresh schema, so the leak
 * guard of server/test/db.ts can prove that no test committed a row.
 *
 * It refuses any database host except 127.0.0.1 and localhost before it opens a connection, so a DATABASE_URL of a cloud project
 * never receives a statement.
 *
 * The calls run as madar_server, as on the real server. The worker connection signs in as postgres (the setup role, which writes
 * the test's own edits, also to events) and switches with "set local role madar_server" for each call. So postgres needs the SET
 * right on madar_server; the setup grants it and the teardown takes it back.
 */

/**
 * run: the id of this test run, so a worker can tell a schema an earlier file of the same run made from a schema of another run.
 * stats: the run folder, where each test file writes its call count and time for the speed gate (WorkerStats).
 */
export type ProvidedDb = { url: string; baselines: Record<string, string>; run: string; stats?: string };

declare module 'vitest' {
  export interface ProvidedContext {
    madarDb: ProvidedDb;
  }
}

type Env = Record<string, string | undefined>;
type SqlClient = Awaited<ReturnType<typeof localClient>>;

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * The database of the harness: DATABASE_URL, else MADAR_LOCAL_DB_URL, else the local stack. Only a local host passes. pg takes
 * every query parameter of the URL into its settings, and a host or hostaddr parameter wins over the host of the URL, so a URL
 * with one of those never passes.
 */
export function harnessDbUrl(env: Env = process.env): string {
  const url = env.DATABASE_URL || env.MADAR_LOCAL_DB_URL || LOCAL_DB_URL;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('The database URL of the db-mode tests does not parse.');
  }
  const hostParam = [...parsed.searchParams.keys()].find((key) => ['host', 'hostaddr'].includes(key.toLowerCase()));
  if (hostParam) {
    throw new Error(`The database URL of the db-mode tests has a ${hostParam} parameter, which pg uses over the host of the URL. Remove it.`);
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`The db-mode tests run only on the local stack (127.0.0.1 or localhost), not on ${parsed.hostname}.`);
  }
  return url;
}

/** The schema of one worker, from VITEST_POOL_ID. */
export function workerSchema(poolId: string | undefined): string {
  const id = poolId ?? '1';
  if (!/^\d{1,3}$/.test(id)) throw new Error(`Not a worker id: ${id}`);
  return `madar_w${id}`;
}

/** The office lock key of one worker schema (TM R6): advisory locks are for the database, so each worker needs its own key. */
export function workerLockKey(schema: string): number {
  return 7_400_000 + Number(schema.replace(/^madar_w/, ''));
}

/**
 * postgres may switch to madar_server: the SET right of PostgreSQL 16 and later, without the rights of madar_server.
 * True when this call granted it, so the teardown takes back only its own grant.
 */
export async function grantServerRole(client: SqlClient): Promise<boolean> {
  const [row] = (await client.query("select pg_has_role(current_user, 'madar_server', 'SET') as can")).rows as { can: boolean }[];
  if (row.can) return false;
  await client.query('grant madar_server to current_user with inherit false, set true');
  return true;
}

/** Every worker schema in the database, also the ones a killed run left or a worker made itself. */
const WORKER_SCHEMAS_SQL = "select nspname from pg_namespace where nspname ~ '^madar_w[0-9]+$' order by nspname";

async function dropWorkerSchemas(client: SqlClient): Promise<string[]> {
  const schemas = ((await client.query(WORKER_SCHEMAS_SQL)).rows as { nspname: string }[]).map((row) => row.nspname);
  if (schemas.length > 0) await client.query(`drop schema if exists ${schemas.join(', ')} cascade`);
  return schemas;
}

const RUN_ID = /^[0-9a-z_]+$/;

/**
 * The baseline checksum of a worker schema, for the leak guard of server/test/db.ts. A schema of the global setup has its
 * baseline in provided. A worker beyond those makes its own schema with its first file and notes the baseline on the schema
 * (a comment, which no table checksum sees); a later file of the same run reuses it. A schema of another run is made again.
 */
export async function workerBaseline(client: SqlClient, schema: string, provided: ProvidedDb | undefined): Promise<string> {
  const given = provided?.baselines[schema];
  if (given !== undefined) return given;
  const run = provided?.run ?? 'none';
  if (!RUN_ID.test(run)) throw new Error(`Not a run id: ${run}`);
  const prefix = `madar run ${run} baseline `;
  const [row] = (await client.query("select obj_description(oid, 'pg_namespace') as note from pg_namespace where nspname = $1", [schema])).rows as { note: string | null }[];
  if (row?.note?.startsWith(prefix)) return row.note.slice(prefix.length);
  await applyMigrations(client, schema);
  const sum = await checksumOf((text, values) => client.query(text, values).then((r) => r.rows), schema);
  if (!/^[0-9a-f]+$/.test(sum)) throw new Error(`Not a checksum: ${sum}`);
  await client.query(`comment on schema ${schema} is '${prefix}${sum}'`);
  return sum;
}

/** What one test file of a worker writes into the run folder when it closes (server/test/db.ts). */
export type WorkerStats = { n: number; ms: number; standIns?: number };

/** The gate of TM 4.1 and plan 7.2: the db job fails when the run takes more than 120 s, or a call more than 25 ms on average. */
const GATE_RUN_MS = 120_000;
const GATE_CALL_MS = 25;

/** Every stats file of the run folder. A file that does not hold the numbers fails the run, so the gate never reads a partial sum. */
export function readWorkerStats(dir: string): WorkerStats[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const stats = JSON.parse(readFileSync(join(dir, name), 'utf8')) as WorkerStats;
      if (typeof stats.n !== 'number' || typeof stats.ms !== 'number') throw new Error(`db mode: the stats file ${name} does not hold the numbers n and ms.`);
      return stats;
    });
}

/**
 * The one line of the speed gate, from the stats of every test file and the time of the whole run. In CI a run over the gate
 * fails. On the shared Mac it only warns: the load of the other tracks' work there can slow a run that is right.
 */
export function speedGate(stats: readonly WorkerStats[], runMs: number, o: { ci: boolean }): { line: string; failure?: string } {
  const n = stats.reduce((sum, one) => sum + one.n, 0);
  const ms = stats.reduce((sum, one) => sum + one.ms, 0);
  const standIns = stats.reduce((sum, one) => sum + (one.standIns ?? 0), 0);
  const perCall = n > 0 ? ms / n : 0;
  const seconds = Math.round(runMs / 1000);
  const over = [
    perCall > GATE_CALL_MS ? `${perCall.toFixed(1)} ms a call is over the gate of ${GATE_CALL_MS} ms` : '',
    runMs > GATE_RUN_MS ? `the run of ${seconds} s is over the gate of ${GATE_RUN_MS / 1000} s` : '',
  ].filter(Boolean);
  let line = `db mode: ${n} calls, ${perCall.toFixed(1)} ms a call in runCall, the run took ${seconds} s.`;
  if (standIns > 0) line += ` ${standIns} upload steps ran on the stand-ins of server/test/uploads.ts, until track F merges.`;
  if (over.length === 0) return { line };
  const failure = `db mode, speed gate (TM 4.1): ${over.join('; ')}.`;
  return o.ci ? { line, failure } : { line: `${line} Warning, over the gate (only CI fails on it): ${over.join('; ')}.` };
}

export async function prepareSchemas(o: {
  env: Env;
  workers: number;
  connect: (url: string) => Promise<SqlClient>;
}): Promise<ProvidedDb & { schemas: string[]; client: SqlClient; granted: boolean }> {
  const url = harnessDbUrl(o.env);
  const client = await o.connect(url);
  const schemas: string[] = [];
  const baselines: Record<string, string> = {};
  const run = randomUUID().replaceAll('-', '');
  let granted = false;
  try {
    // A run that was killed before its teardown leaves its schemas, with old migrations and maybe rows. None of them is reused.
    await dropWorkerSchemas(client);
    for (let id = 1; id <= Math.max(1, o.workers); id += 1) {
      const schema = workerSchema(String(id));
      await applyMigrations(client, schema);
      baselines[schema] = await checksumOf((text, values) => client.query(text, values).then((r) => r.rows), schema);
      schemas.push(schema);
    }
    granted = await grantServerRole(client);
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
  return { url, baselines, run, schemas, client, granted };
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const started = performance.now();
  const workers = Number(project.config.maxWorkers) || 1;
  const prepared = await prepareSchemas({ env: process.env, workers, connect: (url) => localClient(url) });
  const stats = mkdtempSync(join(tmpdir(), 'madar-db-stats-'));
  project.provide('madarDb', { url: prepared.url, baselines: prepared.baselines, run: prepared.run, stats });
  return async () => {
    const { client } = prepared;
    // Vitest shows the output of the global setup also in a plain run, so the line of the speed gate shows in CI.
    // A stats file that does not read fails the run, but only after the schemas went.
    let gate: ReturnType<typeof speedGate> | undefined;
    let unread: unknown;
    try {
      gate = speedGate(readWorkerStats(stats), performance.now() - started, { ci: Boolean(process.env.CI) });
      console.info(gate.line);
    } catch (error) {
      unread = error;
    } finally {
      rmSync(stats, { recursive: true, force: true });
    }
    try {
      if (prepared.granted) await client.query('revoke madar_server from current_user');
      // A connection that a broken test left open may hold a lock on its schema: wait a little, then say so.
      await client.query("set lock_timeout = '10s'");
      // A worker beyond the ones made here makes its own schema (server/test/db.ts), so the teardown drops every worker schema.
      const schemas = await dropWorkerSchemas(client);
      console.info(`db mode: dropped the worker schemas ${schemas.join(', ') || '(none)'}.`);
    } catch (error) {
      throw new Error(`db mode: the teardown could not drop the worker schemas (${error instanceof Error ? error.message : String(error)}). The next run drops them again.`);
    } finally {
      await client.end();
    }
    if (unread) throw unread;
    if (gate?.failure) throw new Error(gate.failure);
  };
}
