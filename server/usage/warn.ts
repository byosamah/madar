import { processOutbox, writeOutbox, type OutboxRow } from '../core/effects';
import type { Deps } from '../core/ports';
import { ADMINS_SQL, appLink, mailOf, mailable, type PersonRow } from '../mail/notices';
import { sendCounted } from '../mail/quota';
import { USAGE_METERS, renderMail, type UsageMeter } from '../mail/templates';
import { overLimit, readMeters, warningMeters } from './meters';

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

/** $1 the UTC month, $2 the meter. A row back means this run made the mark, and so it sends the warning. */
/**
 * $1 the person. The row of USER_MAIL_SQL (server/mail/notices.ts) with the system role, so the effect sends nothing to a person
 * who lost the Admin role between the row write and the send (the job retries a row for about an hour).
 */
export const ADMIN_MAIL_SQL = `select id as user_id, kind, active, doc->>'email' as email, doc->'preferences' as preferences, doc->>'gender' as gender,
  doc->>'systemRole' as system_role
from users where id = $1`;

/** The error of a warning that the warning quota of today stopped. The row stays for the job and shows in Usage. */
export const WARNING_QUOTA_FULL = 'The warning quota of today is full.';

export const WARNING_MARK_SQL = 'insert into usage_warnings (month, metric) values ($1, $2) on conflict (month, metric) do nothing returning metric';

export async function checkLimits(deps: Deps): Promise<{ warned: UsageMeter[] }> {
  const now = deps.clock.now();
  const meters = await deps.db.tx('read', (q) => readMeters(q, deps.config, now));
  const over = warningMeters(meters, deps.config.fileStore).filter((m) => overLimit(m.value));
  if (over.length === 0) return { warned: [] };
  const { warned, ids } = await deps.db.tx('write', async (q) => {
    const marked: UsageMeter[] = [];
    for (const m of over) if ((await q(WARNING_MARK_SQL, [meters.month, m.meter])).length > 0) marked.push(m.meter);
    if (marked.length === 0) return { warned: marked, ids: [] };
    const admins = await q<{ id: string }>(ADMINS_SQL);
    const rows: OutboxRow[] = [];
    for (const meter of marked) {
      const value = over.find((m) => m.meter === meter)!.value;
      const percent = Math.floor((value.used / value.limit) * 100);
      for (const admin of admins) rows.push({ kind: LIMIT_WARNING_EFFECT, payload: { userId: admin.id, meter, percent, month: meters.month } });
    }
    return { warned: marked, ids: await writeOutbox(q, rows) };
  });
  if (ids.length > 0) await processOutbox(deps, ids);
  return { warned };
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
  const [person] = await deps.db.statement<PersonRow & { system_role: string | null }>('write', ADMIN_MAIL_SQL, [userId]);
  if (!person || !mailable(person) || person.system_role !== 'admin') return;
  const rendered = renderMail('limitWarning', person.preferences.language, { meter, percent, link: appLink(deps.config.appUrl, '/admin') }, { reader: person.gender ?? undefined }, { appUrl: deps.config.appUrl });
  const sent = await sendCounted(deps, 'warning', mailOf(person.email, rendered, 'limit-warning', `limit-warning-${month}-${meter}-${userId}`), { userId });
  // Never done unless the mail went out: the mark of the month already exists, so a warning that ends here would be lost.
  if (sent.status === 'over') throw new Error(WARNING_QUOTA_FULL);
}
