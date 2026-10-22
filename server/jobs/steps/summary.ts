import { nowStamp } from '../../../src/lib/dates';
import { workStartOn } from '../../../src/lib/quietHours';
import type { Deps } from '../../core/ports';
import { sqlFor } from '../../data/dialect';
import { MailSendError } from '../../mail/resend';
import { sendSummary, summaryRoster, type SummaryOutcome } from '../../mail/summary';

/**
 * Step 2 of the 15-minute job (plan 5.5): the morning summary of N2 (server/mail/summary.ts). It goes to each active human whose Morning
 * summary is on or never set, at the start of the work hours of that person, on the work days of that person (quiet hours, owner
 * 2026-10-22, fbk_048; before, it was 07:30 for everyone on Sunday to Thursday). The first run of the job at or after the start sends it.
 * A person with quiet hours off still has a range: the stored one, else the office default.
 *
 * A job_runs row "summary:<day>:<person>" closes one person for one day. It is written when the outcome is final: sent, nothing to say,
 * the notice limit of the day, turned off, or a send that Resend refuses for good (a MailSendError that is not retryable, such as the
 * 403 while no domain is verified, or a 422), so a send that can never work does not keep the step failing until midnight. A failed
 * send writes no row, and the next run tries that person again.
 *
 * A person whose summary already went out (its mail_log row has a Resend id) is skipped, so a run after a partial failure sends
 * nothing twice. The idempotency key summary-<day>-<person> also keeps one place in the quota and one mail in Resend.
 */

/**
 * $1 "summary:<day>%". The marks of that day: one for each person who is done ("summary:<day>:<person>"), and the mark of the old form
 * ("summary:<day>", written by the step before 2026-10-22 when it had sent the whole day). The old mark closes the day for everyone, so a
 * release in the middle of a day, or an import of an old office, never sends a second summary.
 */
export const SUMMARY_DONE_SQL = 'select key from job_runs where key like $1';
/** $1 "summary:<day>:<person>", $2 the time of the run. */
export const SUMMARY_MARK_SQL = 'insert into job_runs (key, done_at) values ($1, $2) on conflict (key) do nothing';
/** $1 the refs (idempotency keys) of the summaries of the day. The ones that went out. */
export const SUMMARY_SENT_SQL = 'select ref from mail_log where ref = any($1::text[]) and resend_id is not null';

// SQLite forms (exit wave 3).
export const SUMMARY_DONE_LITE = 'select key from job_runs where key like ?1';
export const SUMMARY_MARK_LITE = 'insert into job_runs (key, done_at) values (?1, ?2) on conflict (key) do nothing';
export const SUMMARY_SENT_LITE = 'select ref from mail_log where ref in (select value from json_each(?1)) and resend_id is not null';

export type SummaryStep =
  | { due: false }
  | { due: true; day: string; done: true }
  | ({ due: true; day: string; already: number; refused: number } & Record<SummaryOutcome, number>);

const refOf = (day: string, userId: string) => `summary-${day}-${userId}`;
const markOf = (day: string, userId: string) => `summary:${day}:${userId}`;

export async function summary(deps: Deps, at: Date): Promise<SummaryStep> {
  const stamp = nowStamp(at);
  const day = stamp.slice(0, 10);
  const time = stamp.slice(11, 16);
  const roster = await deps.db.tx('read', (q) => summaryRoster(q));
  // The people whose work hours have started today, on a work day of theirs.
  const started = roster.filter((one) => {
    const start = workStartOn(one.person, one.settings, day);
    return start !== null && time >= start;
  });
  if (started.length === 0) return { due: false };
  const closed = new Set(
    (await deps.db.statement<{ key: string }>('write', sqlFor(deps.db, SUMMARY_DONE_SQL, SUMMARY_DONE_LITE), [`summary:${day}%`])).map((row) => row.key),
  );
  if (closed.has(`summary:${day}`)) return { due: true, day, done: true };
  const people = started.map((one) => one.id).filter((id) => !closed.has(markOf(day, id)));
  if (people.length === 0) return { due: true, day, done: true };
  const sent = new Set(
    (await deps.db.statement<{ ref: string }>('write', sqlFor(deps.db, SUMMARY_SENT_SQL, SUMMARY_SENT_LITE), [people.map((id) => refOf(day, id))])).map((row) => row.ref),
  );
  const mark = (userId: string) => deps.db.statement('write', sqlFor(deps.db, SUMMARY_MARK_SQL, SUMMARY_MARK_LITE), [markOf(day, userId), at]);
  const counts: Record<SummaryOutcome, number> = { sent: 0, empty: 0, over: 0, skipped: 0 };
  let already = 0;
  let refused = 0;
  let failed = 0;
  for (const userId of people) {
    if (sent.has(refOf(day, userId))) {
      already += 1;
      await mark(userId);
      continue;
    }
    try {
      counts[await sendSummary(deps, userId, day)] += 1;
      await mark(userId);
    } catch (error) {
      if (error instanceof MailSendError && !error.retryable) {
        refused += 1;
        deps.log.warn('Resend refused a morning summary for good. No run sends it again today.', { userId, code: error.code, status: error.status });
        await mark(userId);
        continue;
      }
      failed += 1;
      deps.log.warn('A morning summary did not go out. The next run tries again.', { userId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (failed > 0) throw new Error(`The morning summary did not reach ${failed} ${failed === 1 ? 'person' : 'people'}. The next run tries again.`);
  return { due: true, day, ...counts, refused, already };
}
