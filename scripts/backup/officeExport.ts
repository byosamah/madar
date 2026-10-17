// The nightly backup of an office object (Supabase exit, wave 4; spec section 2, "Backups" (2)). .github/workflows/office-backup.yml
// runs it; scripts/backup/officeRestore.ts checks its file.
//
//   OFFICE_EXPORT_SECRET=<value> BACKUP_AGE_RECIPIENT=<age1...> npx tsx scripts/backup/officeExport.ts --url <page address> --copy <test|production> --out <dir>
//
// It asks the export route of the copy for a begin (the office object then holds writes for at most 5 minutes), every page of
// every table, and the end. It writes madar-office-<copy>-<stamp>/tables/<table>.ndjson (one row for each line, in rowid order)
// and manifest.json (the rows and the sha256 of each table), then tar and age to the owner's public key. The plain folder lives
// only in a private temporary folder, which it removes. It prints one JSON line with the file, the name, the tables and the rows.
// The secret goes only into the header of each request: never into an argument, a log line or an error text.
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPORT_SECRET_HEADER } from '../../server/entries/officeWorker';
import { DRIFT_TABLES, type ExportBegin, type ExportEnd, type ExportPage } from '../../server/office/ops';
import { rowDigester, type TableDigest } from '../office/digest';
import { opsOf, type OfficeOps } from '../office/ops';
import { stampOf } from './check';
import { run } from './run';

export type OfficeCopy = 'test' | 'production' | 'local';
export type ExportManifest = {
  format: 2; kind: 'office'; copy: OfficeCopy; madeAt: string; schema: number; version: number; officeSeq: number; drift: string[];
  tables: Record<string, TableDigest>;
};
export const OFFICE_BACKUP_NAME = /^madar-office-(test|production|local)-[0-9]{8}-[0-9]{6}Z$/;
const AGE_RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/;

/** Every row of every table of the office into folder, in one hold of the office. A write between the begin and the end fails it. */
export async function exportOffice(ops: OfficeOps, o: { copy: OfficeCopy; folder: string; now?: Date }): Promise<ExportManifest> {
  const begin = await ops.post<ExportBegin>('export', { step: 'begin' });
  let ended = false;
  try {
    mkdirSync(join(o.folder, 'tables'), { recursive: true, mode: 0o700 });
    const tables: Record<string, TableDigest> = {};
    for (const table of begin.tables) {
      const file = join(o.folder, 'tables', `${table}.ndjson`);
      writeFileSync(file, '', { mode: 0o600 });
      const digest = rowDigester();
      for (let after = 0; ; ) {
        const page = await ops.post<ExportPage>('export', { step: 'page', id: begin.id, table, after });
        if (page.rows.length > 0) appendFileSync(file, `${page.rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
        for (const row of page.rows) digest.add(row);
        if (page.next === null) break;
        after = page.next;
      }
      tables[table] = digest.done();
    }
    const end = await ops.post<ExportEnd>('export', { step: 'end', id: begin.id });
    ended = true;
    if (end.version !== begin.version || end.officeSeq !== begin.officeSeq) {
      throw new Error('A write landed during the export (the office version moved). Run the export again.');
    }
    const manifest: ExportManifest = {
      format: 2, kind: 'office', copy: o.copy, madeAt: (o.now ?? new Date()).toISOString(), schema: begin.schema, version: begin.version,
      officeSeq: begin.officeSeq, drift: [...DRIFT_TABLES], tables,
    };
    writeFileSync(join(o.folder, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    return manifest;
  } finally {
    // Free the office at once when a page failed: the hold would end by itself only after 5 minutes.
    if (!ended) await ops.post('export', { step: 'end', id: begin.id }).catch(() => undefined);
  }
}

/** The export, tar and age: one file madar-office-<copy>-<stamp>.tar.gz.age in outDir, and no plain file left behind. */
export async function makeOfficeBackup(o: { ops: OfficeOps; copy: OfficeCopy; recipient: string; outDir: string; age?: string; now?: Date }) {
  if (!AGE_RECIPIENT.test(o.recipient)) throw new Error('The age recipient must be a public key that starts with age1.');
  const now = o.now ?? new Date();
  const name = `madar-office-${o.copy}-${stampOf(now)}`;
  const work = mkdtempSync(join(tmpdir(), `madar-office-work-${process.pid}-`));
  try {
    const manifest = await exportOffice(o.ops, { copy: o.copy, folder: join(work, name), now });
    const archive = join(work, `${name}.tar.gz`);
    // COPYFILE_DISABLE: the tar of macOS adds no ._ entry for the extended attributes, which the archive check refuses.
    await run('tar', 'tar', ['-C', work, '-czf', archive, name], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    const file = resolve(o.outDir, `${name}.tar.gz.age`);
    await run('age', o.age ?? process.env.MADAR_AGE ?? 'age', ['-r', o.recipient, '-o', file, archive]);
    const rows = Object.values(manifest.tables).reduce((sum, t) => sum + t.rows, 0);
    return { file, name, tables: Object.keys(manifest.tables).length, rows };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The problems of the arguments and the env, by name only: never a value. */
export function exportArgProblems(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): string[] {
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    return at === -1 ? '' : (argv[at + 1] ?? '');
  };
  const copy = value('--copy');
  return [
    ...(value('--url') === '' ? ['--url <page address of the copy> is missing.'] : []),
    ...(copy !== 'test' && copy !== 'production' ? ['--copy must be test or production.'] : []),
    ...(value('--out') === '' ? ['--out <folder> is missing.'] : []),
    ...(!env.OFFICE_EXPORT_SECRET ? ['OFFICE_EXPORT_SECRET is missing.'] : []),
    ...(!env.BACKUP_AGE_RECIPIENT ? ['BACKUP_AGE_RECIPIENT is missing.'] : []),
  ];
}

async function main(argv: string[]): Promise<void> {
  const problems = exportArgProblems(argv, process.env);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  const value = (flag: string) => argv[argv.indexOf(flag) + 1];
  const ops = opsOf({ base: value('--url'), secret: process.env.OFFICE_EXPORT_SECRET!, header: EXPORT_SECRET_HEADER });
  const result = await makeOfficeBackup({ ops, copy: value('--copy') as OfficeCopy, recipient: process.env.BACKUP_AGE_RECIPIENT!.trim(), outDir: value('--out') });
  console.log(JSON.stringify(result));
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
