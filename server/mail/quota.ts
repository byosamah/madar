import type { Clock, Db, Mail, MailPort, Query } from '../core/ports';

/**
 * The email quota (plan 2 change 9, 5.4; task N2.1). Resend's free plan sends 100 emails a UTC day (00:00 UTC is 03:00 Riyadh),
 * and sign-in mail uses the same 100. So notices and summaries stop at 90, and sign-in mail and warnings still go up to a hard
 * stop at 98. The first refused notice or summary of a day leaves one mark, so the caller warns each Admin once.
 *
 * reserve() runs two statements in the caller's short write transaction: the mail lock, then one statement that counts the day
 * and adds the row. The lock must come first in a statement of its own: a write transaction reads committed rows, and only a
 * statement that starts after the lock sees a row that the previous holder committed.
 */

export type QuotaKind = 'notice' | 'summary' | 'signin' | 'warning';
export const QUOTA_LIMITS: Record<QuotaKind, number> = { notice: 90, summary: 90, signin: 98, warning: 98 };
/** The kinds that stop at the notice limit; their first refusal of a day warns the Admins. */
const NOTICE_KINDS: ReadonlySet<QuotaKind> = new Set(['notice', 'summary']);

/** The two-key form of the advisory lock: its key space never meets the one-key office lock (server/core/lock.ts). */
export const MAIL_LOCK_KEY: readonly [number, number] = [7_320_001, 1];
export const MAIL_LOCK_SQL = 'select pg_advisory_xact_lock($1::integer, $2::integer)';

/** The day in SQL: the one given, or the database's own UTC day. */
const DAY = "coalesce($1::date, (now() at time zone 'utc')::date)";
const SENDING = "kind in ('notice', 'summary', 'signin', 'warning')";

/** $1 day, $2 kind, $3 user id, $4 ref, $5 limit. ok: the ref holds a place today (new, or from an earlier attempt). */
export const RESERVE_SQL = `with today as (
  select count(*) filter (where ${SENDING})::integer as n, coalesce(bool_or(ref = $4), false) as mine
  from mail_log where utc_day = ${DAY}
), added as (
  insert into mail_log (utc_day, kind, user_id, ref)
  select ${DAY}, $2, $3, $4 from today where not today.mine and today.n < $5
  returning id
)
select today.mine or exists (select 1 from added) as ok from today`;

/** $1 day. One row a day; a row back means this is the first refusal. */
export const REFUSAL_MARK_SQL = `insert into mail_log (utc_day, kind, ref) values (${DAY}, 'refused', 'quota-refused')
on conflict (utc_day, ref) do nothing returning id`;

/** $1 day. The emails of the day, as Resend counts them (the usage meter reads this too). */
export const SENT_TODAY_SQL = `select count(*)::integer as n from mail_log where utc_day = ${DAY} and ${SENDING}`;

/** $1 day, $2 ref, $3 Resend id. */
export const RECORD_SENT_SQL = 'update mail_log set resend_id = $3 where utc_day = $1::date and ref = $2';

/** The UTC day of a moment, as "YYYY-MM-DD". */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

type DayOption = { now?: Date };
const dayOf = (o: DayOption) => (o.now ? utcDay(o.now) : null);

/** A place in today's quota for one mail. Run it in a short write transaction of its own: it holds the mail lock to the commit. */
export async function reserve(q: Query, kind: QuotaKind, ref: string, o: DayOption & { userId?: string } = {}): Promise<'ok' | 'over'> {
  await q(MAIL_LOCK_SQL, [...MAIL_LOCK_KEY]);
  const [row] = await q<{ ok: boolean }>(RESERVE_SQL, [dayOf(o), kind, o.userId ?? null, ref, QUOTA_LIMITS[kind]]);
  return row?.ok ? 'ok' : 'over';
}

/** True only for the first call of a day: the caller then sends the one quota warning to each Admin. */
export async function markFirstRefusal(q: Query, o: DayOption = {}): Promise<boolean> {
  return (await q(REFUSAL_MARK_SQL, [dayOf(o)])).length > 0;
}

export async function sentToday(q: Query, o: DayOption = {}): Promise<number> {
  const [row] = await q<{ n: number }>(SENT_TODAY_SQL, [dayOf(o)]);
  return Number(row?.n ?? 0);
}

export type SendCounted = { status: 'sent'; id: string } | { status: 'over'; firstRefusal: boolean };

export type SendCountedOptions = {
  userId?: string;
  /**
   * Runs once a day, in the transaction that writes the first-refusal mark: the caller writes the Admin warnings there as outbox
   * rows (plan 4.12), so the mark and the warnings commit together. A warning send that fails then retries from its own row, and
   * a hook that throws rolls the mark back, so the retry of the refused mail is again the first refusal.
   */
  onFirstRefusal?: (q: Query) => Promise<unknown>;
};

/**
 * One counted mail: reserve a place (ref = the idempotency key, so a retry keeps its place and Resend sends it once), send after
 * the commit, then record the Resend id. A refused notice or summary tells whether it is the first refusal of the day.
 * A failed send throws and keeps the place: the outbox runs the effect again with the same key.
 */
export async function sendCounted(
  deps: { db: Db; mail: MailPort; clock: Clock },
  kind: QuotaKind,
  mail: Mail,
  o: SendCountedOptions = {},
): Promise<SendCounted> {
  const now = deps.clock.now();
  const ref = mail.idempotencyKey;
  const placed = await deps.db.tx('write', async (q) => {
    if ((await reserve(q, kind, ref, { now, userId: o.userId })) === 'ok') return { ok: true, firstRefusal: false };
    const firstRefusal = NOTICE_KINDS.has(kind) ? await markFirstRefusal(q, { now }) : false;
    if (firstRefusal && o.onFirstRefusal) await o.onFirstRefusal(q);
    return { ok: false, firstRefusal };
  });
  if (!placed.ok) return { status: 'over', firstRefusal: placed.firstRefusal };
  const { id } = await deps.mail.send(mail);
  await deps.db.statement('write', RECORD_SENT_SQL, [utcDay(now), ref, id]);
  return { status: 'sent', id };
}

/**
 * A send that the daily mail quota refused. retryAt is the next UTC midnight, when the quota has room again. processOutbox
 * (server/core/effects.ts) holds the row until then and gives the attempt back, so a full day never uses up the 5 attempts of a
 * row. The invitation (server/auth/invite.ts) and the notice at the old email (server/auth/effects.ts) throw it.
 */
export class QuotaFull extends Error {
  readonly retryAt: Date;

  constructor(message: string, now: Date) {
    super(message);
    this.name = 'QuotaFull';
    this.retryAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  }
}
