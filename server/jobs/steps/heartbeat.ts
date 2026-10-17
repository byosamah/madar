import type { Deps } from '../../core/ports';
import { sqlFor } from '../../data/dialect';

/**
 * Step 0 of the 15-minute job (plan 5.5): the job_runs row "heartbeat" gets the time of the run. usage.get reads it as
 * jobsLastRun, and the usage panel shows an error when it is older than 30 minutes (track M). Two runs that overlap never move
 * it back.
 */
export const HEARTBEAT_SQL =
  "insert into job_runs (key, done_at) values ('heartbeat', $1) on conflict (key) do update set done_at = greatest(job_runs.done_at, excluded.done_at)";

/** SQLite (exit wave 3): max() of two ISO texts in UTC is the later time. */
export const HEARTBEAT_LITE =
  "insert into job_runs (key, done_at) values ('heartbeat', ?1) on conflict (key) do update set done_at = max(job_runs.done_at, excluded.done_at)";

export async function heartbeat(deps: Pick<Deps, 'db'>, at: Date): Promise<{ at: string }> {
  await deps.db.statement('write', sqlFor(deps.db, HEARTBEAT_SQL, HEARTBEAT_LITE), [at]);
  return { at: at.toISOString() };
}
