import { processOutbox, writeOutbox, type OutboxRow } from '../core/effects';
import type { Deps } from '../core/ports';
import { isLite, sqlFor } from '../data/dialect';
import { ADMIN_MAIL_SQL, adminsOf, appLink, litePerson, mailOf, mailable, type PersonRow } from '../mail/notices';
import { sendCounted, utcDay } from '../mail/quota';
import { USAGE_METERS, renderMail, type UsageMeter } from '../mail/templates';
import type { DayRow } from '../office/parts';
import { DAY_ROW_LITE, overLimit, readMeters, warningMeters, type Meter } from './meters';

/**
 * The 80% warning (plan 5.8; task M1). The 15-minute job (track N3) runs checkLimits after its other steps.
 *
 * - It reads the meters in a read transaction. Each meter at 80% or more gets one mark in usage_warnings for its UTC month,
 *   and only the transaction that adds the mark writes the warning rows: one usage.limitWarning outbox row for each active
 *   Admin. So a meter warns once a month, also when two runs overlap, and a new month warns again.
 * - The rows run right after the commit. The mail goes through the warning quota of N2 (98 a UTC day, server/mail/quota.ts)
 *   with the key limit-warning-<month>-<meter>-<userId>, so an effect that runs twice sends one mail. A send that fails, or that
 *   the quota stops, keeps its row for the job, and usage.get shows it to the Admin. A person who is no longer an Admin when the
 *   effect runs gets nothing.
 * - Each mail names one next step for its meter (the limitWarning template). While the files are on Supabase Storage, the
 *   storage meter counts against 1 GB and its next step is the move to R2 or removing old versions (plan 2b, point 1).
 */

export const LIMIT_WARNING_EFFECT = 'usage.limitWarning';

/** The person row with the system role: server/mail/notices.ts holds it for both warnings to the Admins. */
export { ADMIN_MAIL_SQL };

/** The error of a warning that the warning quota of today stopped. The row stays for the job and shows in Usage. */
export const WARNING_QUOTA_FULL = 'The warning quota of today is full.';

/** $1 the UTC month, $2 the meter. A row back means this run made the mark, and so it sends the warning. */
export const WARNING_MARK_SQL = 'insert into usage_warnings (month, metric) values ($1, $2) on conflict (month, metric) do nothing returning metric';

/** SQLite (exit wave 3). A day meter marks its UTC day in the month column, so it warns once a day. */
export const WARNING_MARK_LITE = 'insert into usage_warnings (month, metric) values (?1, ?2) on conflict (month, metric) do nothing returning metric';

/**
 * The Free day limits of the office path (developers.cloudflare.com, the Durable Objects and Workers pricing pages, read
 * 2026-10-17): rows read and written and requests of Durable Objects, and requests of Workers. Each ends at 00:00 UTC (03:00
 * Riyadh). They are limits of the account: the office object counts its own share, and wave 5 compares it with Cloudflare.
 */
export const DAY_LIMITS = { rowsReadDay: 5_000_000, rowsWrittenDay: 100_000, objectRequestsDay: 100_000, workerRequestsDay: 100_000 } as const;

/** One mark for each meter over 80% in its period, and the warning rows for each active Admin of the meters that this run marked. */
async function warnAdmins(deps: Deps, period: string, over: { meter: UsageMeter; value: Meter }[]): Promise<{ warned: UsageMeter[] }> {
  if (over.length === 0) return { warned: [] };
  const { warned, ids } = await deps.db.tx('write', async (q) => {
    const marked: UsageMeter[] = [];
    for (const m of over) if ((await q(sqlFor(q, WARNING_MARK_SQL, WARNING_MARK_LITE), [period, m.meter])).length > 0) marked.push(m.meter);
    if (marked.length === 0) return { warned: marked, ids: [] };
    const admins = await adminsOf(q);
    const rows: OutboxRow[] = [];
    for (const meter of marked) {
      const value = over.find((m) => m.meter === meter)!.value;
      const percent = Math.floor((value.used / value.limit) * 100);
      for (const admin of admins) rows.push({ kind: LIMIT_WARNING_EFFECT, payload: { userId: admin.id, meter, percent, month: period } });
    }
    return { warned: marked, ids: await writeOutbox(q, rows) };
  });
  if (ids.length > 0) await processOutbox(deps, ids);
  return { warned };
}

export async function checkLimits(deps: Deps): Promise<{ warned: UsageMeter[] }> {
  const now = deps.clock.now();
  const meters = await deps.db.tx('read', (q) => readMeters(q, deps.config, now));
  const over = warningMeters(meters, deps.config.fileStore, deps.config.servingHost).filter((m) => overLimit(m.value));
  return warnAdmins(deps, meters.month, over);
}

/** The 80% warning of the Free day limits, on the office object only (each Cron run; one row read). */
export async function checkDayLimits(deps: Deps, at: Date): Promise<{ warned: UsageMeter[] }> {
  if (!isLite(deps.db)) return { warned: [] };
  const day = utcDay(at);
  const [row] = await deps.db.statement<DayRow>('read', DAY_ROW_LITE, [day]);
  if (!row) return { warned: [] };
  const meters: { meter: UsageMeter; value: Meter }[] = [
    { meter: 'rowsReadDay', value: { used: Number(row.rows_read), limit: DAY_LIMITS.rowsReadDay } },
    { meter: 'rowsWrittenDay', value: { used: Number(row.rows_written), limit: DAY_LIMITS.rowsWrittenDay } },
    { meter: 'objectRequestsDay', value: { used: Number(row.requests), limit: DAY_LIMITS.objectRequestsDay } },
    { meter: 'workerRequestsDay', value: { used: Number(row.worker_requests), limit: DAY_LIMITS.workerRequestsDay } },
  ];
  return warnAdmins(deps, day, meters.filter((m) => overLimit(m.value)));
}

const isMeter = (value: unknown): value is UsageMeter => (USAGE_METERS as readonly unknown[]).includes(value);

/** The usage.limitWarning effect: one warning to one Admin, once for each meter and month. */
export async function sendLimitWarning(payload: Record<string, unknown>, deps: Deps): Promise<void> {
  const userId = String(payload.userId ?? '');
  const month = String(payload.month ?? '');
  const percent = Number(payload.percent ?? 0);
  const meter = payload.meter;
  if (!isMeter(meter)) throw new Error(`The limit warning names a meter that the mail does not know: ${String(meter)}.`);
  // The primary, never a read copy: the effect runs right after the commit that wrote its row.
  const [person] = isLite(deps.db) ? await litePerson(deps.db, userId) : await deps.db.statement<PersonRow & { system_role: string | null }>('write', ADMIN_MAIL_SQL, [userId]);
  if (!person || !mailable(person) || person.system_role !== 'admin') return;
  const rendered = renderMail('limitWarning', person.preferences.language, { meter, percent, link: appLink(deps.config.appUrl, '/admin') }, { reader: person.gender ?? undefined }, { appUrl: deps.config.appUrl });
  const sent = await sendCounted(deps, 'warning', mailOf(person.email, rendered, 'limit-warning', `limit-warning-${month}-${meter}-${userId}`), { userId });
  // Never done unless the mail went out: the mark of the month already exists, so a warning that ends here would be lost.
  if (sent.status === 'over') throw new Error(WARNING_QUOTA_FULL);
}
