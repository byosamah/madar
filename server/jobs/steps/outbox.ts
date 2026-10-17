import { processOutbox } from '../../core/effects';
import type { Deps } from '../../core/ports';
import { isLite } from '../../data/dialect';

/**
 * Step 3 of the 15-minute job (plan 4.12, 5.5): the effects that did not finish after their commit. It takes the open rows
 * (done_at null) with fewer than 5 attempts that are older than 2 minutes and not claimed now, oldest first, and runs them with
 * processOutbox, which claims each row with one statement before any work. A row that another worker claims in between is
 * skipped. A row that fails keeps its attempts and error, and usage.get shows it to the Admin (track M).
 */

export const OUTBOX_MAX_ATTEMPTS = 5;
/** The most rows one run takes, so one run stays short. The next run takes the rest. */
export const OUTBOX_BATCH = 100;
/** $1 the attempt limit, $2 the batch size. The primary: a read copy could be behind the claim. */
export const OUTBOX_DUE_SQL =
  "select id from outbox where done_at is null and attempts < $1 and created_at < now() - interval '2 minutes' "
  + 'and (claimed_until is null or claimed_until < now()) order by id limit $2';

/** SQLite (exit wave 3): the times come from the clock. id is the rowid, so "order by id" is the table order with no sort step. */
export const OUTBOX_DUE_LITE =
  'select id from outbox where done_at is null and attempts < ?1 and created_at < ?3 and (claimed_until is null or claimed_until < ?4) order by id limit ?2';

export async function outboxRetry(deps: Deps): Promise<{ due: number; done: number; failed: number }> {
  const now = deps.clock.now();
  const rows = isLite(deps.db)
    ? await deps.db.statement<{ id: string | number }>('write', OUTBOX_DUE_LITE, [OUTBOX_MAX_ATTEMPTS, OUTBOX_BATCH, new Date(now.getTime() - 2 * 60_000).toISOString(), now.toISOString()])
    : await deps.db.statement<{ id: string | number }>('write', OUTBOX_DUE_SQL, [OUTBOX_MAX_ATTEMPTS, OUTBOX_BATCH]);
  const ids = rows.map((row) => String(row.id));
  if (ids.length === 0) return { due: 0, done: 0, failed: 0 };
  const result = await processOutbox(deps, ids);
  return { due: ids.length, done: result.done.length, failed: result.failed.length };
}
