import { nowStamp } from '../../../src/lib/dates';
import { isWorkingDay } from '../../../src/lib/workdays';
import type { Deps } from '../../core/ports';
import { sqlFor } from '../../data/dialect';
import { MailSendError } from '../../mail/resend';
import { sendSummary, summaryPeople, type SummaryOutcome } from '../../mail/summary';

/**
 * Step 2 of the 15-minute job (plan 5.5): the morning summary of N2 (server/mail/summary.ts). From 07:30 Riyadh on a working
 * day (Sunday to Thursday), while job_runs has no "summary:<day>" row, it mails each active human whose Morning summary is on
 * or never set. The job_runs row is written only when no send failed, so a failed send is tried again on the next run.
 * A send that Resend refuses for good (a MailSendError that is not retryable, such as the 403 while no domain is verified, or a
 * 422) is a final outcome: the step counts it as refused, warns, and still closes the day, so a send that can never work does not
 * keep the step failing (and POST /jobs/run answering 500) until midnight.
 *
 * A person whose summary already went out (its mail_log row has a Resend id) is skipped, so a run after a partial failure sends
 * nothing twice. The idempotency key summary-<day>-<person> also keeps one place in the quota and one mail in Resend.
 */

export const SUMMARY_START = '07:30';
/** $1 "summary:<day>". */
export const SUMMARY_DONE_SQL = 'select done_at from job_runs where key = $1';
/** $1 "summary:<day>", $2 the time of the run. */
export const SUMMARY_MARK_SQL = 'insert into job_runs (key, done_at) values ($1, $2) on conflict (key) do nothing';
/** $1 the refs (idempotency keys) of the summaries of the day. The ones that went out. */
export const SUMMARY_SENT_SQL = 'select ref from mail_log where ref = any($1::text[]) and resend_id is not null';

// SQLite forms (exit wave 3).
export const SUMMARY_DONE_LITE = 'select done_at from job_runs where key = ?1';
export const SUMMARY_MARK_LITE = 'insert into job_runs (key, done_at) values (?1, ?2) on conflict (key) do nothing';
export const SUMMARY_SENT_LITE = 'select ref from mail_log where ref in (select value from json_each(?1)) and resend_id is not null';

/** The Riyadh day whose summary is due at this time, or null before 07:30 and on Friday and Saturday. */
export function summaryDay(at: Date): string | null {
  const stamp = nowStamp(at);
  const day = stamp.slice(0, 10);
  return isWorkingDay(day) && stamp.slice(11, 16) >= SUMMARY_START ? day : null;
}

export type SummaryStep =
  | { due: false }
  | { due: true; day: string; done: true }
  | ({ due: true; day: string; already: number; refused: number } & Record<SummaryOutcome, number>);

const refOf = (day: string, userId: string) => `summary-${day}-${userId}`;

export async function summary(deps: Deps, at: Date): Promise<SummaryStep> {
  const day = summaryDay(at);
  if (day === null) return { due: false };
  const key = `summary:${day}`;
  if ((await deps.db.statement('write', sqlFor(deps.db, SUMMARY_DONE_SQL, SUMMARY_DONE_LITE), [key])).length > 0) return { due: true, day, done: true };
  const people = await deps.db.tx('read', (q) => summaryPeople(q));
  const sent = new Set(
    (await deps.db.statement<{ ref: string }>('write', sqlFor(deps.db, SUMMARY_SENT_SQL, SUMMARY_SENT_LITE), [people.map((id) => refOf(day, id))])).map((row) => row.ref),
  );
  const counts: Record<SummaryOutcome, number> = { sent: 0, empty: 0, over: 0, skipped: 0 };
  let already = 0;
  let refused = 0;
  let failed = 0;
  for (const userId of people) {
    if (sent.has(refOf(day, userId))) {
      already += 1;
      continue;
    }
    try {
      counts[await sendSummary(deps, userId, day)] += 1;
    } catch (error) {
      if (error instanceof MailSendError && !error.retryable) {
        refused += 1;
        deps.log.warn('Resend refused a morning summary for good. No run sends it again today.', { userId, code: error.code, status: error.status });
        continue;
      }
      failed += 1;
      deps.log.warn('A morning summary did not go out. The next run tries again.', { userId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (failed > 0) throw new Error(`The morning summary did not reach ${failed} ${failed === 1 ? 'person' : 'people'}. The next run tries again.`);
  await deps.db.statement('write', sqlFor(deps.db, SUMMARY_MARK_SQL, SUMMARY_MARK_LITE), [key, at]);
  return { due: true, day, ...counts, refused, already };
}
