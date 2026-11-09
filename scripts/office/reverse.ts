// The reverse export (Supabase exit, wave 4; spec section 4, "The way back"): an export folder of an office object back into the
// Postgres of a copy.
//
//   npx tsx scripts/office/reverse.ts --from-export <folder> --to local
//   npx tsx scripts/office/reverse.ts --from-office <page address> --office rehearsal-YYYYMMDD --to local      (the rehearsal of wave 5)
//   npx tsx scripts/office/reverse.ts --from-office <page address> --to test --yes-replace      (the way back of the test copy; owner OK)
//   npx tsx scripts/office/reverse.ts --from-office https://madar.vado.sa --office ent_001 --to production --yes-replace
//       (the way back of production after writes on the object, plan E; the owner says yes first; it asks for the typed word production)
//
// In one transaction under the office lock: it raises the office version above the version of the object, records every office row as
// deleted (a warm office cache drops it), empties the Madar tables, writes the records with writeState, sets the office signal number and
// the person numbers, writes the Google rows (google_connections, google_events, google_calendars) and the Daftra rows (daftra_clients,
// daftra_invoices) back, so nobody connects Google again and the accountant does not match the clients again, takes the job runs and the
// mail log of the day back (no second morning summary), and links each person to the Supabase sign-in of the same id. A person with no
// Supabase sign-in (a person who joined after the switch) is in the report: the Admin sends that person an invitation again.
// A test or local target empties the tables of the test seed (TRUNCATE_SQL). A production target empties only what it writes back and the
// derived office_copy (REVERSE_SERVER_TABLES lists every server table): the agent links, the outbox and the meters of Supabase stay as they are.
// Then it reads Postgres back and compares each table, the Google and Daftra tables included, with the export; a difference exits 1.
// With --from-office it exports the object into a private folder first and removes that folder at the end.
// A production target needs --yes-replace, --office ent_001, --from-office with the page address of production and the typed word
// production. A refused argument ends with exit code 2 and a wrong typed word with exit code 1, each before any secret, network or
// database call. The secrets come from secrets/production.env (the export secret) and from MADAR_DB_PASSWORD of the environment; the
// script never prints them. Only this script, import.ts and register-company.ts may take production as a target (targetOf).
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { emptyState, type State } from '../../src/api/store';
import { takeOfficeLock } from '../../server/core/lock';
import type { Query } from '../../server/core/ports';
import { EXPORT_SECRET_HEADER } from '../../server/entries/officeWorker';
import { setAuthUserId } from '../../server/data/officeCache';
import { ENT_VADO } from '../../server/enterprise/ids';
import { COUNTERS_TABLE, TABLES, collectionOf } from '../../server/data/tables';
import { writeState } from '../../server/data/whole';
import { exportOffice } from '../backup/officeExport';
import { POOLER_HOST, REFS } from '../deploy/secrets';
import { RECORD_DELETES_SQL, SEED_LOCK_TIMEOUT_SQL, TRUNCATE_SQL } from '../seed-test-office';
import { sourceDigests } from './compare';
import { ArgumentError, askTypedWord, copyValuesOf, flagOf, postgresOf, targetOf } from './import';
import { opsOf } from './ops';
import { exportSource, pgSource, type OfficeSource, type PgQuery } from './source';

export type ReverseReport = { records: number; linked: number; needInvite: { userId: string; email: string }[] };

/** The State of a source: every record by its collection, and the counters. */
export function stateOfSource(source: OfficeSource, today: string): State {
  const state = { ...emptyState(today), feedback: {} } as State;
  const lists = state as unknown as Record<string, unknown>;
  for (const spec of TABLES) {
    const table = source.tables.find((t) => t.table === spec.table);
    lists[spec.collection] = collectionOf(spec, (table?.rows ?? []).map((row) => row.doc));
  }
  state.counters = Object.fromEntries(source.server.counters.map((c) => [c.prefix, c.n]));
  return state;
}

export const AUTH_IDS_SQL = 'select id::text as id from auth.users where id = any($1::uuid[])';
export const REVERSE_OFFICE_SEQ_SQL = 'update office_meta set office_seq = $1 where id = 1';
export const REVERSE_PERSON_SEQ_SQL = 'insert into person_seq (user_id, seq) values ($1, $2) on conflict (user_id) do update set seq = excluded.seq';
/** The job runs of the object: a summary row of the day stops a second morning summary from the Supabase job. */
export const REVERSE_JOB_RUNS_SQL = 'insert into job_runs (key, done_at) values ($1, $2::timestamptz) on conflict (key) do update set done_at = greatest(job_runs.done_at, excluded.done_at)';
/** The mail log of the day (the Resend day quota and the mails that went out), as the import carries it in. */
export const REVERSE_MAIL_LOG_SQL =
  'insert into mail_log (utc_day, kind, user_id, ref, resend_id, created_at) values ($1::date, $2, $3, $4, $5, $6::timestamptz) on conflict (utc_day, ref) do nothing';
/**
 * The office version of Postgres goes above the version of the object before any other write: the rows of the way back then get a
 * version that no open screen or warm cache holds (the import does the same in the other direction).
 */
export const REVERSE_VERSION_SQL = 'update office_meta set version = greatest(version, $1::bigint) where id = 1';
/** The Google and Daftra rows of the object (plan E, Task H). Each statement is an upsert on the key, so a second run sets the same rows. */
export const REVERSE_GOOGLE_CONNECTION_SQL =
  'insert into google_connections (id, user_id, sealed_token, calendar_id, state, connected_at, last_error, last_error_at, changed_at) '
  + 'values ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8::timestamptz, $9::timestamptz) '
  + 'on conflict (id) do update set user_id = excluded.user_id, sealed_token = excluded.sealed_token, calendar_id = excluded.calendar_id, state = excluded.state, '
  + 'connected_at = excluded.connected_at, last_error = excluded.last_error, last_error_at = excluded.last_error_at, changed_at = excluded.changed_at';
export const REVERSE_GOOGLE_EVENT_SQL =
  'insert into google_events (user_id, meeting_id, event_id, synced_rev, synced_at) values ($1, $2, $3, $4::integer, $5::timestamptz) '
  + 'on conflict (user_id, meeting_id) do update set event_id = excluded.event_id, synced_rev = excluded.synced_rev, synced_at = excluded.synced_at';
export const REVERSE_GOOGLE_CALENDAR_SQL =
  'insert into google_calendars (user_id, calendar_id, changed_at) values ($1, $2, $3::timestamptz) '
  + 'on conflict (user_id) do update set calendar_id = excluded.calendar_id, changed_at = excluded.changed_at';
export const REVERSE_DAFTRA_CLIENT_SQL =
  'insert into daftra_clients (account, client_id, daftra_id, daftra_name, matched_by, matched_at) values ($1, $2, $3, $4, $5, $6::timestamptz) '
  + 'on conflict (account, client_id) do update set daftra_id = excluded.daftra_id, daftra_name = excluded.daftra_name, matched_by = excluded.matched_by, matched_at = excluded.matched_at';
export const REVERSE_DAFTRA_INVOICE_SQL =
  'insert into daftra_invoices (account, id, daftra_client_id, no, total_halalas, issued_on, created_at, payment_status, paid_on, draft, seen_at) '
  + 'values ($1, $2, $3, $4, $5::bigint, $6::date, $7::timestamptz, $8::integer, $9::date, $10::boolean, $11::timestamptz) '
  + 'on conflict (account, id) do update set daftra_client_id = excluded.daftra_client_id, no = excluded.no, total_halalas = excluded.total_halalas, '
  + 'issued_on = excluded.issued_on, created_at = excluded.created_at, payment_status = excluded.payment_status, paid_on = excluded.paid_on, '
  + 'draft = excluded.draft, seen_at = excluded.seen_at';
/**
 * What the reverse does to each server table (SERVER_TABLES), for a production target. "emptied" means that the production TRUNCATE names
 * it; the text then says how the table gets its rows again. The records tables (TABLES, push_devices among them) are emptied and
 * written with writeState, and the counters are emptied and written from the export. A table that the reverse does not write back is
 * never emptied by a production target. A test or local target runs the wider TRUNCATE_SQL of the test seed, then writes the same rows.
 */
export const REVERSE_SERVER_TABLES: Readonly<Record<string, string>> = {
  office_meta: 'kept; the version goes above the object and office_seq is set from the object',
  office_deletes: 'kept; the reverse records every old office row in it, so a warm cache drops the row',
  person_seq: 'kept; the number of each person is set from the object',
  mail_log: 'kept; the rows of the object are added and none is removed',
  usage_month: 'kept; the meters of Supabase go on as they are',
  usage_warnings: 'kept; the meters of Supabase go on as they are',
  job_runs: 'kept; the runs of the object are added and the later time wins',
  google_connections: 'emptied, written back from the object in the same transaction',
  google_events: 'emptied, written back from the object in the same transaction',
  google_calendars: 'emptied, written back from the object in the same transaction',
  daftra_clients: 'emptied, written back from the object in the same transaction',
  daftra_invoices: 'emptied, written back from the object in the same transaction',
  office_copy: 'emptied, rebuilt by the next cold read (derived data)',
  platform_config: 'kept; it holds the address and the secrets of the Supabase functions',
  stories: 'kept; a story id is good for 24 hours',
  idempotency: 'kept; a stored answer is good for minutes',
  outbox: 'kept; the object never carried it, and the effects that wait on Supabase go out with its job',
  upload_intents: 'kept; an open upload ends in minutes',
  agent_links: 'kept; the AI agents that linked before the move work again with no new link',
  mail_outbox: 'kept; only the test copy uses it',
  rate_limits: 'kept; a window ends in minutes or hours',
  agent_confirms: 'kept; a code is good for minutes',
};
const emptiedServerTables = Object.entries(REVERSE_SERVER_TABLES).filter(([, what]) => what.startsWith('emptied')).map(([table]) => table);
/** The TRUNCATE of a production target: every records table, the counters, and the server tables that the reverse writes back or rebuilds. */
export const REVERSE_PRODUCTION_TRUNCATE_SQL = `truncate ${[...TABLES.map((spec) => spec.table), COUNTERS_TABLE, ...emptiedServerTables].join(', ')} restart identity`;
/** A test or local target keeps google_calendars in TRUNCATE_SQL (a reseed keeps the calendar of a person). The reverse writes the calendars of the object, so it empties them first. */
export const REVERSE_TRUNCATE_CALENDARS_SQL = 'truncate google_calendars';

export type ReverseTarget = 'local' | 'test' | 'production';

/** madar-test as postgres, through the session pooler, with the Supabase root certificate. */
function testClient(): pg.Client {
  const password = process.env.MADAR_TEST_DB_PASSWORD;
  if (!password) throw new Error('MADAR_TEST_DB_PASSWORD is not set: load ~/dev/madar/.env.local first.');
  const ca = readFileSync(new URL('../../config/supabase-root-2021-ca.crt', import.meta.url), 'utf8');
  return new pg.Client({ host: POOLER_HOST, port: 5432, user: `postgres.${REFS.test}`, password, database: 'postgres', ssl: { ca, rejectUnauthorized: true, servername: POOLER_HOST } });
}

export async function reverseExport(query: PgQuery, source: OfficeSource, o: { lockKey: number; today: string; to?: ReverseTarget }): Promise<ReverseReport> {
  const q: Query = (async (text: string, values: unknown[] = []) => query(text, values)) as Query;
  await query('begin');
  let done = false;
  try {
    await query(SEED_LOCK_TIMEOUT_SQL);
    await takeOfficeLock(q, o.lockKey);
    await query(REVERSE_VERSION_SQL, [source.server.version]);
    await query(RECORD_DELETES_SQL);
    if (o.to === 'production') {
      await query(REVERSE_PRODUCTION_TRUNCATE_SQL);
    } else {
      await query(TRUNCATE_SQL);
      await query(REVERSE_TRUNCATE_CALENDARS_SQL);
    }
    await writeState(q, stateOfSource(source, o.today));
    await query(REVERSE_OFFICE_SEQ_SQL, [source.server.officeSeq]);
    for (const p of source.server.personSeq) await query(REVERSE_PERSON_SEQ_SQL, [p.user_id, p.seq]);
    for (const j of source.server.jobRuns) await query(REVERSE_JOB_RUNS_SQL, [j.key, j.done_at]);
    for (const m of source.server.mailLog) await query(REVERSE_MAIL_LOG_SQL, [m.utc_day, m.kind, m.user_id, m.ref, m.resend_id, m.created_at]);
    for (const g of source.server.googleConnections) {
      await query(REVERSE_GOOGLE_CONNECTION_SQL, [g.id, g.user_id, g.sealed_token, g.calendar_id, g.state, g.connected_at, g.last_error, g.last_error_at, g.changed_at]);
    }
    for (const g of source.server.googleEvents) await query(REVERSE_GOOGLE_EVENT_SQL, [g.user_id, g.meeting_id, g.event_id, g.synced_rev, g.synced_at]);
    for (const g of source.server.googleCalendars) await query(REVERSE_GOOGLE_CALENDAR_SQL, [g.user_id, g.calendar_id, g.changed_at]);
    for (const d of source.server.daftraClients) await query(REVERSE_DAFTRA_CLIENT_SQL, [d.account, d.client_id, d.daftra_id, d.daftra_name, d.matched_by, d.matched_at]);
    for (const d of source.server.daftraInvoices) {
      await query(REVERSE_DAFTRA_INVOICE_SQL, [d.account, d.id, d.daftra_client_id, d.no, d.total_halalas, d.issued_on, d.created_at, d.payment_status, d.paid_on, d.draft, d.seen_at]);
    }
    const linked = source.signin.filter((s) => s.user_id !== null);
    const known = new Set((await query(AUTH_IDS_SQL, [linked.map((s) => s.id)])).map((row) => String(row.id)));
    const needInvite: ReverseReport['needInvite'] = [];
    let count = 0;
    for (const s of linked) {
      if (known.has(s.id) && (await setAuthUserId(q, s.user_id!, s.id))) count += 1;
      else needInvite.push({ userId: s.user_id!, email: s.email });
    }
    await query('commit');
    done = true;
    return { records: source.records, linked: count, needInvite };
  } finally {
    if (!done) await query('rollback').catch(() => undefined);
  }
}

/**
 * The keys that the check of the way back compares: every records table, the counters, the person numbers, the signal number, and the
 * Google and Daftra tables that the reverse writes back.
 */
export function reverseKeys(source: OfficeSource): string[] {
  return [...source.tables.map((t) => t.table), 'counters', 'person_seq', 'office_seq', 'google_connections', 'google_events', 'google_calendars', 'daftra_clients', 'daftra_invoices'];
}

/** The keys in which Postgres after the reverse differs from the export, in the order of reverseKeys. Empty means no difference. */
export function reverseProblems(source: OfficeSource, back: OfficeSource): string[] {
  const want = sourceDigests(source);
  const got = sourceDigests(back);
  return reverseKeys(source).filter((key) => want[key]?.sha256 !== got[key]?.sha256 || want[key]?.rows !== got[key]?.rows);
}

/** Where the records come from: an export folder, or the page address of an office object. */
export type ReverseSource = { kind: 'export'; folder: string } | { kind: 'office'; target: ReturnType<typeof targetOf>; address: string };
export type ReversePlan = { to: ReverseTarget; office: string | undefined; typed: boolean; from: ReverseSource };

/**
 * The checks of the command line, in one place and with no outside work. Every refusal is an ArgumentError (exit code 2). A production
 * target needs --yes-replace, --office ent_001 (spelled out, never a default) and the office of production as the source: an export
 * folder, a test copy or a local office never go into the real Postgres by a typing mistake.
 */
export function reverseArguments(argv: readonly string[]): ReversePlan {
  const to = flagOf(argv, '--to');
  if (to !== 'local' && to !== 'test' && to !== 'production') throw new ArgumentError('--to must be local, test or production.');
  if (to === 'test' && !argv.includes('--yes-replace')) throw new ArgumentError('This replaces every record of madar-test. Add --yes-replace after the owner said yes.');
  const office = flagOf(argv, '--office') || undefined;
  const exportFolder = flagOf(argv, '--from-export');
  const address = flagOf(argv, '--from-office');
  if (to === 'production') {
    if (!argv.includes('--yes-replace')) throw new ArgumentError('This replaces every record of production. Add --yes-replace after the owner said yes.');
    if (office !== ENT_VADO) throw new ArgumentError(`--to production needs --office ${ENT_VADO}: it is the only object that the move filled.`);
    if (exportFolder) throw new ArgumentError('--to production takes only --from-office <page address of production>, never an export folder.');
    if (!address) throw new ArgumentError('--from-office <page address of production> is missing.');
    let target: ReturnType<typeof targetOf>;
    try {
      target = targetOf(address, { allowProduction: true });
    } catch (error) {
      throw new ArgumentError(error instanceof Error ? error.message : String(error));
    }
    if (target.copy !== 'production') throw new ArgumentError('--to production takes only the office of production as the source (--from-office https://madar.vado.sa).');
    return { to, office, typed: true, from: { kind: 'office', target, address } };
  }
  if (exportFolder) return { to, office, typed: false, from: { kind: 'export', folder: exportFolder } };
  if (!address) throw new ArgumentError('--from-export <folder> or --from-office <page address> --office <name> is missing.');
  let target: ReturnType<typeof targetOf>;
  try {
    target = targetOf(address);
  } catch (error) {
    throw new ArgumentError(error instanceof Error ? error.message : String(error));
  }
  return { to, office, typed: false, from: { kind: 'office', target, address } };
}

/** The outside work of a run, so that a test can record every call. The defaults are the real ones. */
export type ReverseDeps = {
  ask(prompt: string): Promise<string>;
  env: Readonly<Record<string, string | undefined>>;
  /** The export secret of a copy, or undefined. */
  secretOf(copy: ReturnType<typeof targetOf>['copy']): string | undefined;
  exportTo(o: { target: ReturnType<typeof targetOf>; office: string | undefined; secret: string; folder: string }): Promise<unknown>;
  /** A connected Postgres client of the target. */
  connect(to: ReverseTarget): Promise<{ query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; end(): Promise<void> }>;
  log(line: string): void;
};

export const REVERSE_DEPS: ReverseDeps = {
  ask: askTypedWord,
  env: process.env,
  secretOf: (copy) => copyValuesOf(copy).MADAR_EXPORT_SECRET,
  exportTo: ({ target, office, secret, folder }) => exportOffice(opsOf({ base: target.base, secret, header: EXPORT_SECRET_HEADER, ...(office ? { office } : {}) }), { copy: target.copy, folder }),
  async connect(to) {
    if (to === 'production') return postgresOf('production');
    const client = to === 'local' ? new pg.Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' }) : testClient();
    await client.connect();
    return client;
  },
  log: (line) => console.log(line),
};

export async function runReverse(argv: readonly string[], deps: ReverseDeps = REVERSE_DEPS): Promise<void> {
  const plan = reverseArguments(argv);
  if (plan.typed && (await deps.ask('This replaces every record of the production Postgres (Supabase) with the office object of ent_001. Type production to go on: ')).trim() !== 'production') {
    throw new Error('The typed word was not production. Nothing changed.');
  }
  // The password of the database is checked before the export, so a missing variable never leaves a half run behind.
  if (plan.to === 'production' && !deps.env.MADAR_DB_PASSWORD) throw new Error('MADAR_DB_PASSWORD is not set: load ~/dev/madar/.env.local first.');
  const today = new Date().toISOString().slice(0, 10);
  // The source: an export folder, or an office object that this run exports into a private folder and removes after (the rehearsal).
  let folder = plan.from.kind === 'export' ? plan.from.folder : '';
  let made: string | undefined;
  try {
    if (plan.from.kind === 'office') {
      const secret = deps.secretOf(plan.from.target.copy);
      if (!secret) throw new Error(`MADAR_EXPORT_SECRET is not set for ${plan.from.target.copy}.`);
      made = mkdtempSync(join(tmpdir(), `madar-reverse-${process.pid}-`));
      folder = made;
      await deps.exportTo({ target: plan.from.target, office: plan.office, secret, folder });
    }
    const client = await deps.connect(plan.to);
    try {
      const source = exportSource(folder, { today });
      const report = await reverseExport(async (text, values) => (await client.query(text, values)).rows, source, { lockKey: 7_310_001, today, to: plan.to });
      deps.log(JSON.stringify(report));
      // The check of the way back: Postgres after the reverse against the export, table by table, the Google and Daftra tables too.
      const back = await pgSource(async (text, values) => (await client.query(text, values)).rows);
      const problems = reverseProblems(source, back);
      if (problems.length > 0) throw new Error(`Postgres differs from the office object after the reverse export: ${problems.join(', ')}.`);
      deps.log('Postgres holds the same records, counters, signal number, person numbers and Google and Daftra rows as the office object.');
    } finally {
      await client.end().catch(() => undefined);
    }
  } finally {
    if (made) rmSync(made, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  runReverse(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(error instanceof ArgumentError ? 2 : 1);
  });
}
