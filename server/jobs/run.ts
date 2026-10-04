import type { Deps } from '../core/ports';
import { cleanup } from './steps/cleanup';
import { heartbeat } from './steps/heartbeat';
import { outboxRetry } from './steps/outbox';
import { summary } from './steps/summary';
import { triggers } from './steps/triggers';
import { uploads } from './steps/uploads';
import { usage } from './steps/usage';

/**
 * The 15-minute job (plan 5.5; task N3.1). pg_cron calls POST /jobs/run (server/jobs/app.ts), which runs these steps in order,
 * all at the same time "at":
 *
 *   heartbeat   the job_runs row "heartbeat" (usage.get shows the last run)
 *   triggers    the due, overdue and restart reminders under the office lock, with their notice mail
 *   summary     the morning summary at 07:30 Riyadh on a working day
 *   outbox      the effects that did not finish after their commit
 *   cleanup     old stories, idempotency keys, office_deletes rows and rate limit windows
 *   uploads     every up/ object older than 2 hours 10 minutes, and the intent rows after 24 hours
 *   usage       the 80% warning
 *
 * Each step runs in its own transactions and is safe to run twice, so two runs that overlap do no harm. A step that fails is
 * logged and the next steps still run; the next run tries it again.
 */

export type JobStep = { name: string; run: (deps: Deps, at: Date) => Promise<unknown> };
export type StepReport = { name: string; ok: true; result: unknown } | { name: string; ok: false; error: string };
export type JobReport = { ok: boolean; at: string; steps: StepReport[] };

export const JOB_STEPS: readonly JobStep[] = [
  { name: 'heartbeat', run: heartbeat },
  { name: 'triggers', run: triggers },
  { name: 'summary', run: summary },
  { name: 'outbox', run: (deps) => outboxRetry(deps) },
  { name: 'cleanup', run: cleanup },
  { name: 'uploads', run: uploads },
  { name: 'usage', run: (deps) => usage(deps) },
];

export async function runJob(deps: Deps, at: Date = deps.clock.now(), steps: readonly JobStep[] = JOB_STEPS): Promise<JobReport> {
  const reports: StepReport[] = [];
  for (const step of steps) {
    try {
      reports.push({ name: step.name, ok: true, result: await step.run(deps, at) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.log.error('A job step failed. The next run tries it again.', { step: step.name, error: message });
      reports.push({ name: step.name, ok: false, error: message });
    }
  }
  return { ok: reports.every((report) => report.ok), at: at.toISOString(), steps: reports };
}
