// The import of an office into an office object (Supabase exit, wave 4; spec section 4, steps 3 to 6).
//
//   npx tsx scripts/office/import.ts --from <test|production|local|export:<folder>> --to <page address> [--office rehearsal-YYYYMMDD]
//       [--mode empty|resume|replace] [--used-today <rows written of the account today>] [--limit 90000] [--dry-run]
//
// It reads the source (Postgres inside one read-only snapshot, or an export folder), plans the parts, checks the Free day budget,
// sends the parts, then exports the object and compares the count and the hash of each table with the source. A difference exits 1.
// --from production reads production (only with the typed word production, and only into a rehearsal name). --to never takes
// production before wave 6. The secrets come from secrets/test.env (the test copy) or from the environment (the local office); the
// script never prints them.
import { readFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { copyOfPageHost, type Copy } from '../../server/core/serverHost';
import { OPS_SECRET_HEADER } from '../../server/entries/officeWorker';
import { IMPORT_PART_ROWS, type ImportBegin, type ImportFinish, type ImportMode, type ImportPartAnswer } from '../../server/office/import';
import { REHEARSAL_NAME } from '../../server/office/ops';
import { parseSecretsFile, POOLER_HOST, REFS } from '../deploy/secrets';
import { opsOf, type OfficeOps } from './ops';
import { exportSource, pgSource, type ImportTable, type OfficeSource } from './source';

/** The ceiling of the rows pins of wave 1 (server/office/test/pins.ts, IMPORT_ROWS_PER_RECORD): 6.90 measured, 7.5 planned. */
export const IMPORT_ROWS_PER_RECORD = 7.5;
/** The schema of a new office, the finish, the snapshot and the sign-in rows: a margin above the rows of the records. */
export const IMPORT_FIXED_ROWS = 2_000;
export const FREE_ROWS_WRITTEN_A_DAY = 100_000;
/** One import may take 90% of the Free day: the copy keeps the rest for its own calls of the day. */
export const IMPORT_DAY_LIMIT = 90_000;
export const IMPORT_PART_CHARS = 2_000_000;

export function rowsToWrite(records: number): number {
  return Math.ceil(records * IMPORT_ROWS_PER_RECORD) + IMPORT_FIXED_ROWS;
}

const n = (value: number) => value.toLocaleString('en-US');

/** Why the import cannot run today, or undefined. The day ends at 00:00 UTC (03:00 Riyadh) for the whole account. */
export function budgetProblem(o: { records: number; usedToday: number; limit: number }): string | undefined {
  const planned = rowsToWrite(o.records);
  const room = Math.max(0, o.limit - o.usedToday);
  if (planned <= room) return undefined;
  const days = Math.ceil(planned / FREE_ROWS_WRITTEN_A_DAY);
  return `This office needs about ${n(planned)} rows written (${n(o.records)} records x ${IMPORT_ROWS_PER_RECORD}, plus ${n(IMPORT_FIXED_ROWS)}), `
    + `and the day has ${n(room)} left of the limit ${n(o.limit)}. One import must fit one UTC day: at the whole Free day of `
    + `${n(FREE_ROWS_WRITTEN_A_DAY)} rows it needs ${days} days. Wait for 03:00 Riyadh, or import a smaller office.`;
}

/** The parts of each table, in table order: at most IMPORT_PART_ROWS rows and about IMPORT_PART_CHARS of JSON text each. */
export function planParts(source: Pick<OfficeSource, 'tables'>): ImportTable[] {
  const parts: ImportTable[] = [];
  for (const table of source.tables) {
    let rows: ImportTable['rows'] = [];
    let chars = 0;
    for (const row of table.rows) {
      const size = JSON.stringify(row).length;
      if (rows.length > 0 && (rows.length === IMPORT_PART_ROWS || chars + size > IMPORT_PART_CHARS)) {
        parts.push({ table: table.table, rows });
        rows = [];
        chars = 0;
      }
      rows.push(row);
      chars += size;
    }
    if (rows.length > 0) parts.push({ table: table.table, rows });
  }
  return parts;
}

export type ImportReport = { records: number; parts: number; skipped: number; planned: number; version: number };

/**
 * The begin, the parts and the finish of one import. A part whose answer got lost or failed for a short time goes again (the
 * object skips a part that committed before); a refusal of the object (a 4xx answer) stops the import. Unless the finish answered,
 * the abort frees the office at once.
 */
export async function importOffice(
  ops: OfficeOps, source: OfficeSource,
  o: { mode: ImportMode; limit?: number; usedToday?: number; log?: (line: string) => void; tries?: number; wait?: (ms: number) => Promise<void> },
): Promise<ImportReport> {
  const log = o.log ?? (() => undefined);
  const wait = o.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const tries = o.tries ?? 3;
  const begin = await ops.post<ImportBegin>('import', { step: 'begin', mode: o.mode });
  let finished = false;
  try {
    const problem = budgetProblem({ records: source.records, usedToday: Math.max(o.usedToday ?? 0, begin.day.rows_written), limit: o.limit ?? IMPORT_DAY_LIMIT });
    if (problem) throw new Error(problem);
    const parts = planParts(source);
    let skipped = 0;
    for (const [i, part] of parts.entries()) {
      for (let attempt = 1; ; attempt += 1) {
        try {
          const answer = await ops.post<ImportPartAnswer>('import', { step: 'part', id: begin.id, table: part.table, rows: part.rows });
          if (answer.skipped) skipped += 1;
          break;
        } catch (error) {
          // A lost answer or a short fault: the part goes again, and the object skips it when it committed already.
          if (attempt >= tries || /answered 4\d\d/.test(String(error))) throw error;
          await wait(2_000 * attempt);
        }
      }
      if ((i + 1) % 20 === 0) log(`${i + 1} of ${parts.length} parts.`);
    }
    const finish = await ops.post<ImportFinish>('import', { step: 'finish', id: begin.id, server: source.server, signin: source.signin });
    finished = true;
    return { records: source.records, parts: parts.length, skipped, planned: rowsToWrite(source.records), version: finish.version };
  } finally {
    if (!finished) await ops.post('import', { step: 'abort', id: begin.id }).catch(() => undefined);
  }
}

/** The copy of a target address. The production page host is refused until the switch of wave 6. */
export function targetOf(to: string): { copy: Copy | 'local'; base: string } {
  const url = new URL(to);
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return { copy: 'local', base: url.origin };
  const copy = copyOfPageHost(url.hostname);
  if (!copy) throw new Error(`${url.host} is not a Madar copy.`);
  if (copy === 'production') throw new Error('An import into production comes only with the switch (wave 6 of the exit plan).');
  return { copy, base: url.origin };
}

/** The value after a flag, or the fallback when the flag is not there. */
export function flagOf(argv: readonly string[], flag: string, fallback = ''): string {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : (argv[at + 1] ?? fallback);
}

/** The values of a copy: secrets/<copy>.env, or the environment for the local office. The values never go into a text. */
export function copyValuesOf(copy: Copy | 'local'): Readonly<Record<string, string | undefined>> {
  return copy === 'local' ? process.env : parseSecretsFile(readFileSync(new URL(`../../secrets/${copy}.env`, import.meta.url), 'utf8'));
}

/** The two ops secrets of a copy (scripts/office/new-secret.ts makes them). */
export function officeSecretsOf(copy: Copy | 'local'): { ops: string; exportSecret: string } {
  const values = copyValuesOf(copy);
  const ops = values.MADAR_OPS_SECRET;
  const exportSecret = values.MADAR_EXPORT_SECRET;
  if (!ops || !exportSecret) throw new Error(`MADAR_OPS_SECRET and MADAR_EXPORT_SECRET must be set for ${copy} (scripts/office/new-secret.ts).`);
  return { ops, exportSecret };
}

async function typedWord(): Promise<string> {
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await reader.question('This reads production. Type production to go on: ')).trim();
  } finally {
    reader.close();
  }
}

/** Postgres of a copy as postgres, through the session pooler, with the Supabase root certificate (the rights of the backup). */
async function postgresOf(from: 'test' | 'production' | 'local'): Promise<pg.Client> {
  if (from === 'local') {
    const client = new pg.Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
    await client.connect();
    return client;
  }
  const name = from === 'test' ? 'MADAR_TEST_DB_PASSWORD' : 'MADAR_DB_PASSWORD';
  const password = process.env[name];
  if (!password) throw new Error(`${name} is not set: load ~/dev/madar/.env.local first.`);
  const ca = readFileSync(new URL('../../config/supabase-root-2021-ca.crt', import.meta.url), 'utf8');
  const client = new pg.Client({ host: POOLER_HOST, port: 5432, user: `postgres.${REFS[from]}`, password, database: 'postgres', ssl: { ca, rejectUnauthorized: true, servername: POOLER_HOST } });
  await client.connect();
  return client;
}

export async function sourceFrom(from: string, today: string): Promise<OfficeSource> {
  if (from.startsWith('export:')) return exportSource(from.slice('export:'.length), { today });
  if (from !== 'test' && from !== 'production' && from !== 'local') throw new Error('--from must be test, production, local or export:<folder>.');
  const client = await postgresOf(from);
  try {
    return await pgSource(async (text, values) => (await client.query(text, values)).rows);
  } finally {
    await client.end().catch(() => undefined);
  }
}

const MODES: readonly string[] = ['empty', 'resume', 'replace'];

async function main(argv: string[]): Promise<void> {
  const from = flagOf(argv, '--from');
  const target = targetOf(flagOf(argv, '--to'));
  const office = flagOf(argv, '--office') || undefined;
  const mode = flagOf(argv, '--mode', 'empty');
  if (!MODES.includes(mode)) throw new Error('--mode must be empty, resume or replace.');
  if (office !== undefined && !REHEARSAL_NAME.test(office)) throw new Error('--office must be a rehearsal name (rehearsal-YYYYMMDD), or left out for the office of the copy.');
  if (from === 'production' && office === undefined) throw new Error('A copy of production goes only into a rehearsal name (--office rehearsal-YYYYMMDD).');
  if (from === 'production' && (await typedWord()) !== 'production') throw new Error('The typed word was not production. Nothing changed.');
  const today = new Date().toISOString().slice(0, 10);
  const source = await sourceFrom(from, today);
  const limit = Number(flagOf(argv, '--limit', String(IMPORT_DAY_LIMIT)));
  const usedToday = Number(flagOf(argv, '--used-today', '0'));
  console.log(`Source: ${n(source.records)} records, ${source.signin.length} sign-in rows. Planned: about ${n(rowsToWrite(source.records))} rows written in parts of at most ${n(IMPORT_PART_ROWS)} rows.`);
  const problem = budgetProblem({ records: source.records, usedToday, limit });
  if (problem) throw new Error(problem);
  if (argv.includes('--dry-run')) return;
  const secrets = officeSecretsOf(target.copy);
  const ops = opsOf({ base: target.base, secret: secrets.ops, header: OPS_SECRET_HEADER, ...(office ? { office } : {}) });
  const report = await importOffice(ops, source, { mode: mode as ImportMode, limit, usedToday, log: (line) => console.log(line) });
  console.log(JSON.stringify(report));
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
