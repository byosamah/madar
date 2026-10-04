import { FREE_PLAN_LIMITS } from '../../src/api/contract/server';
import { nowStamp } from '../../src/lib/dates';
import type { Config, FileStoreKind, Query } from '../core/ports';
import type { ServerCallOutput } from '../core/types';
import { sentToday } from '../mail/quota';
import type { UsageMeter } from '../mail/templates';

/**
 * The usage meters of the free plans (plan 5.8; task M1). readMeters reads every meter in one statement and the emails of
 * today with the quota statement of N2, inside the caller's read transaction. readUsage adds what the Admin must see beside
 * the meters: the effects that failed after a commit (never their payload: an unsent invitation holds a live token hash), the
 * change signals that were not sent in the last day, and the last run of the 15-minute job.
 *
 * - Calls and egress: the rows that the usage meter (meter.ts) writes for each request, in the UTC month.
 * - Database: pg_database_size. Backup copy: the last size that the backup job wrote (plan 5.7).
 * - Files, against the limit of the active store (1 GB on Supabase Storage, plan 2b point 1). On Supabase Storage the meter reads
 *   the real bucket total (madar_private.storage_bytes(), a platform migration): the bucket also holds the data of deleted files
 *   (kept for Undo, section 10 decision 2), the thumbnails, the feedback screenshots and the staging objects, and Storage refuses
 *   uploads at the bucket limit. On R2, and where the function does not exist (the db-mode harness skips platform files), it
 *   counts the sizes of every version in the file records.
 * - Emails: Resend counts the UTC day and month; the quota of N2 (server/mail/quota.ts) counts the same rows.
 */

export type Meter = { used: number; limit: number };
export type Usage = ServerCallOutput<'usage.get'>;
export type Meters = Omit<Usage, 'failedEffects' | 'jobsLastRun'>;
export type FailedEffect = Usage['failedEffects'][number];

/** $1 the UTC month "YYYY-MM", $2 its first day. */
export const METERS_SQL = `select
  coalesce((select calls from usage_month where month = $1), 0)::bigint as calls,
  coalesce((select bytes_read from usage_month where month = $1), 0)::bigint as bytes_read,
  (select backup_bytes from usage_month where backup_bytes is not null order by month desc limit 1) as backup_bytes,
  pg_database_size(current_database()) as database_bytes,
  coalesce((select sum((v->>'size')::bigint) from files f cross join lateral jsonb_array_elements(f.doc->'versions') v), 0)::bigint as files_bytes,
  (select count(*) from mail_log
    where utc_day >= $2::date and utc_day < ($2::date + interval '1 month')::date
      and kind in ('notice', 'summary', 'signin', 'warning'))::bigint as emails_month`;

/** True when the platform function of the bucket total exists. */
export const STORAGE_PRESENT_SQL = "select to_regprocedure('madar_private.storage_bytes()') is not null as present";
/** The bytes of every object in the bucket madar-files (supabase/migrations/20261004000601_platform_usage_storage.sql). */
export const STORAGE_BYTES_SQL = 'select madar_private.storage_bytes() as bytes';

/** The outbox rows that failed and are not done yet, newest first. Never the payload. */
export const FAILED_EFFECTS_SQL = `select id::text as id, kind, error, attempts, created_at from outbox
where done_at is null and error is not null
order by created_at desc, id desc
limit 20`;

/** $1 the UTC month, $2 the start of the last day. The change signals of the month that were not sent, when the last one is recent. */
export const SIGNALS_SQL = 'select signals_failed, signals_failed_at from usage_month where month = $1 and signals_failed > 0 and signals_failed_at >= $2::timestamptz';

/** The heartbeat that the 15-minute job writes first in each run (plan 5.5, step 0). */
export const JOBS_LAST_RUN_SQL = "select done_at from job_runs where key = 'heartbeat'";

/** The kind of the failed effect line for the change signals. */
export const SIGNAL_EFFECT_KIND = 'realtime.signal';

const DAY_MS = 24 * 60 * 60 * 1000;
const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value));
const dateOf = (value: unknown): Date => (value instanceof Date ? value : new Date(String(value)));

/** The UTC month of a moment, "YYYY-MM". */
export function utcMonth(at: Date): string {
  return at.toISOString().slice(0, 7);
}

type MeterRow = { calls: unknown; bytes_read: unknown; backup_bytes: unknown; database_bytes: unknown; files_bytes: unknown; emails_month: unknown };

/** The bytes in the store: the bucket total on Supabase Storage when the function exists, else the file records. */
async function storedBytes(q: Query, store: FileStoreKind, fromRecords: number): Promise<number> {
  if (store !== 'supabase') return fromRecords;
  const [check] = await q<{ present: boolean }>(STORAGE_PRESENT_SQL);
  if (!check?.present) return fromRecords;
  const [total] = await q<{ bytes: unknown }>(STORAGE_BYTES_SQL);
  return num(total?.bytes);
}

export async function readMeters(q: Query, config: Pick<Config, 'limits' | 'fileStore'>, now: Date): Promise<Meters> {
  const month = utcMonth(now);
  const [row] = await q<MeterRow>(METERS_SQL, [month, `${month}-01`]);
  const today = await sentToday(q, { now });
  const files = await storedBytes(q, config.fileStore, num(row?.files_bytes));
  return {
    month,
    calls: { used: num(row?.calls), limit: FREE_PLAN_LIMITS.calls },
    database: { used: num(row?.database_bytes), limit: FREE_PLAN_LIMITS.databaseBytes },
    files: { used: files, limit: config.limits.filesTotalBytes },
    backupCopy: { used: num(row?.backup_bytes), limit: FREE_PLAN_LIMITS.backupCopyBytes },
    emails: { used: today, limit: FREE_PLAN_LIMITS.emailsPerDay },
    emailsMonth: { used: num(row?.emails_month), limit: FREE_PLAN_LIMITS.emailsPerMonth },
    egress: { used: num(row?.bytes_read), limit: FREE_PLAN_LIMITS.egressBytes },
  };
}

export async function readUsage(q: Query, config: Pick<Config, 'limits' | 'fileStore'>, now: Date): Promise<Usage> {
  const meters = await readMeters(q, config, now);
  const failed = await q<{ id: string; kind: string; error: string | null; attempts: unknown; created_at: unknown }>(FAILED_EFFECTS_SQL);
  const failedEffects: FailedEffect[] = failed.map((row) => ({
    id: String(row.id),
    kind: row.kind,
    error: row.error ?? null,
    attempts: num(row.attempts),
    createdAt: nowStamp(dateOf(row.created_at)),
  }));
  const [signals] = await q<{ signals_failed: unknown; signals_failed_at: unknown }>(SIGNALS_SQL, [meters.month, new Date(now.getTime() - DAY_MS).toISOString()]);
  if (signals) {
    const count = num(signals.signals_failed);
    failedEffects.unshift({ kind: SIGNAL_EFFECT_KIND, error: `${count} change signals were not sent this month.`, attempts: count, createdAt: nowStamp(dateOf(signals.signals_failed_at)) });
  }
  const [job] = await q<{ done_at: unknown }>(JOBS_LAST_RUN_SQL);
  return { ...meters, failedEffects, jobsLastRun: job ? nowStamp(dateOf(job.done_at)) : null };
}

/** True from four fifths of the limit on. */
export function overLimit(meter: Meter): boolean {
  return meter.used * 5 >= meter.limit * 4;
}

/**
 * The meters of the 80% warning, by the names of the limitWarning mail (server/mail/templates). Files have their own name on
 * R2, where the next step is different (section 10, decision 2).
 */
export function warningMeters(meters: Meters, store: FileStoreKind): { meter: UsageMeter; value: Meter }[] {
  return [
    { meter: 'calls', value: meters.calls },
    { meter: 'database', value: meters.database },
    { meter: store === 'r2' ? 'filesR2' : 'files', value: meters.files },
    { meter: 'backup', value: meters.backupCopy },
    { meter: 'emailsToday', value: meters.emails },
    { meter: 'emailsMonth', value: meters.emailsMonth },
    { meter: 'egress', value: meters.egress },
  ];
}
