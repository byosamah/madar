import type { Deps } from '../core/ports';
import { JOB_STEPS, runJob, type JobReport, type JobStep } from '../jobs/run';

/**
 * The 15-minute job of the office object (exit wave 3): the steps of server/jobs/run.ts, in the same order, on the SQLite Db.
 * The usage step reads the size of every file version (no index helps; map of writes, section 18), so it runs only in the first
 * run of each hour: 24 runs a day in place of 96.
 */
export const HOURLY_STEPS: ReadonlySet<string> = new Set(['usage']);

export function officeSteps(at: Date): readonly JobStep[] {
  return JOB_STEPS.filter((step) => !HOURLY_STEPS.has(step.name) || at.getUTCMinutes() < 15);
}

export function runOfficeJobs(deps: Deps, at: Date): Promise<JobReport> {
  return runJob(deps, at, officeSteps(at));
}
