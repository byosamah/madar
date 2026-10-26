import type { Query } from '../core/ports';
import { isLite, sqlFor } from '../data/dialect';
import type { DaftraInvoice } from './parse';
import type { CachedInvoice } from './suggest';

/**
 * The two server-only tables of the Daftra link (supabase/migrations/20261026000100_daftra.sql): daftra_clients (the match of a Madar client
 * to a Daftra client) and daftra_invoices (the cache of recent invoices), and the job_runs rows that hold the state of the last read. No State
 * collection reads them, so no handler, loader, event, signal or export of the office ever sees them. Each statement has a Postgres text and a
 * SQLite twin, picked with sqlFor from the query that runs it.
 *
 * Every time and day reads back as text (ISO), whatever the database: the Postgres selects cast them to text, so one parser serves both.
 * Money is whole halalas, and a Postgres bigint reads back as text too, so each function gives a number.
 */

export type DaftraMatch = { clientId: string; daftraId: string; daftraName: string; matchedBy: string; matchedAt: string };

type MatchRow = { client_id: string; daftra_id: string; daftra_name: string; matched_by: string; matched_at: string | Date };

const iso = (value: string | Date): string => new Date(value).toISOString();

const matchFrom = (row: MatchRow): DaftraMatch => ({
  clientId: row.client_id, daftraId: row.daftra_id, daftraName: row.daftra_name, matchedBy: row.matched_by, matchedAt: iso(row.matched_at),
});

const MATCH_SQL = 'select client_id, daftra_id, daftra_name, matched_by, matched_at from daftra_clients where client_id = $1';
const MATCH_LITE = 'select client_id, daftra_id, daftra_name, matched_by, matched_at from daftra_clients where client_id = ?1';

/** The match of one Madar client, or undefined. */
export async function clientMatch(q: Query, clientId: string): Promise<DaftraMatch | undefined> {
  const [row] = await q<MatchRow>(sqlFor(q, MATCH_SQL, MATCH_LITE), [clientId]);
  return row ? matchFrom(row) : undefined;
}

const ALL_MATCHES_SQL = 'select client_id, daftra_id, daftra_name, matched_by, matched_at from daftra_clients order by client_id';
const ALL_MATCHES_LITE = ALL_MATCHES_SQL;

/** Every match, by Madar client id. The job reads it to know which Daftra clients to look at. */
export async function allMatches(q: Query): Promise<DaftraMatch[]> {
  return (await q<MatchRow>(sqlFor(q, ALL_MATCHES_SQL, ALL_MATCHES_LITE))).map(matchFrom);
}

const PUT_MATCH_SQL =
  'insert into daftra_clients (client_id, daftra_id, daftra_name, matched_by, matched_at) values ($1, $2, $3, $4, $5) '
  + 'on conflict (client_id) do update set daftra_id = excluded.daftra_id, daftra_name = excluded.daftra_name, matched_by = excluded.matched_by, matched_at = excluded.matched_at';
const PUT_MATCH_LITE =
  'insert into daftra_clients (client_id, daftra_id, daftra_name, matched_by, matched_at) values (?1, ?2, ?3, ?4, ?5) '
  + 'on conflict (client_id) do update set daftra_id = excluded.daftra_id, daftra_name = excluded.daftra_name, matched_by = excluded.matched_by, matched_at = excluded.matched_at';

/** Saves the match of a Madar client. A second match replaces the first. */
export async function putMatch(q: Query, m: { clientId: string; daftraId: string; daftraName: string; matchedBy: string; at: Date }): Promise<void> {
  await q(sqlFor(q, PUT_MATCH_SQL, PUT_MATCH_LITE), [m.clientId, m.daftraId, m.daftraName, m.matchedBy, m.at.toISOString()]);
}

type InvoiceRow = {
  id: string; no: string; total_halalas: string | number; issued_on: string; created_at: string | Date; payment_status: number | string;
  paid_on: string | null; draft: boolean | number;
};

const INVOICE_COLUMNS_SQL = 'id, no, total_halalas::text as total_halalas, issued_on::text as issued_on, created_at, payment_status, paid_on::text as paid_on, draft';
const INVOICE_COLUMNS_LITE = 'id, no, total_halalas, issued_on, created_at, payment_status, paid_on, draft';

const invoiceOf = (row: InvoiceRow): CachedInvoice => ({
  id: row.id, no: row.no, totalHalalas: Number(row.total_halalas), issuedOn: String(row.issued_on).slice(0, 10), createdAt: iso(row.created_at),
  paymentStatus: Number(row.payment_status), paidOn: row.paid_on === null ? null : String(row.paid_on).slice(0, 10), draft: row.draft === true || row.draft === 1,
});

/** The most invoices of one client that the cache returns. The job and the match each keep at most 50 per read, so this is a ceiling. */
export const CACHE_READ_MAX = 100;

const OF_CLIENT_SQL = `select ${INVOICE_COLUMNS_SQL} from daftra_invoices where daftra_client_id = $1 order by created_at desc, id desc limit ${CACHE_READ_MAX}`;
const OF_CLIENT_LITE = `select ${INVOICE_COLUMNS_LITE} from daftra_invoices where daftra_client_id = ?1 order by created_at desc, id desc limit ${CACHE_READ_MAX}`;

/** The cached invoices of one Daftra client, newest first. */
export async function cachedInvoicesOf(q: Query, daftraClientId: string): Promise<CachedInvoice[]> {
  return (await q<InvoiceRow>(sqlFor(q, OF_CLIENT_SQL, OF_CLIENT_LITE), [daftraClientId])).map(invoiceOf);
}

// The list form has no payment rows, so a list read must never erase a paid day that an earlier read of the single form kept.
const PUT_INVOICE_SQL =
  'insert into daftra_invoices (id, daftra_client_id, no, total_halalas, issued_on, created_at, payment_status, paid_on, draft, seen_at) '
  + 'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) '
  + 'on conflict (id) do update set daftra_client_id = excluded.daftra_client_id, no = excluded.no, total_halalas = excluded.total_halalas, '
  + 'issued_on = excluded.issued_on, created_at = excluded.created_at, payment_status = excluded.payment_status, '
  + 'paid_on = coalesce(excluded.paid_on, daftra_invoices.paid_on), draft = excluded.draft, seen_at = excluded.seen_at';
const PUT_INVOICE_LITE =
  'insert into daftra_invoices (id, daftra_client_id, no, total_halalas, issued_on, created_at, payment_status, paid_on, draft, seen_at) '
  + 'values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) '
  + 'on conflict (id) do update set daftra_client_id = excluded.daftra_client_id, no = excluded.no, total_halalas = excluded.total_halalas, '
  + 'issued_on = excluded.issued_on, created_at = excluded.created_at, payment_status = excluded.payment_status, '
  + 'paid_on = coalesce(excluded.paid_on, daftra_invoices.paid_on), draft = excluded.draft, seen_at = excluded.seen_at';

/** Saves the invoices that one read of Daftra gave. An invoice that is there already is updated in place. */
export async function putInvoices(q: Query, invoices: readonly DaftraInvoice[], at: Date): Promise<void> {
  const lite = isLite(q);
  for (const invoice of invoices) {
    await q(sqlFor(q, PUT_INVOICE_SQL, PUT_INVOICE_LITE), [
      invoice.id, invoice.clientId, invoice.no, invoice.totalHalalas, invoice.issuedOn, invoice.createdAt, invoice.paymentStatus,
      invoice.paidOn, lite ? (invoice.draft ? 1 : 0) : invoice.draft, at.toISOString(),
    ]);
  }
}

const TAKEN_SQL = "select doc->'daftra'->>'invoiceId' as invoice_id from payments where doc->'daftra'->>'invoiceId' = any($1::text[]) and id <> $2";
const TAKEN_LITE =
  "select json_extract(doc, '$.daftra.invoiceId') as invoice_id from payments where json_extract(doc, '$.daftra.invoiceId') in (select value from json_each(?1)) and id <> ?2";

/** The invoice ids (of these) that a payment other than `exceptPaymentId` holds. */
export async function takenInvoiceIds(q: Query, ids: readonly string[], exceptPaymentId: string): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await q<{ invoice_id: string }>(sqlFor(q, TAKEN_SQL, TAKEN_LITE), [[...ids], exceptPaymentId]);
  return new Set(rows.map((row) => row.invoice_id));
}

// ---- The state of the last read, in job_runs (key text primary key, done_at). daftra:read is the last good read. daftra:problem:<code> is the last problem.

export type DaftraProblem = 'bad_key' | 'refused' | 'unreachable';
export const PROBLEM_CODES: readonly DaftraProblem[] = ['bad_key', 'refused', 'unreachable'];
const READ_KEY = 'daftra:read';
const PROBLEM_PREFIX = 'daftra:problem:';

const STATE_SQL = "select key, done_at from job_runs where key = 'daftra:read' or key like 'daftra:problem:%'";
const STATE_LITE = STATE_SQL;

/** When Madar last read Daftra without a problem, and the problem of the last run, if any. */
export async function readState(q: Query): Promise<{ lastReadAt: string | null; problem: DaftraProblem | null }> {
  const rows = await q<{ key: string; done_at: string | Date }>(sqlFor(q, STATE_SQL, STATE_LITE));
  const read = rows.find((row) => row.key === READ_KEY);
  const problems = rows.filter((row) => row.key.startsWith(PROBLEM_PREFIX)).sort((a, b) => (iso(a.done_at) < iso(b.done_at) ? 1 : -1));
  const code = problems[0]?.key.slice(PROBLEM_PREFIX.length);
  return { lastReadAt: read ? iso(read.done_at) : null, problem: PROBLEM_CODES.find((c) => c === code) ?? null };
}

const PUT_STATE_SQL = "insert into job_runs (key, done_at) values ($1, $2) on conflict (key) do update set done_at = excluded.done_at";
const PUT_STATE_LITE = "insert into job_runs (key, done_at) values (?1, ?2) on conflict (key) do update set done_at = excluded.done_at";
const CLEAR_PROBLEMS_SQL = "delete from job_runs where key like 'daftra:problem:%' and key <> $1";
const CLEAR_PROBLEMS_LITE = "delete from job_runs where key like 'daftra:problem:%' and key <> ?1";

/** A run that read Daftra without a problem: the time of the read is saved and every problem row goes. */
export async function saveGoodRead(q: Query, at: Date): Promise<void> {
  await q(sqlFor(q, PUT_STATE_SQL, PUT_STATE_LITE), [READ_KEY, at.toISOString()]);
  await q(sqlFor(q, CLEAR_PROBLEMS_SQL, CLEAR_PROBLEMS_LITE), [`${PROBLEM_PREFIX}none`]);
}

/** A run that met a problem: the row of this problem is saved and the rows of other problems go. The time of the last good read stays. */
export async function saveProblem(q: Query, problem: DaftraProblem, at: Date): Promise<void> {
  const key = `${PROBLEM_PREFIX}${problem}`;
  await q(sqlFor(q, PUT_STATE_SQL, PUT_STATE_LITE), [key, at.toISOString()]);
  await q(sqlFor(q, CLEAR_PROBLEMS_SQL, CLEAR_PROBLEMS_LITE), [key]);
}
