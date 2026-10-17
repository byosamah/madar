import { takeOfficeLock } from '../../core/lock';
import { writeOutbox } from '../../core/effects';
import { sqlKeys } from '../../core/idempotency';
import type { Deps } from '../../core/ports';
import type { CallData } from '../../core/runCall';
import { sqlStories } from '../../core/story';
import { isLite } from '../dialect';
import type { LiteDb } from './db';
import { readLiteOffice } from './office';
import { liteSave } from './save';
import { liteSource } from './source';

/**
 * The data of a call on the SQLite Db of deps (Supabase exit, wave 1): the CallData of createRunCall, as sqlData is for
 * Postgres (server/core/runCall.ts). runCall.ts does not change: the office object and test:lite pass createRunCall({ data:
 * liteData }). The stores (stories, keys, outbox) pick their SQLite text by the dialect of the query.
 */
export function liteData(deps: Deps): CallData {
  if (!isLite(deps.db)) throw new Error('liteData needs the SQLite Db of the office (server/data/lite/db.ts).');
  const db = deps.db as LiteDb;
  return {
    tx: (mode, work) =>
      db.tx(mode, (q) =>
        work({
          q,
          lock: (key) => takeOfficeLock(q, key),
          office: () => readLiteOffice(db, q),
          source: () => liteSource(q),
          save: (before, after, o) => liteSave(q, before, after, o),
          stories: sqlStories(q),
          keys: sqlKeys(q),
          outbox: (rows) => writeOutbox(q, rows),
        }),
      ),
    office: () => db.tx('read', (q) => readLiteOffice(db, q)),
  };
}
