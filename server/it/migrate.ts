import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';

/**
 * The local stack for the database tests (plan 7.2, 7.3). Every test that uses it refuses any host except 127.0.0.1 and
 * localhost, so a test never reaches a cloud project.
 */
export const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);

export function localDbUrl(): string {
  const url = process.env.MADAR_LOCAL_DB_URL ?? LOCAL_DB_URL;
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`The database tests run only on the local stack, not on ${host}.`);
  return url;
}

/** A client of the local database, as postgres unless the URL says otherwise. */
export async function localClient(url = localDbUrl()): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/** The migration files in order. The harness leaves out the platform parts (*_platform_*.sql), as TM 5 says. */
export function migrationFiles(o: { platform: boolean }): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql') && (o.platform || !name.includes('_platform_')))
    .sort();
}

/** Makes an empty schema and applies the non-platform migrations into it, as the db-mode harness does for each worker. */
export async function applyMigrations(client: pg.Client, schema: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error(`Not a schema name: ${schema}`);
  await client.query(`drop schema if exists ${schema} cascade`);
  await client.query(`create schema ${schema}`);
  await client.query('begin');
  try {
    await client.query(`set local search_path to ${schema}`);
    for (const name of migrationFiles({ platform: false })) await client.query(readFileSync(new URL(name, MIGRATIONS), 'utf8'));
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export async function dropSchema(client: pg.Client, schema: string): Promise<void> {
  await client.query(`drop schema if exists ${schema} cascade`);
}
