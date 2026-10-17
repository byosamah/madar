import { ApiError } from '../../src/api/errors';
import { isLite } from '../data/dialect';
import type { Deps, Query } from './ports';

/**
 * The office lock (plan 4.5, step 5.2; task C3). Every write runs under one transaction advisory lock for the office, so the
 * counters stay gap-free and a call never sees half of another call's change. The key comes from config: in tests, one key
 * for each worker schema (TM R6).
 *
 * pgDb sets "lock_timeout = 5s" inside each write transaction (Supavisor drops session settings, proof.md Z0a item 4). A lock
 * wait over that limit gives Postgres error 55P03, which becomes failed with the reason busy: the screen says the office is busy
 * and offers Retry. The transaction form of the lock ends with the commit or the rollback; the session form is refused by pgDb.
 */

export const LOCK_SQL = 'select pg_advisory_xact_lock($1::bigint)';
/** Postgres "lock_not_available": the lock_timeout ran out. */
export const LOCK_TIMEOUT_CODE = '55P03';
/** A call that held the lock longer than this logs a warning. */
export const SLOW_LOCK_MS = 500;

/** The busy refusal for a lock timeout, or undefined for any other error. */
export function busyOf(error: unknown): ApiError | undefined {
  if (typeof error !== 'object' || error === null || (error as { code?: unknown }).code !== LOCK_TIMEOUT_CODE) return undefined;
  return new ApiError('failed', 'The office is busy. Try again in a moment.', { reason: 'busy' });
}

export async function takeOfficeLock(q: Query, key: number): Promise<void> {
  // The office object runs one transaction at a time, and its Db refuses a second one (server/data/lite/db.ts): no lock there.
  if (isLite(q)) return;
  try {
    await q(LOCK_SQL, [key]);
  } catch (error) {
    throw busyOf(error) ?? error;
  }
}

export function logLockHold(deps: Pick<Deps, 'log' | 'config'>, name: string, ms: number): void {
  const fields = { name, ms, region: deps.config.region };
  if (ms > SLOW_LOCK_MS) deps.log.warn('The call held the office lock for a long time.', fields);
  else deps.log.info('The call held the office lock.', fields);
}
