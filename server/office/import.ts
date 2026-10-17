import { z } from 'zod';
import { ApiError } from '../../src/api/errors';
import { emptyState } from '../../src/api/store';
import { importSigninRows, type SigninExportRow } from '../auth/own/import';
import type { Query } from '../core/ports';
import type { LiteDb } from '../data/lite/db';
import { insertRow } from '../data/lite/save';
import { EVENT_GUARDS, eventGuardsSql } from '../data/lite/schema';
import type { Row } from '../data/rows';
import { TABLES } from '../data/tables';
import { EXPORT_TABLES, META_ROW_LITE } from './ops';
import type { DayRow } from './parts';

/**
 * The import of an office into the office object, in parts (Supabase exit, wave 4; spec section 4, steps 3 to 5). The client
 * (scripts/office/import.ts) sends the records in parts of at most 2,000 rows, then the server rows and the sign-in rows in one
 * finish. Each part is one transaction; a part whose first row is there already committed before, and the step skips it, so a
 * client may send a part again after a lost answer. The office object holds every call from the begin to the finish.
 */

export type ImportRow = Row;
export type ImportMode = 'empty' | 'resume' | 'replace';

/** The server rows that move with the records (spec section 4, step 3). Times are ISO text in UTC, days are YYYY-MM-DD. */
export type ServerRows = {
  counters: { prefix: string; n: number }[];
  officeSeq: number;
  version: number;
  personSeq: { user_id: string; seq: number }[];
  mailLog: { utc_day: string; kind: string; user_id: string | null; ref: string; resend_id: string | null; created_at: string }[];
  usageMonth: { month: string; calls: number; bytes_read: number; backup_bytes: number | null; signals_failed: number; signals_failed_at: string | null }[];
  usageWarnings: { month: string; metric: string; sent_at: string }[];
  jobRuns: { key: string; done_at: string }[];
};

export type ImportStep =
  | { step: 'begin'; mode: ImportMode }
  | { step: 'part'; id: string; table: string; rows: ImportRow[] }
  | { step: 'finish'; id: string; server: ServerRows; signin: SigninExportRow[] }
  | { step: 'abort'; id: string };
export type ImportBegin = { id: string; schema: number; day: DayRow };
export type ImportPartAnswer = { written: number; skipped: boolean };
export type ImportFinish = { version: number; officeSeq: number };

export const IMPORT_PART_ROWS = 2_000;
/** The tables that a replace keeps: the version only grows, and the meters count the real use of the day and the month. */
export const KEEP_ON_REPLACE: readonly string[] = ['office_meta', 'usage_day', 'usage_month', 'usage_warnings'];

const HOLD_ID = z.string().regex(/^[0-9a-f]{32}$/);
const COUNT = z.number().int().min(0);
const TEXT_OR_NULL = z.string().nullable();

const RowShape = z.object({ id: z.string().min(1), doc: z.record(z.string(), z.unknown()), columns: z.record(z.string(), z.unknown()) });

const ServerRowsShape = z.object({
  counters: z.array(z.object({ prefix: z.string(), n: COUNT })),
  officeSeq: COUNT,
  version: COUNT,
  personSeq: z.array(z.object({ user_id: z.string(), seq: COUNT })),
  mailLog: z.array(z.object({ utc_day: z.string(), kind: z.string(), user_id: TEXT_OR_NULL, ref: z.string(), resend_id: TEXT_OR_NULL, created_at: z.string() })),
  usageMonth: z.array(z.object({
    month: z.string(), calls: COUNT, bytes_read: COUNT, backup_bytes: COUNT.nullable(), signals_failed: COUNT, signals_failed_at: TEXT_OR_NULL,
  })),
  usageWarnings: z.array(z.object({ month: z.string(), metric: z.string(), sent_at: z.string() })),
  jobRuns: z.array(z.object({ key: z.string(), done_at: z.string() })),
});

const SigninRowShape = z.object({
  id: z.string().min(1), email: z.string().min(1), password_hash: TEXT_OR_NULL, email_confirmed: z.boolean(), banned: z.boolean(),
  password_set: z.boolean(), user_id: TEXT_OR_NULL,
});

/** The shape of one import step. The table of a part is checked against TABLES in importPart, so no other text reaches the SQL. */
export const ImportStepShape: z.ZodType<ImportStep> = z.discriminatedUnion('step', [
  z.object({ step: z.literal('begin'), mode: z.enum(['empty', 'resume', 'replace']) }),
  z.object({ step: z.literal('part'), id: HOLD_ID, table: z.string(), rows: z.array(RowShape) }),
  z.object({ step: z.literal('finish'), id: HOLD_ID, server: ServerRowsShape, signin: z.array(SigninRowShape) }),
  z.object({ step: z.literal('abort'), id: HOLD_ID }),
]);

/** The step of a body, or invalid_input. */
export function importStepOf(body: unknown): ImportStep {
  const parsed = ImportStepShape.safeParse(body);
  if (!parsed.success) throw new ApiError('invalid_input', 'An import step is begin (mode), part (id, table, rows), finish (id, server, signin) or abort (id).');
  return parsed.data;
}

const EMPTY = emptyState('');

/** The tables that must be empty for mode empty: every records table but settings (the schema makes its row), and the people. */
const MUST_BE_EMPTY: readonly string[] = [...TABLES.filter((spec) => spec.collection !== 'settings').map((spec) => spec.table), 'auth_users'];

export async function importBegin(db: LiteDb, mode: ImportMode): Promise<void> {
  if (mode === 'resume') return;
  if (mode === 'empty') {
    for (const table of MUST_BE_EMPTY) {
      const [row] = await db.statement('read', `select 1 as n from ${table} limit 1`);
      if (row) {
        throw new ApiError('conflict', `The office object holds records already (${table}). Import into a new name, or use replace on the test copy.`, { reason: 'not_empty' });
      }
    }
    return;
  }
  // replace (the test tools only): every record, every sign-in row and every server row but KEEP_ON_REPLACE, in one transaction.
  // The History guard comes off for the deletes and on again before the commit. The snapshot goes and the version rises, so the
  // office lists of the old office never look current, also after an abort.
  const host = db.host;
  await host.transaction(async () => {
    for (const name of EVENT_GUARDS) host.exec(`drop trigger ${name}`, []);
    for (const table of EXPORT_TABLES) if (!KEEP_ON_REPLACE.includes(table)) host.exec(`delete from ${table}`, []);
    host.exec('delete from office_snapshot', []);
    host.exec('update office_meta set version = version + 1 where id = 1', []);
    for (const text of eventGuardsSql()) host.exec(text, []);
  });
}

export async function importPart(db: LiteDb, table: string, rows: readonly ImportRow[]): Promise<ImportPartAnswer> {
  const spec = TABLES.find((one) => one.table === table);
  if (!spec) throw new ApiError('invalid_input', `The import has no records table ${table}.`);
  if (rows.length === 0) return { written: 0, skipped: false };
  if (rows.length > IMPORT_PART_ROWS) throw new ApiError('invalid_input', `A part holds at most ${IMPORT_PART_ROWS} rows.`);
  const wrong = rows.find((row) => spec.key(row.doc) !== row.id);
  if (wrong) throw new ApiError('invalid_input', `The id of a row of ${table} is not the key of its doc (${wrong.id}).`);
  if (spec.collection !== 'settings') {
    const [there] = await db.statement('read', `select 1 as n from ${spec.table} where id = ?1`, [rows[0].id]);
    if (there) return { written: 0, skipped: true };
  }
  // The schema makes the settings row of a new office, so the import replaces that one row; every other row is new.
  await db.tx('write', async (q) => {
    for (const row of rows) await insertRow(q, spec, row, EMPTY, spec.collection === 'settings' ? 'update' : 'fail');
  });
  return { written: rows.length, skipped: false };
}

/**
 * The server rows, the sign-in rows and the meters, in one transaction. flush adds the meter counts of the import (the day row
 * keeps them); the month row of the source comes after it, so the month meter goes on from the source.
 */
export async function importFinish(
  db: LiteDb, server: ServerRows, signin: readonly SigninExportRow[], now: Date, flush?: (q: Query) => Promise<void>,
): Promise<ImportFinish> {
  return db.tx('write', async (q) => {
    for (const c of server.counters) await q('insert into counters (prefix, n) values (?1, ?2) on conflict (prefix) do update set n = excluded.n', [c.prefix, c.n]);
    // The number of the last office signal goes on from the source (the event numbers live in counters). The version rises above
    // the version of the object and of the source, so no office list that the object or a screen held before looks current.
    await q('update office_meta set office_seq = ?1, version = max(version + 1, ?2) where id = 1', [server.officeSeq, server.version]);
    for (const p of server.personSeq) await q('insert into person_seq (user_id, seq) values (?1, ?2) on conflict (user_id) do update set seq = excluded.seq', [p.user_id, p.seq]);
    for (const m of server.mailLog) {
      await q('insert into mail_log (utc_day, kind, user_id, ref, resend_id, created_at) values (?1, ?2, ?3, ?4, ?5, ?6) on conflict (utc_day, ref) do nothing',
        [m.utc_day, m.kind, m.user_id, m.ref, m.resend_id, m.created_at]);
    }
    for (const w of server.usageWarnings) await q('insert into usage_warnings (month, metric, sent_at) values (?1, ?2, ?3) on conflict (month, metric) do nothing', [w.month, w.metric, w.sent_at]);
    for (const j of server.jobRuns) {
      await q('insert into job_runs (key, done_at) values (?1, ?2) on conflict (key) do update set done_at = max(job_runs.done_at, excluded.done_at)', [j.key, j.done_at]);
    }
    // The sign-in rows (wave 2): importSigninRows raises the version once more and writes the snapshot with the lists of the
    // tables, so the first call after the import reads the new office.
    await importSigninRows(q, signin, now);
    if (flush) await flush(q);
    for (const u of server.usageMonth) {
      await q('insert into usage_month (month, calls, bytes_read, backup_bytes, signals_failed, signals_failed_at) values (?1, ?2, ?3, ?4, ?5, ?6) '
        + 'on conflict (month) do update set calls = excluded.calls, bytes_read = excluded.bytes_read, backup_bytes = excluded.backup_bytes, '
        + 'signals_failed = excluded.signals_failed, signals_failed_at = excluded.signals_failed_at',
        [u.month, u.calls, u.bytes_read, u.backup_bytes, u.signals_failed, u.signals_failed_at]);
    }
    const [meta] = await q<{ version: number; office_seq: number }>(META_ROW_LITE);
    return { version: Number(meta.version), officeSeq: Number(meta.office_seq) };
  });
}
