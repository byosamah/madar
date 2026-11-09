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
import { recountStorage } from '../enterprise/storage';
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
  /** The Google link of each person: the sealed token moves as it is (the keys of ent_001 keep their HKDF texts, so it still opens). */
  googleConnections: GoogleConnectionRow[];
  googleEvents: { user_id: string; meeting_id: string; event_id: string; synced_rev: number; synced_at: string }[];
  googleCalendars: { user_id: string; calendar_id: string; changed_at: string }[];
  /** The Daftra match of each client and the cache of recent invoices. A day is YYYY-MM-DD, money is whole halalas. */
  daftraClients: { account: string; client_id: string; daftra_id: string; daftra_name: string; matched_by: string; matched_at: string }[];
  daftraInvoices: DaftraInvoiceRow[];
};

export type GoogleConnectionRow = {
  id: string; user_id: string; sealed_token: string | null; calendar_id: string | null; state: 'ok' | 'not_synced' | 'broken' | 'revoking';
  connected_at: string; last_error: string | null; last_error_at: string | null; changed_at: string;
};
export type DaftraInvoiceRow = {
  account: string; id: string; daftra_client_id: string; no: string; total_halalas: number; issued_on: string; created_at: string;
  payment_status: number; paid_on: string | null; draft: boolean; seen_at: string;
};

/**
 * Each server table of SERVER_TABLES that the import carries, with the key of ServerRows that holds its rows. The records tables
 * (TABLES, push_devices among them) travel in the parts. office_meta travels as the two numbers officeSeq and version.
 */
export const IMPORT_SERVER_TABLES: Readonly<Record<string, keyof ServerRows>> = {
  office_meta: 'officeSeq', person_seq: 'personSeq', mail_log: 'mailLog', usage_month: 'usageMonth', usage_warnings: 'usageWarnings', job_runs: 'jobRuns',
  google_connections: 'googleConnections', google_events: 'googleEvents', google_calendars: 'googleCalendars',
  daftra_clients: 'daftraClients', daftra_invoices: 'daftraInvoices',
};

/** The server tables that the import leaves out, each with its reason. A new server table must be in one list: server/office/import.test.ts. */
export const IMPORT_SERVER_SKIP: Readonly<Record<string, string>> = {
  office_deletes: 'Postgres only: the office cache of the Supabase path keeps the deleted ids; the object has no cache of that kind.',
  platform_config: 'Postgres only: the address and the secrets of the Supabase functions; the Worker reads its own vars and secrets.',
  office_copy: 'Postgres only: the compressed office copy for a cold start of a function; the object keeps its own snapshot.',
  stories: 'A story id is good for 24 hours of one chain of writes; the events keep their story ids, so an Undo of the old changes still works.',
  idempotency: 'The stored answer of a retried write; it is good for minutes, and the browsers send new keys after the switch.',
  outbox: 'The effects that wait (a mail, a push): the lead lets the Supabase 15-minute job send them before the switch. The Cron of the object starts with an empty outbox.',
  upload_intents: 'An open file upload ends in minutes; a person starts the upload again.',
  agent_links: 'The AI agents connect again once after the move (a new key and new OAuth clients), so an old link points to nothing.',
  mail_outbox: 'The mail of the outbox driver, which only the test copy uses; production sends through Resend.',
  rate_limits: 'The windows of a limit end in minutes or hours.',
  agent_confirms: 'The email code of an agent for a risky Admin act, valid for minutes; an agent that connects again asks for a new one.',
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

export const ServerRowsShape = z.object({
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
  // A finish from an older client has none of these lists: the default is none, so the import stays additive.
  googleConnections: z.array(z.object({
    id: z.string().min(1), user_id: z.string().min(1), sealed_token: TEXT_OR_NULL, calendar_id: TEXT_OR_NULL, state: z.enum(['ok', 'not_synced', 'broken', 'revoking']),
    connected_at: z.string(), last_error: TEXT_OR_NULL, last_error_at: TEXT_OR_NULL, changed_at: z.string(),
  })).default([]),
  googleEvents: z.array(z.object({ user_id: z.string(), meeting_id: z.string(), event_id: z.string(), synced_rev: COUNT, synced_at: z.string() })).default([]),
  googleCalendars: z.array(z.object({ user_id: z.string(), calendar_id: z.string(), changed_at: z.string() })).default([]),
  daftraClients: z.array(z.object({ account: z.string(), client_id: z.string(), daftra_id: z.string(), daftra_name: z.string(), matched_by: z.string(), matched_at: z.string() })).default([]),
  daftraInvoices: z.array(z.object({
    account: z.string(), id: z.string(), daftra_client_id: z.string(), no: z.string(), total_halalas: COUNT, issued_on: z.string(), created_at: z.string(),
    payment_status: z.number().int(), paid_on: TEXT_OR_NULL, draft: z.boolean(), seen_at: z.string(),
  })).default([]),
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
    // The Google and Daftra rows (plan E, Task 2b). A second finish (resume) sets the same rows again: each statement is an upsert on the key.
    for (const g of server.googleConnections) {
      await q('insert into google_connections (id, user_id, sealed_token, calendar_id, state, connected_at, last_error, last_error_at, changed_at) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) '
        + 'on conflict (id) do update set user_id = excluded.user_id, sealed_token = excluded.sealed_token, calendar_id = excluded.calendar_id, state = excluded.state, '
        + 'connected_at = excluded.connected_at, last_error = excluded.last_error, last_error_at = excluded.last_error_at, changed_at = excluded.changed_at',
        [g.id, g.user_id, g.sealed_token, g.calendar_id, g.state, g.connected_at, g.last_error, g.last_error_at, g.changed_at]);
    }
    for (const g of server.googleEvents) {
      await q('insert into google_events (user_id, meeting_id, event_id, synced_rev, synced_at) values (?1, ?2, ?3, ?4, ?5) '
        + 'on conflict (user_id, meeting_id) do update set event_id = excluded.event_id, synced_rev = excluded.synced_rev, synced_at = excluded.synced_at',
        [g.user_id, g.meeting_id, g.event_id, g.synced_rev, g.synced_at]);
    }
    for (const g of server.googleCalendars) {
      await q('insert into google_calendars (user_id, calendar_id, changed_at) values (?1, ?2, ?3) on conflict (user_id) do update set calendar_id = excluded.calendar_id, changed_at = excluded.changed_at',
        [g.user_id, g.calendar_id, g.changed_at]);
    }
    for (const d of server.daftraClients) {
      await q('insert into daftra_clients (account, client_id, daftra_id, daftra_name, matched_by, matched_at) values (?1, ?2, ?3, ?4, ?5, ?6) '
        + 'on conflict (account, client_id) do update set daftra_id = excluded.daftra_id, daftra_name = excluded.daftra_name, matched_by = excluded.matched_by, matched_at = excluded.matched_at',
        [d.account, d.client_id, d.daftra_id, d.daftra_name, d.matched_by, d.matched_at]);
    }
    for (const d of server.daftraInvoices) {
      await q('insert into daftra_invoices (account, id, daftra_client_id, no, total_halalas, issued_on, created_at, payment_status, paid_on, draft, seen_at) '
        + 'values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) on conflict (account, id) do update set daftra_client_id = excluded.daftra_client_id, no = excluded.no, '
        + 'total_halalas = excluded.total_halalas, issued_on = excluded.issued_on, created_at = excluded.created_at, payment_status = excluded.payment_status, '
        + 'paid_on = excluded.paid_on, draft = excluded.draft, seen_at = excluded.seen_at',
        [d.account, d.id, d.daftra_client_id, d.no, d.total_halalas, d.issued_on, d.created_at, d.payment_status, d.paid_on, d.draft ? 1 : 0, d.seen_at]);
    }
    // The sign-in rows (wave 2): importSigninRows raises the version once more and writes the snapshot with the lists of the
    // tables, so the first call after the import reads the new office.
    await importSigninRows(q, signin, now);
    // The running total of the file bytes counts again from the records that came in (plan C): enterprise_use never travels in an export.
    await recountStorage(q);
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
