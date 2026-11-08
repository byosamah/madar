import { ApiError } from '../../../src/api/errors';
import type { Query } from '../../core/ports';
import { isEnterpriseId, ENT_VADO, type EnterpriseId } from '../ids';

/**
 * The mail pool of the account (Madar enterprises, design 5.12). The Resend Free plan sends 100 mails a UTC day for the whole account,
 * so one table in the platform object counts the places of all enterprises. A place belongs to one ref (the scoped idempotency key of
 * the mail), so a retry of the same mail takes the same place once.
 */

export type PoolKind = 'signin' | 'notice';
export type MailPoolInput = { ent: EnterpriseId; kind: PoolKind; day: string; ref: string };

export const MAIL_POOL_SCHEMA = 'create table mail_pool (day text not null, ref text not null, kind text not null, ent text not null, primary key (day, ref))';

/** Notice and summary mail stops at this part of the day limit. Sign-in mail keeps the last SIGNIN_RESERVE places. */
const NOTICE_PART = 0.9;
const SIGNIN_RESERVE = 2;
/** A row older than this many days is of no use: the quota is for one UTC day. */
const KEEP_DAYS = 2;
const DAY_MS = 86_400_000;
const REF_MAX_CHARS = 200;

/** The most notice places of one enterprise except ENT_VADO in a day: its share of the notice limit, and at least one. */
export function noticeShareOf(limit: number, share: number): number {
  return Math.max(1, Math.floor(share * Math.floor(limit * NOTICE_PART)));
}

/**
 * A place for one mail, in the transaction of the caller. A ref must start with `<ent>:` (else invalid_input, no place). A ref that
 * holds a place of this enterprise today answers ok and adds nothing. A sign-in place
 * is full at limit minus 2. A notice place is full at 90 percent of the limit, and for an enterprise except ENT_VADO also when the
 * enterprise holds its share of the notice places (design 5.14). The call writes only when it adds a place.
 */
export async function mailReserve(q: Query, input: MailPoolInput, o: { limit: number; share: number }): Promise<'ok' | 'full'> {
  const { ent, kind, day, ref } = input;
  if (!isEnterpriseId(ent)) throw new ApiError('invalid_input', 'This is not an enterprise id.');
  if (kind !== 'signin' && kind !== 'notice') throw new ApiError('invalid_input', 'The kind of a mail place is signin or notice.');
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new ApiError('invalid_input', 'The day is YYYY-MM-DD.');
  if (typeof ref !== 'string' || ref === '' || ref.length > REF_MAX_CHARS) throw new ApiError('invalid_input', 'The ref of a mail place is a short text.');
  // The ref of a mail starts with the enterprise of the call (scopedRef). The text names no enterprise.
  if (!ref.startsWith(`${ent}:`) || ref.length === ent.length + 1) throw new ApiError('invalid_input', 'The ref of a mail place is not valid.');
  const [held] = await q<{ n: number }>('select count(*) as n from mail_pool where day = ?1 and ref = ?2 and ent = ?3', [day, ref, ent]);
  if (Number(held?.n ?? 0) > 0) return 'ok';
  const [total] = await q<{ n: number; mine: number }>(
    "select count(*) as n, coalesce(sum(case when ent = ?2 and kind = 'notice' then 1 else 0 end), 0) as mine from mail_pool where day = ?1", [day, ent]);
  const used = Number(total?.n ?? 0);
  if (kind === 'signin') {
    if (used >= o.limit - SIGNIN_RESERVE) return 'full';
  } else {
    if (used >= Math.floor(o.limit * NOTICE_PART)) return 'full';
    if (ent !== ENT_VADO && Number(total?.mine ?? 0) >= noticeShareOf(o.limit, o.share)) return 'full';
  }
  const cutoff = new Date(Date.parse(day) - KEEP_DAYS * DAY_MS).toISOString().slice(0, 10);
  await q('delete from mail_pool where day < ?1', [cutoff]);
  // No "on conflict": the lookup found no row of this enterprise, so a conflict is a row of another enterprise. The call fails.
  await q('insert into mail_pool (day, ref, kind, ent) values (?1, ?2, ?3, ?4)', [day, ref, kind, ent]);
  return 'ok';
}
