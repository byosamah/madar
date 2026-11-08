import { ApiError } from '../../src/api/errors';
import type { ServerHooks } from '../../src/api/registry';
import type { Db, Deps, Query } from '../core/ports';
import type { JobStep } from '../jobs/run';

/**
 * The storage of one enterprise (Madar enterprises, design 5.9). The limit counts the bytes of every version of every file record. The full
 * count reads one row for each file and each version (13,200 rows on the year office, proof.md), so the object keeps a running total in
 * enterprise_use.storage_bytes. The save step adds the change of each write (server/data/lite/save.ts), the finish of an import counts again,
 * and the daily step "storage" repairs a total that drifted. Feedback pictures are not counted: version 1 counts file records only.
 */

/** The sum of the version sizes of all file records. The step 15 of the schema uses the same text. */
export const RECOUNT_STORAGE_LITE = "select coalesce(sum(json_extract(v.value, '$.size')), 0) as n from files f, json_each(f.doc, '$.versions') v";

/** The bytes of one file record: the sum of its version sizes. A missing record has none. */
export function bytesOfFile(doc: { versions?: { size: number }[] } | undefined): number {
  return (doc?.versions ?? []).reduce((sum, version) => sum + (Number.isFinite(version.size) ? version.size : 0), 0);
}

/** Counts the bytes again from the file records and writes the total. Run it in a write transaction. */
export async function recountStorage(q: Query): Promise<number> {
  const [row] = await q<{ n: number }>(RECOUNT_STORAGE_LITE);
  const total = Number(row?.n ?? 0);
  await q('update enterprise_use set storage_bytes = ?1 where id = 1', [total]);
  return total;
}

/** The running total. 0 when the table has no row. */
export async function storageUsed(db: Pick<Db, 'statement'>): Promise<number> {
  const [row] = await db.statement<{ storage_bytes: number }>('read', 'select storage_bytes from enterprise_use where id = 1');
  return Number(row?.storage_bytes ?? 0);
}

/**
 * Refuses a file that goes above the limit: a size equal to the room passes, one byte more fails. null, and an object with no facts (the
 * Postgres path), never refuse.
 */
export async function assertStorageRoom(deps: Pick<Deps, 'db' | 'enterprise'>, size: number): Promise<void> {
  const limit = deps.enterprise?.limits().storageBytes ?? null;
  if (limit === null) return;
  if ((await storageUsed(deps.db)) + size > limit) {
    throw new ApiError('conflict', 'Your company has no more room for files. Ask the Madar team to raise the limit.', { reason: 'storage_limit', limit });
  }
}

/** settings.get for the Admin: the numbers behind the read-only lines of the Office settings (src/api/handlers/people.ts, settingsGet). */
export const settingsGetHooks: ServerHooks<unknown, unknown, Deps> = {
  async preflight(_input, { deps }) {
    if (!deps.enterprise) return undefined;
    const limits = deps.enterprise.limits();
    return { peopleLimit: limits.people, storageUsed: await storageUsed(deps.db), storageLimit: limits.storageBytes };
  },
};

/** The daily repair of the running total: the first run after 00:00 UTC (server/office/jobs.ts). */
export const STORAGE_STEP: JobStep = { name: 'storage', run: (deps) => deps.db.tx('write', (q) => recountStorage(q)) };
