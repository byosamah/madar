import { DatabaseSync } from 'node:sqlite';
import { liteDb, type LiteDb } from './db';
import { nodeHost } from './host';
import { applyLiteSchema } from './schema';

/** A new in-memory office with the SQLite schema, for the tests of the SQLite path. log gets the text of each later statement. */
export async function freshLite(): Promise<{ raw: DatabaseSync; db: LiteDb; log: string[] }> {
  const raw = new DatabaseSync(':memory:');
  const log: string[] = [];
  const host = nodeHost(raw, { log });
  await applyLiteSchema(host);
  log.length = 0;
  return { raw, db: liteDb(host), log };
}
