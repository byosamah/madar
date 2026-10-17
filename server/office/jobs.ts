import { cleanupSignin } from '../auth/own/cleanup';
import type { Deps } from '../core/ports';
import { JOB_STEPS, runJob, type JobReport, type JobStep } from '../jobs/run';

/**
 * The 15-minute job of the office object (exit wave 3): the steps of server/jobs/run.ts, in the same order, on the SQLite Db.
 * The usage step reads the size of every file version (no index helps; map of writes, section 18), so it runs only in the first
 * run of each hour: 24 runs a day in place of 96. The first run after 00:00 UTC also deletes the old sign-in rows (exit wave 2).
 */
export const HOURLY_STEPS: ReadonlySet<string> = new Set(['usage']);

/** The links, OAuth requests and sessions that ended more than a day ago (server/auth/own/cleanup.ts), once a day. */
export const SIGNIN_STEP: JobStep = { name: 'signin', run: (deps, at) => deps.db.tx('write', (q) => cleanupSignin(q, at)) };

const firstRunOfDay = (at: Date) => at.getUTCHours() === 0 && at.getUTCMinutes() < 15;

export function officeSteps(at: Date): readonly JobStep[] {
  const steps = JOB_STEPS.filter((step) => !HOURLY_STEPS.has(step.name) || at.getUTCMinutes() < 15);
  return firstRunOfDay(at) ? [...steps, SIGNIN_STEP] : steps;
}

export function runOfficeJobs(deps: Deps, at: Date): Promise<JobReport> {
  return runJob(deps, at, officeSteps(at));
}
