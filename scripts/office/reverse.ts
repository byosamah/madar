// The reverse export (Supabase exit, wave 4; spec section 4, "The way back"): an export folder of an office object back into the
// Postgres of a copy.
//
//   npx tsx scripts/office/reverse.ts --from-export <folder> --to local
//   npx tsx scripts/office/reverse.ts --from-office <page address> --office rehearsal-YYYYMMDD --to local      (the rehearsal of wave 5)
//   npx tsx scripts/office/reverse.ts --from-office <page address> --to test --yes-replace      (the way back of the test copy; owner OK)
//
// In one transaction under the office lock: it records every office row as deleted (a warm office cache drops it), empties the
// Madar tables (the TRUNCATE of the test seed), writes the records with writeState, sets the office signal number and the person
// numbers, takes the job runs and the mail log of the day back (no second morning summary), and links each person to the Supabase
// sign-in of the same id. A person with no Supabase sign-in is in the report: the Admin sends that person an invitation again.
// Then it reads Postgres back and compares each table with the export; a difference exits 1. With --from-office it exports the
// object into a private folder first and removes that folder at the end. Production is refused before wave 6.
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
import { TABLES, collectionOf } from '../../server/data/tables';
import { writeState } from '../../server/data/whole';
import { exportOffice } from '../backup/officeExport';
import { POOLER_HOST, REFS } from '../deploy/secrets';
import { RECORD_DELETES_SQL, SEED_LOCK_TIMEOUT_SQL, TRUNCATE_SQL } from '../seed-test-office';
import { sourceDigests } from './compare';
import { copyValuesOf, flagOf, targetOf } from './import';
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

/** madar-test as postgres, through the session pooler, with the Supabase root certificate. */
function testClient(): pg.Client {
  const password = process.env.MADAR_TEST_DB_PASSWORD;
  if (!password) throw new Error('MADAR_TEST_DB_PASSWORD is not set: load ~/dev/madar/.env.local first.');
  const ca = readFileSync(new URL('../../config/supabase-root-2021-ca.crt', import.meta.url), 'utf8');
  return new pg.Client({ host: POOLER_HOST, port: 5432, user: `postgres.${REFS.test}`, password, database: 'postgres', ssl: { ca, rejectUnauthorized: true, servername: POOLER_HOST } });
}

export async function reverseExport(query: PgQuery, source: OfficeSource, o: { lockKey: number; today: string }): Promise<ReverseReport> {
  const q: Query = (async (text: string, values: unknown[] = []) => query(text, values)) as Query;
  await query('begin');
  let done = false;
  try {
    await query(SEED_LOCK_TIMEOUT_SQL);
    await takeOfficeLock(q, o.lockKey);
    await query(RECORD_DELETES_SQL);
    await query(TRUNCATE_SQL);
    await writeState(q, stateOfSource(source, o.today));
    await query(REVERSE_OFFICE_SEQ_SQL, [source.server.officeSeq]);
    for (const p of source.server.personSeq) await query(REVERSE_PERSON_SEQ_SQL, [p.user_id, p.seq]);
    for (const j of source.server.jobRuns) await query(REVERSE_JOB_RUNS_SQL, [j.key, j.done_at]);
    for (const m of source.server.mailLog) await query(REVERSE_MAIL_LOG_SQL, [m.utc_day, m.kind, m.user_id, m.ref, m.resend_id, m.created_at]);
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

/** The keys that the check of the way back compares: every records table, the counters, the person numbers and the signal number. */
export function reverseKeys(source: OfficeSource): string[] {
  return [...source.tables.map((t) => t.table), 'counters', 'person_seq', 'office_seq'];
}

async function main(argv: string[]): Promise<void> {
  const to = flagOf(argv, '--to');
  if (to === 'production') throw new Error('A reverse export into production comes only with the switch and its way back (wave 6).');
  if (to !== 'local' && to !== 'test') throw new Error('--to must be local or test.');
  if (to === 'test' && !argv.includes('--yes-replace')) throw new Error('This replaces every record of madar-test. Add --yes-replace after the owner said yes.');
  const today = new Date().toISOString().slice(0, 10);
  // The source: an export folder, or an office object that this run exports into a private folder and removes after (the rehearsal).
  let folder = flagOf(argv, '--from-export');
  let made: string | undefined;
  try {
    if (!folder) {
      const from = flagOf(argv, '--from-office');
      if (!from) throw new Error('--from-export <folder> or --from-office <page address> --office <name> is missing.');
      const target = targetOf(from);
      const office = flagOf(argv, '--office') || undefined;
      const secret = copyValuesOf(target.copy).MADAR_EXPORT_SECRET;
      if (!secret) throw new Error(`MADAR_EXPORT_SECRET is not set for ${target.copy}.`);
      made = mkdtempSync(join(tmpdir(), `madar-reverse-${process.pid}-`));
      folder = made;
      await exportOffice(opsOf({ base: target.base, secret, header: EXPORT_SECRET_HEADER, ...(office ? { office } : {}) }), { copy: target.copy, folder });
    }
    const client = to === 'local' ? new pg.Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' }) : testClient();
    await client.connect();
    try {
      const source = exportSource(folder, { today });
      const report = await reverseExport(async (text, values) => (await client.query(text, values)).rows, source, { lockKey: 7_310_001, today });
      console.log(JSON.stringify(report));
      // The check of the way back: Postgres after the reverse against the export, record by record.
      const back = await pgSource(async (text, values) => (await client.query(text, values)).rows);
      const want = sourceDigests(source);
      const got = sourceDigests(back);
      const problems = reverseKeys(source).filter((key) => want[key]?.sha256 !== got[key]?.sha256 || want[key]?.rows !== got[key]?.rows);
      if (problems.length > 0) throw new Error(`Postgres differs from the office object after the reverse export: ${problems.join(', ')}.`);
      console.log('Postgres holds the same records, counters, signal number and person numbers as the office object.');
    } finally {
      await client.end().catch(() => undefined);
    }
  } finally {
    if (made) rmSync(made, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
