import { env } from '../env';
import type { DayCap } from '../office/cap';
import { ENT_VADO, type EnterpriseId } from './ids';
import type { CapAnswer } from './platform/stub';
import type { DayCounts } from './types';

/**
 * The plan settings of Madar enterprises (design 5.14, decision D2). The numbers are the Free limits of the Cloudflare account. A paid
 * plan changes the settings, never the code. ENT_VADO is never refused by the cap: the real office must not stop.
 */

export type PlanLimits = { requests: number; rowsRead: number; rowsWritten: number; mails: number };
export const FREE_LIMITS: PlanLimits = { requests: 100_000, rowsRead: 5_000_000, rowsWritten: 100_000, mails: 100 };
/** Every enterprise except ENT_VADO stops at this part of the account limit. */
export const STOP_LINE = 0.9;
/** The platform page warns the owner at this part of a limit. */
export const WARN_LINE = 0.7;
/** The share of each day limit for one enterprise except ENT_VADO. */
export const DEFAULT_SHARE = 0.1;
export type Plan = { limits: PlanLimits; share: number };

const LIMIT_VARIABLES: Readonly<Record<keyof PlanLimits, string>> = {
  requests: 'MADAR_PLAN_REQUESTS',
  rowsRead: 'MADAR_PLAN_ROWS_READ',
  rowsWritten: 'MADAR_PLAN_ROWS_WRITTEN',
  mails: 'MADAR_PLAN_MAILS',
};
const SHARE_VARIABLE = 'MADAR_ENTERPRISE_SHARE';

/** The plan from a reader of settings. A bad value throws an error that names the variable and never holds the value. */
export function planFrom(read: (name: string) => string | undefined): Plan {
  const limits = { ...FREE_LIMITS };
  for (const key of Object.keys(LIMIT_VARIABLES) as (keyof PlanLimits)[]) {
    const name = LIMIT_VARIABLES[key];
    const text = read(name);
    if (text === undefined || text === '') continue;
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a whole number above 0.`);
    limits[key] = value;
  }
  let share = DEFAULT_SHARE;
  const shareText = read(SHARE_VARIABLE);
  if (shareText !== undefined && shareText !== '') {
    share = Number(shareText);
    if (!Number.isFinite(share) || share <= 0 || share > 1) throw new Error(`${SHARE_VARIABLE} must be a number above 0 and at most 1.`);
  }
  return { limits, share };
}

/** The cap of one enterprise except ENT_VADO: its share of the three limits that the object meters. */
export function shareCapOf(plan: Plan): DayCap {
  const part = (limit: number) => Math.max(1, Math.floor(limit * plan.share));
  return { requests: part(plan.limits.requests), rowsRead: part(plan.limits.rowsRead), rowsWritten: part(plan.limits.rowsWritten) };
}

/**
 * The answer of the day cap for one enterprise. own: the day counts of this enterprise. account: the counts of all enterprises.
 * writes: the call writes. The mail count has no effect here (the mail pool decides the mails).
 */
export function capVerdict(o: { ent: EnterpriseId; plan: Plan; own: DayCounts; account: DayCounts; writes: boolean }): CapAnswer {
  if (o.ent === ENT_VADO) return { allowed: true };
  const over = (used: number, limit: number) => used >= limit;
  const stop = (key: 'requests' | 'rowsRead' | 'rowsWritten') => over(o.account[key], o.plan.limits[key] * STOP_LINE);
  if (stop('requests') || stop('rowsRead') || (o.writes && stop('rowsWritten'))) return { allowed: false, reason: 'busy' };
  const share = shareCapOf(o.plan);
  if (over(o.own.requests, share.requests!) || over(o.own.rowsRead, share.rowsRead!) || (o.writes && over(o.own.rowsWritten, share.rowsWritten!))) {
    return { allowed: false, reason: 'busy' };
  }
  return { allowed: true };
}

/** The limits at or above the warning line in the account counts. */
export function warnings(plan: Plan, account: DayCounts): (keyof PlanLimits)[] {
  return (Object.keys(plan.limits) as (keyof PlanLimits)[]).filter((key) => account[key] >= plan.limits[key] * WARN_LINE);
}

/** The plan of this host, read once at start. */
export const PLAN_LIMITS: PlanLimits = planFrom(env).limits;
