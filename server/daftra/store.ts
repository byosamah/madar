import type { Query } from '../core/ports';
import { isLite, sqlFor } from '../data/dialect';
import type { DaftraInvoice } from './parse';
import type { CachedInvoice } from './suggest';

/**
 * The two server-only tables of the Daftra link (supabase/migrations/20261026000100_daftra.sql): daftra_clients (the match of a Madar client
 * to a Daftra client) and daftra_invoices (the cache of recent invoices), and the job_runs rows that hold the state of the last read of each
 * account. No State collection reads them, so no handler, loader, event, signal or export of the office ever sees them. Each statement has a Postgres text and a
 * SQLite twin, picked with sqlFor from the query that runs it.
 *
 * Every time and day reads back as text (ISO), whatever the database: the Postgres selects cast them to text, so one parser serves both.
 * Money is whole halalas, and a Postgres bigint reads back as text too, so each function gives a number.
 */

/**
 * Every row has an account (one Daftra account for each sub-company, owner 2026-10-26). Invoice ids repeat across accounts, so an invoice is
 * known by its account and its id together, and so is "held by another payment".
 */

export type DaftraMatch = { account: string; clientId: string; daftraId: string; daftraName: string; matchedBy: string; matchedAt: string };

type MatchRow = { account: string; client_id: string; daftra_id: string; daftra_name: string; matched_by: string; matched_at: string | Date };

const iso = (value: string | Date): string => new Date(value).toISOString();

const matchFrom = (row: MatchRow): DaftraMatch => ({
  account: row.account, clientId: row.client_id, daftraId: row.daftra_id, daftraName: row.daftra_name, matchedBy: row.matched_by, matchedAt: iso(row.matched_at),
});

const MATCH_COLUMNS = 'account, client_id, daftra_id, daftra_name, matched_by, matched_at';
const MATCH_SQL = `select ${MATCH_COLUMNS} from daftra_clients where account = $1 and client_id = $2`;
const MATCH_LITE = `select ${MATCH_COLUMNS} from daftra_clients where account = ?1 and client_id = ?2`;

/** The match of one Madar client in one account, or undefined. */
export async function clientMatch(q: Query, account: string, clientId: string): Promise<DaftraMatch | undefined> {
  const [row] = await q<MatchRow>(sqlFor(q, MATCH_SQL, MATCH_LITE), [account, clientId]);
  return row ? matchFrom(row) : undefined;
}

const ALL_MATCHES_SQL = `select ${MATCH_COLUMNS} from daftra_clients order by account, client_id`;
const ALL_MATCHES_LITE = ALL_MATCHES_SQL;

/** Every match of every account, by account and Madar client id. The job reads it to know which Daftra clients to look at. */
export async function allMatches(q: Query): Promise<DaftraMatch[]> {
  return (await q<MatchRow>(sqlFor(q, ALL_MATCHES_SQL, ALL_MATCHES_LITE))).map(matchFrom);
}

const PUT_MATCH_SQL =
  'insert into daftra_clients (account, client_id, daftra_id, daftra_name, matched_by, matched_at) values ($1, $2, $3, $4, $5, $6) '
  + 'on conflict (account, client_id) do update set daftra_id = excluded.daftra_id, daftra_name = excluded.daftra_name, matched_by = excluded.matched_by, matched_at = excluded.matched_at';
const PUT_MATCH_LITE =
  'insert into daftra_clients (account, client_id, daftra_id, daftra_name, matched_by, matched_at) values (?1, ?2, ?3, ?4, ?5, ?6) '
  + 'on conflict (account, client_id) do update set daftra_id = excluded.daftra_id, daftra_name = excluded.daftra_name, matched_by = excluded.matched_by, matched_at = excluded.matched_at';

/** Saves the match of a Madar client in one account. A second match in the same account replaces the first. */
export async function putMatch(q: Query, m: { account: string; clientId: string; daftraId: string; daftraName: string; matchedBy: string; at: Date }): Promise<void> {
  await q(sqlFor(q, PUT_MATCH_SQL, PUT_MATCH_LITE), [m.account, m.clientId, m.daftraId, m.daftraName, m.matchedBy, m.at.toISOString()]);
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

const OF_CLIENT_SQL = `select ${INVOICE_COLUMNS_SQL} from daftra_invoices where account = $1 and daftra_client_id = $2 order by created_at desc, id desc limit ${CACHE_READ_MAX}`;
const OF_CLIENT_LITE = `select ${INVOICE_COLUMNS_LITE} from daftra_invoices where account = ?1 and daftra_client_id = ?2 order by created_at desc, id desc limit ${CACHE_READ_MAX}`;

/** The cached invoices of one Daftra client in one account, newest first. */
export async function cachedInvoicesOf(q: Query, account: string, daftraClientId: string): Promise<CachedInvoice[]> {
  return (await q<InvoiceRow>(sqlFor(q, OF_CLIENT_SQL, OF_CLIENT_LITE), [account, daftraClientId])).map(invoiceOf);
}

// The list form has no payment rows, so a list read must never erase a paid day that an earlier read of the single form kept.
const PUT_INVOICE_SQL =
  'insert into daftra_invoices (account, id, daftra_client_id, no, total_halalas, issued_on, created_at, payment_status, paid_on, draft, seen_at) '
  + 'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) '
  + 'on conflict (account, id) do update set daftra_client_id = excluded.daftra_client_id, no = excluded.no, total_halalas = excluded.total_halalas, '
  + 'issued_on = excluded.issued_on, created_at = excluded.created_at, payment_status = excluded.payment_status, '
  + 'paid_on = coalesce(excluded.paid_on, daftra_invoices.paid_on), draft = excluded.draft, seen_at = excluded.seen_at';
const PUT_INVOICE_LITE =
  'insert into daftra_invoices (account, id, daftra_client_id, no, total_halalas, issued_on, created_at, payment_status, paid_on, draft, seen_at) '
  + 'values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) '
  + 'on conflict (account, id) do update set daftra_client_id = excluded.daftra_client_id, no = excluded.no, total_halalas = excluded.total_halalas, '
  + 'issued_on = excluded.issued_on, created_at = excluded.created_at, payment_status = excluded.payment_status, '
  + 'paid_on = coalesce(excluded.paid_on, daftra_invoices.paid_on), draft = excluded.draft, seen_at = excluded.seen_at';

/** Saves the invoices that one read of one account gave. An invoice that is there already (same account, same id) is updated in place. */
export async function putInvoices(q: Query, account: string, invoices: readonly DaftraInvoice[], at: Date): Promise<void> {
  const lite = isLite(q);
  for (const invoice of invoices) {
    await q(sqlFor(q, PUT_INVOICE_SQL, PUT_INVOICE_LITE), [
      account, invoice.id, invoice.clientId, invoice.no, invoice.totalHalalas, invoice.issuedOn, invoice.createdAt, invoice.paymentStatus,
      invoice.paidOn, lite ? (invoice.draft ? 1 : 0) : invoice.draft, at.toISOString(),
    ]);
  }
}

const TAKEN_SQL =
  "select doc->'daftra'->>'invoiceId' as invoice_id from payments where doc->'daftra'->>'account' = $1 and doc->'daftra'->>'invoiceId' = any($2::text[]) and id <> $3";
const TAKEN_LITE =
  "select json_extract(doc, '$.daftra.invoiceId') as invoice_id from payments where json_extract(doc, '$.daftra.account') = ?1 "
  + "and json_extract(doc, '$.daftra.invoiceId') in (select value from json_each(?2)) and id <> ?3";

/** The invoice ids (of these, in this account) that a payment other than `exceptPaymentId` holds. Another account's invoice of the same id never counts. */
export async function takenInvoiceIds(q: Query, account: string, ids: readonly string[], exceptPaymentId: string): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await q<{ invoice_id: string }>(sqlFor(q, TAKEN_SQL, TAKEN_LITE), [account, isLite(q) ? JSON.stringify([...ids]) : [...ids], exceptPaymentId]);
  return new Set(rows.map((row) => row.invoice_id));
}

// ---- The state of the last read of each account, in job_runs (key text primary key, done_at).
// daftra:read:<ACCOUNT> is the last good read of that account. daftra:problem:<ACCOUNT>:<code> is its last problem (one at a time).

export type DaftraProblem = 'bad_key' | 'refused' | 'unreachable';
export const PROBLEM_CODES: readonly DaftraProblem[] = ['bad_key', 'refused', 'unreachable'];
const READ_PREFIX = 'daftra:read:';
const PROBLEM_PREFIX = 'daftra:problem:';

const STATE_SQL = "select key, done_at from job_runs where key like 'daftra:read:%' or key like 'daftra:problem:%'";
const STATE_LITE = STATE_SQL;

export type AccountState = { lastReadAt: string | null; problem: DaftraProblem | null };

/** When Madar last read each account without a problem, and the problem of its last run, if any. An account the job never saw is not in the answer. */
export async function readStates(q: Query): Promise<Record<string, AccountState>> {
  const rows = await q<{ key: string; done_at: string | Date }>(sqlFor(q, STATE_SQL, STATE_LITE));
  const states: Record<string, AccountState> = {};
  const of = (account: string): AccountState => (states[account] ??= { lastReadAt: null, problem: null });
  for (const row of rows) {
    if (row.key.startsWith(READ_PREFIX)) of(row.key.slice(READ_PREFIX.length)).lastReadAt = iso(row.done_at);
  }
  const newest: Record<string, string> = {};
  for (const row of rows) {
    if (!row.key.startsWith(PROBLEM_PREFIX)) continue;
    const [account, code] = row.key.slice(PROBLEM_PREFIX.length).split(':');
    const problem = PROBLEM_CODES.find((c) => c === code);
    if (!account || !problem) continue;
    const at = iso(row.done_at);
    const state = of(account);
    if (newest[account] === undefined || at > newest[account]) {
      newest[account] = at;
      state.problem = problem;
    }
  }
  return states;
}

const PUT_STATE_SQL = "insert into job_runs (key, done_at) values ($1, $2) on conflict (key) do update set done_at = excluded.done_at";
const PUT_STATE_LITE = "insert into job_runs (key, done_at) values (?1, ?2) on conflict (key) do update set done_at = excluded.done_at";
const CLEAR_PROBLEMS_SQL = "delete from job_runs where key like $1 and key <> $2";
const CLEAR_PROBLEMS_LITE = "delete from job_runs where key like ?1 and key <> ?2";

/** A run that read one account without a problem: the time of the read is saved and every problem row of that account goes. */
export async function saveGoodRead(q: Query, account: string, at: Date): Promise<void> {
  await q(sqlFor(q, PUT_STATE_SQL, PUT_STATE_LITE), [`${READ_PREFIX}${account}`, at.toISOString()]);
  await q(sqlFor(q, CLEAR_PROBLEMS_SQL, CLEAR_PROBLEMS_LITE), [`${PROBLEM_PREFIX}${account}:%`, `${PROBLEM_PREFIX}${account}:none`]);
}

/** A run that met a problem in one account: the row of this problem is saved and the other problem rows of that account go. The last good read stays. */
export async function saveProblem(q: Query, account: string, problem: DaftraProblem, at: Date): Promise<void> {
  const key = `${PROBLEM_PREFIX}${account}:${problem}`;
  await q(sqlFor(q, PUT_STATE_SQL, PUT_STATE_LITE), [key, at.toISOString()]);
  await q(sqlFor(q, CLEAR_PROBLEMS_SQL, CLEAR_PROBLEMS_LITE), [`${PROBLEM_PREFIX}${account}:%`, key]);
}

// ---- One payment, for the calls that read the cache for it and for the preflight of payments.linkInvoice.

export type PaymentFacts = {
  id: string; projectId: string; amount: number; dueDate: string; receivedOn: string | null;
  daftra?: { account: string; invoiceId: string; linkedBy: string; linkedAt: string };
};

const PAYMENT_SQL = 'select doc from payments where id = $1';
const PAYMENT_LITE = 'select doc from payments where id = ?1';

/** The facts of one payment that the Daftra calls need. The caller checks that the person may see its project. */
export async function paymentFacts(q: Query, id: string): Promise<PaymentFacts | undefined> {
  const [row] = await q<{ doc: PaymentFacts }>(sqlFor(q, PAYMENT_SQL, PAYMENT_LITE), [id]);
  return row?.doc;
}

/** The most payments that the job reads in one run for each of its two lists. The budget of the run (20 Daftra calls) is far smaller. */
export const JOB_READ_MAX = 500;

const LINKED_SQL =
  `select doc from payments where doc->'daftra' is not null and doc->>'receivedOn' is null order by doc->'daftra'->>'linkedAt' collate "C", id limit ${JOB_READ_MAX}`;
const LINKED_LITE =
  `select doc from payments where json_extract(doc, '$.daftra') is not null and json_extract(doc, '$.receivedOn') is null order by json_extract(doc, '$.daftra.linkedAt'), id limit ${JOB_READ_MAX}`;

/** The payments that have a Daftra invoice and no received day, the oldest link first. The paid check of the job reads them. */
export async function linkedUnpaid(q: Query): Promise<PaymentFacts[]> {
  return (await q<{ doc: PaymentFacts }>(sqlFor(q, LINKED_SQL, LINKED_LITE))).map((row) => row.doc);
}

const OPEN_SQL =
  `select doc from payments where doc->'daftra' is null and doc->>'receivedOn' is null and doc->>'dueDate' collate "C" <= $1 order by doc->>'dueDate' collate "C", id limit ${JOB_READ_MAX}`;
const OPEN_LITE =
  `select doc from payments where json_extract(doc, '$.daftra') is null and json_extract(doc, '$.receivedOn') is null and json_extract(doc, '$.dueDate') <= ?1 order by json_extract(doc, '$.dueDate'), id limit ${JOB_READ_MAX}`;

/** The payments with no invoice and no received day that fall due on or before `lastDay`, past due ones included. The cache fill of the job reads them. */
export async function openUnlinked(q: Query, lastDay: string): Promise<PaymentFacts[]> {
  return (await q<{ doc: PaymentFacts }>(sqlFor(q, OPEN_SQL, OPEN_LITE), [lastDay])).map((row) => row.doc);
}
