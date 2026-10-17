import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { State } from '../../src/api/store';
import { SIGNIN_EXPORT_SQL, type SigninExportRow } from '../../server/auth/own/import';
import type { Query } from '../../server/core/ports';
import { rowOf } from '../../server/data/rows';
import { TABLES, rowsOf } from '../../server/data/tables';
import { loadWhole } from '../../server/data/whole';
import type { ImportRow, ServerRows } from '../../server/office/import';
import type { ExportManifest } from '../backup/officeExport';

/**
 * Where an import takes its office from (Supabase exit, wave 4): a State (the test seed, the year office of the tests), an export
 * folder of an office object (a restore into a new object, the round trip), or a Postgres copy (the test copy in wave 5, a copy of
 * production for the rehearsal, the switch of wave 6). Each gives the records with their server columns, the server rows of spec
 * section 4 step 3, and the sign-in rows of wave 2.
 */

export type ImportTable = { table: string; rows: ImportRow[] };
export type OfficeSource = { tables: ImportTable[]; server: ServerRows; signin: SigninExportRow[]; records: number; users: ReadonlySet<string> };
export type PgQuery = (text: string, values?: unknown[]) => Promise<Record<string, unknown>[]>;

const NO_SERVER_ROWS: Omit<ServerRows, 'counters' | 'officeSeq' | 'version'> = { personSeq: [], mailLog: [], usageMonth: [], usageWarnings: [], jobRuns: [] };

function sourceOf(state: State, server: ServerRows, signin: SigninExportRow[]): OfficeSource {
  // A State with no settings record (an office that never had one) gives no settings row: the schema of the object makes it.
  const tables = TABLES.map((spec) => ({
    table: spec.table,
    rows: rowsOf(state, spec).filter((row) => row.doc !== undefined).map((row) => rowOf(spec, row.doc, state)),
  }));
  return { tables, server, signin, records: tables.reduce((sum, t) => sum + t.rows.length, 0), users: new Set(Object.keys(state.users)) };
}

export function stateSource(state: State, o: { signin?: SigninExportRow[]; server?: Partial<ServerRows> } = {}): OfficeSource {
  const server: ServerRows = {
    counters: Object.entries(state.counters).map(([prefix, n]) => ({ prefix, n })),
    // A State has no office signal of its own; the copy starts at 0. The event numbers are in counters.
    officeSeq: 0,
    version: 0,
    ...NO_SERVER_ROWS,
    ...o.server,
  };
  return sourceOf(state, server, o.signin ?? []);
}

const num = (value: unknown): number => Number(value ?? 0);
const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value));
const isoOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : iso(value));
const textOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

/** The server rows of Postgres. Each bigint comes as text (pg), each day as text (a pg date would become a Date of the Mac's zone). */
export const PG_SERVER_SQL = {
  counters: 'select prefix, n from counters',
  meta: 'select version::text as version, office_seq::text as office_seq from office_meta where id = 1',
  personSeq: 'select user_id, seq::text as seq from person_seq',
  mailLog: "select utc_day::text as utc_day, kind, user_id, ref, resend_id, created_at from mail_log where utc_day >= ((now() at time zone 'utc')::date - 1)",
  usageMonth: 'select month, calls::text as calls, bytes_read::text as bytes_read, backup_bytes::text as backup_bytes, signals_failed, signals_failed_at from usage_month',
  usageWarnings: 'select month, metric, sent_at from usage_warnings',
  jobRuns: 'select key, done_at from job_runs',
} as const;

/**
 * One copy of Postgres, read inside one read-only snapshot (repeatable read), so the records, the server rows and the sign-in rows
 * belong to one moment, and no write of the copy waits for the read. SIGNIN_EXPORT_SQL reads auth.users: the role must be postgres.
 */
export async function pgSource(query: PgQuery): Promise<OfficeSource> {
  await query('begin isolation level repeatable read read only');
  let done = false;
  try {
    const q: Query = (async (text: string, values: unknown[] = []) => query(text, values)) as Query;
    const state = await loadWhole(q);
    const [meta] = await query(PG_SERVER_SQL.meta);
    const server: ServerRows = {
      counters: (await query(PG_SERVER_SQL.counters)).map((r) => ({ prefix: String(r.prefix), n: num(r.n) })),
      officeSeq: num(meta?.office_seq),
      version: num(meta?.version),
      personSeq: (await query(PG_SERVER_SQL.personSeq)).map((r) => ({ user_id: String(r.user_id), seq: num(r.seq) })),
      mailLog: (await query(PG_SERVER_SQL.mailLog)).map((r) => ({
        utc_day: String(r.utc_day), kind: String(r.kind), user_id: textOrNull(r.user_id), ref: String(r.ref),
        resend_id: textOrNull(r.resend_id), created_at: iso(r.created_at),
      })),
      usageMonth: (await query(PG_SERVER_SQL.usageMonth)).map((r) => ({
        month: String(r.month), calls: num(r.calls), bytes_read: num(r.bytes_read), backup_bytes: r.backup_bytes === null || r.backup_bytes === undefined ? null : num(r.backup_bytes),
        signals_failed: num(r.signals_failed), signals_failed_at: isoOrNull(r.signals_failed_at),
      })),
      usageWarnings: (await query(PG_SERVER_SQL.usageWarnings)).map((r) => ({ month: String(r.month), metric: String(r.metric), sent_at: iso(r.sent_at) })),
      jobRuns: (await query(PG_SERVER_SQL.jobRuns)).map((r) => ({ key: String(r.key), done_at: iso(r.done_at) })),
    };
    const signin = (await query(SIGNIN_EXPORT_SQL)).map((r) => ({
      id: String(r.id), email: String(r.email), password_hash: textOrNull(r.password_hash), email_confirmed: r.email_confirmed === true,
      banned: r.banned === true, password_set: r.password_set === true, user_id: textOrNull(r.user_id),
    }));
    await query('commit');
    done = true;
    return sourceOf(state, server, signin);
  } finally {
    if (!done) await query('rollback').catch(() => undefined);
  }
}

type ExportRowOf = Record<string, string | number | null>;

function readTable(folder: string, table: string): ExportRowOf[] {
  const text = readFileSync(join(folder, 'tables', `${table}.ndjson`), 'utf8');
  return text.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as ExportRowOf);
}

/** The day before a day (YYYY-MM-DD), in UTC. */
function dayBefore(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** An export folder of an office object (scripts/backup/officeExport.ts), as a source: a restore into a new object, the round trip. */
export function exportSource(folder: string, o: { today: string }): OfficeSource {
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as ExportManifest;
  const tables = TABLES.map((spec) => ({
    table: spec.table,
    rows: readTable(folder, spec.table).map((row) => ({
      id: String(row.id),
      doc: JSON.parse(String(row.doc)) as Record<string, unknown>,
      columns: Object.fromEntries(Object.keys(spec.serverColumns ?? {}).map((name) => [name, row[name] ?? null])),
    })),
  }));
  // The mail log of today and yesterday, as pgSource reads it: older rows guard no mail of the day.
  const yesterday = dayBefore(o.today);
  const server: ServerRows = {
    counters: readTable(folder, 'counters').map((r) => ({ prefix: String(r.prefix), n: num(r.n) })),
    officeSeq: manifest.officeSeq,
    version: manifest.version,
    personSeq: readTable(folder, 'person_seq').map((r) => ({ user_id: String(r.user_id), seq: num(r.seq) })),
    mailLog: readTable(folder, 'mail_log').filter((r) => String(r.utc_day) >= yesterday).map((r) => ({
      utc_day: String(r.utc_day), kind: String(r.kind), user_id: textOrNull(r.user_id), ref: String(r.ref),
      resend_id: textOrNull(r.resend_id), created_at: String(r.created_at),
    })),
    usageMonth: readTable(folder, 'usage_month').map((r) => ({
      month: String(r.month), calls: num(r.calls), bytes_read: num(r.bytes_read), backup_bytes: r.backup_bytes === null ? null : num(r.backup_bytes),
      signals_failed: num(r.signals_failed), signals_failed_at: textOrNull(r.signals_failed_at),
    })),
    usageWarnings: readTable(folder, 'usage_warnings').map((r) => ({ month: String(r.month), metric: String(r.metric), sent_at: String(r.sent_at) })),
    jobRuns: readTable(folder, 'job_runs').map((r) => ({ key: String(r.key), done_at: String(r.done_at) })),
  };
  // A restore brings the people and their passwords; the sessions, links and OAuth rows stay out: each person signs in again.
  const signin: SigninExportRow[] = readTable(folder, 'auth_users').map((r) => ({
    id: String(r.id), email: String(r.email), password_hash: textOrNull(r.password_hash), email_confirmed: num(r.email_confirmed) === 1,
    banned: num(r.banned) === 1, password_set: num(r.password_set) === 1, user_id: textOrNull(r.user_id),
  }));
  const users = new Set(tables.find((t) => t.table === 'users')!.rows.map((row) => row.id));
  return { tables, server, signin, records: tables.reduce((sum, t) => sum + t.rows.length, 0), users };
}
