import type { TestProject } from 'vitest/node';
import { LOCAL_DB_URL, applyMigrations, dropSchema, localClient } from '../it/migrate';
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

export type ProvidedDb = { url: string; baselines: Record<string, string> };

declare module 'vitest' {
  export interface ProvidedContext {
    madarDb: ProvidedDb;
  }
}

type Env = Record<string, string | undefined>;
type SqlClient = Awaited<ReturnType<typeof localClient>>;

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** The database of the harness: DATABASE_URL, else MADAR_LOCAL_DB_URL, else the local stack. Only a local host passes. */
export function harnessDbUrl(env: Env = process.env): string {
  const url = env.DATABASE_URL || env.MADAR_LOCAL_DB_URL || LOCAL_DB_URL;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('The database URL of the db-mode tests does not parse.');
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`The db-mode tests run only on the local stack (127.0.0.1 or localhost), not on ${host}.`);
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

export async function prepareSchemas(o: {
  env: Env;
  workers: number;
  connect: (url: string) => Promise<SqlClient>;
}): Promise<ProvidedDb & { schemas: string[]; client: SqlClient; granted: boolean }> {
  const url = harnessDbUrl(o.env);
  const client = await o.connect(url);
  const schemas: string[] = [];
  const baselines: Record<string, string> = {};
  let granted = false;
  try {
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
  return { url, baselines, schemas, client, granted };
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const workers = Number(project.config.maxWorkers) || 1;
  const prepared = await prepareSchemas({ env: process.env, workers, connect: (url) => localClient(url) });
  project.provide('madarDb', { url: prepared.url, baselines: prepared.baselines });
  return async () => {
    const { client } = prepared;
    try {
      for (const schema of prepared.schemas) await dropSchema(client, schema);
      if (prepared.granted) await client.query('revoke madar_server from current_user');
    } finally {
      await client.end();
    }
  };
}
