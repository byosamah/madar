import type pg from 'pg';
import type { AnyCall, ServerHooks } from '../../src/api/registry';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import type { Deps } from '../core/ports';
import { serverCallMap, type CallEntry } from '../core/serverCallMap';
import type { BatchScope } from '../core/types';
import { pgDb, type PgDb } from '../data/sql';
import { writeState } from '../data/whole';
import { fakeDeps, type FakeDeps } from '../test/fakes/deps';
import { applyMigrations, dropSchema, localClient, localDbUrl } from './migrate';

/**
 * One office on the local stack for the runCall suites (task C3): the non-platform migrations in a schema of its own, the sample
 * office written as madar_server, and as many isolates as a test wants. Each isolate is its own pgDb (its own two connections)
 * with the fake ports; they share the office lock key and the office cache, as calls on one database do. It talks only to
 * 127.0.0.1 (server/it/migrate.ts).
 *
 * madar_server connects straight to Postgres with the schema in the startup options, as server/it/save.it.test.ts does.
 */

const SERVER_PASSWORD = 'madar-local-test';
export const TODAY = '2026-10-04';
export const NOW = new Date('2026-10-04T06:00:00Z');

export type ItOffice = {
  schema: string;
  seed: State;
  lockKey: number;
  /** A new isolate: its own pgDb, the fake ports, this office's lock key and cache key. */
  isolate(): FakeDeps & { db: PgDb };
  /** One query as postgres, with the schema on the search path. */
  sql<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<R[]>;
  /** A client of its own as postgres, with the schema on the search path: to hold the office lock from outside. */
  client(): Promise<pg.Client>;
  close(): Promise<void>;
};

export const newBatch = (): BatchScope => ({ storyRefs: new Map(), overviewCalls: 0 });

/** The call map with one shared call replaced (same name, so the same loader). */
export function mapWith(name: string, def: AnyCall, hooks?: ServerHooks<unknown, unknown, Deps>): ReadonlyMap<string, CallEntry> {
  const map = new Map(serverCallMap);
  map.set(name, { kind: 'shared', name, def, input: def.input, readOnly: def.readOnly === true, ...(hooks ? { hooks } : {}) });
  return map;
}

export async function startOffice(name: string): Promise<ItOffice> {
  const schema = `madar_c3_${name}_${process.pid}`;
  const lockKey = 7_330_000 + (process.pid % 10_000);
  const admin = await localClient();
  await applyMigrations(admin, schema);
  await admin.query(`alter role madar_server login password '${SERVER_PASSWORD}'`);
  const url = new URL(localDbUrl());
  url.username = 'madar_server';
  url.password = SERVER_PASSWORD;
  url.searchParams.set('options', `-c search_path=${schema}`);
  const dbs: PgDb[] = [];
  const clients: pg.Client[] = [];
  const seed = await buildSeed(TODAY, async () => undefined);

  const isolate = () => {
    const db = pgDb({ writeUrl: url.toString(), readUrl: url.toString() });
    dbs.push(db);
    const deps = fakeDeps({ db, config: { lockKey, supabaseUrl: `http://it.${schema}` } });
    deps.clock.set(NOW);
    return deps as FakeDeps & { db: PgDb };
  };
  const first = isolate();
  await first.db.tx('write', (q) => writeState(q, seed));

  return {
    schema,
    seed,
    lockKey,
    isolate,
    async sql<R>(text: string, values?: unknown[]) {
      await admin.query(`set search_path to ${schema}`);
      return (await admin.query(text, values)).rows as R[];
    },
    async client() {
      const client = await localClient();
      await client.query(`set search_path to ${schema}`);
      clients.push(client);
      return client;
    },
    async close() {
      for (const client of clients) await client.end().catch(() => undefined);
      for (const db of dbs) await db.close().catch(() => undefined);
      await admin.query('alter role madar_server nologin password null');
      await dropSchema(admin, schema);
      await admin.end();
    },
  };
}
