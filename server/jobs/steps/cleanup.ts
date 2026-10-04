import type { Deps, Query } from '../../core/ports';
import { OFFICE_DELETES_KEEP_DAYS } from '../../data/officeCache';

/**
 * Step 4 of the 15-minute job (plan 5.5): the server tables that only grow lose their old rows, in one write transaction.
 *
 *   stories          7 days (a story Undo works for 7 days, plan 4.9)
 *   idempotency      24 hours (plan 4.10)
 *   office_deletes   OFFICE_DELETES_KEEP_DAYS (7 days); the office cache loads everything again after KEEP_DAYS - 1 days, so it
 *                    never misses a delete (server/data/officeCache.ts)
 *   rate_limits      1 day after the start of the window
 *
 * The upload intents and their objects have their own step (uploads.ts). The times come from the run, so a test can move them.
 */

const DAY = 24 * 60 * 60 * 1000;
export const STORY_KEEP_MS = 7 * DAY;
export const IDEMPOTENCY_KEEP_MS = DAY;
export const RATE_LIMIT_KEEP_MS = DAY;

const deleting = (from: string, column: string) => `with gone as (delete from ${from} where ${column} < $1 returning 1) select count(*)::integer as n from gone`;
export const STORIES_CLEANUP_SQL = deleting('stories', 'created_at');
export const IDEMPOTENCY_CLEANUP_SQL = deleting('idempotency', 'created_at');
export const OFFICE_DELETES_CLEANUP_SQL = deleting('office_deletes', 'created_at');
export const RATE_LIMITS_CLEANUP_SQL = deleting('rate_limits', 'window_start');

export type CleanupResult = { stories: number; idempotency: number; officeDeletes: number; rateLimits: number };

async function count(q: Query, text: string, before: Date): Promise<number> {
  const [row] = await q<{ n: number }>(text, [before]);
  return Number(row?.n ?? 0);
}

export async function cleanup(deps: Pick<Deps, 'db'>, at: Date): Promise<CleanupResult> {
  const before = (ms: number) => new Date(at.getTime() - ms);
  return deps.db.tx('write', async (q) => ({
    stories: await count(q, STORIES_CLEANUP_SQL, before(STORY_KEEP_MS)),
    idempotency: await count(q, IDEMPOTENCY_CLEANUP_SQL, before(IDEMPOTENCY_KEEP_MS)),
    officeDeletes: await count(q, OFFICE_DELETES_CLEANUP_SQL, before(OFFICE_DELETES_KEEP_DAYS * DAY)),
    rateLimits: await count(q, RATE_LIMITS_CLEANUP_SQL, before(RATE_LIMIT_KEEP_MS)),
  }));
}
