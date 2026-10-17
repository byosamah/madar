// The restore check of an office backup (Supabase exit, wave 4; spec section 2, "Backups" (3)). scripts/restore-check.ts calls it
// for a file named madar-office-<copy>-<stamp>.tar.gz.age. It runs on the owner's Mac (only the Mac has the offline key) and needs
// no Docker: decrypt, check the archive, restore every table into node:sqlite with the schema of this build, compare the rows and
// the sha256 of each table with the manifest, check that the History only grows, run dashboard.get as an active Admin through
// runCall on SQLite, and look up 5 file keys in the file copy. The plain folder lives in a private temporary folder, which it removes.
// The report names tables and steps, never a value of a row.
import { randomInt } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { createRunCall } from '../../server/core/runCall';
import { liteData } from '../../server/data/lite/callData';
import { liteDb, type LiteDb } from '../../server/data/lite/db';
import { nodeHost } from '../../server/data/lite/host';
import { applyLiteSchema, LITE_SCHEMA_VERSION } from '../../server/data/lite/schema';
import { ROWID_ALIAS } from '../../server/office/ops';
import { rowDigester } from '../office/digest';
import { checkFileCopy, readOnlyDeps, type CheckOptions, type CheckReport, type Step } from '../restore-check';
import type { ExportManifest } from './officeExport';
import { run } from './run';

const ENTRY = /^(madar-office-(?:test|production|local)-[0-9]{8}-[0-9]{6}Z)\/(manifest\.json|tables\/|tables\/[a-z_]+\.ndjson)?$/;

const Manifest = z.object({
  format: z.literal(2), kind: z.literal('office'), copy: z.enum(['test', 'production', 'local']), madeAt: z.string(), schema: z.number().int(),
  version: z.number().int(), officeSeq: z.number().int(), drift: z.array(z.string()),
  tables: z.record(z.string().regex(/^[a-z_]+$/), z.object({ rows: z.number().int().min(0), sha256: z.string().regex(/^[0-9a-f]{64}$/) })),
});

/** What is wrong with the entries of an office backup archive (tar -t), before anything is unpacked. */
export function officeArchiveProblems(entries: string[]): string[] {
  const problems: string[] = [];
  const folders = new Set<string>();
  let manifest = false;
  for (const entry of entries.filter((line) => line !== '')) {
    const match = ENTRY.exec(entry);
    if (!match) {
      problems.push(`The archive holds an entry that an office backup does not have: ${entry}`);
      continue;
    }
    folders.add(match[1]);
    if (match[2] === 'manifest.json') manifest = true;
  }
  if (folders.size > 1) problems.push('The archive holds more than one backup folder.');
  if (!manifest) problems.push('The archive has no manifest.json.');
  return problems;
}

/** A table or column name of the backup, quoted; any other text throws, so no text of a file reaches the SQL as SQL. */
const quoteName = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Not a table or column name: ${name.slice(0, 40)}`);
  return `"${name}"`;
};

/**
 * Every table of the backup folder into a new node:sqlite office with the schema of this build, in one transaction, then the
 * rows and the sha256 of each table against the manifest. The rowid of each row comes back as it was, so the row digest of the
 * restore is the digest of the export. The schema made a settings row and an office_meta row: the backup has both.
 */
export async function restoreOffice(folder: string): Promise<{ raw: DatabaseSync; db: LiteDb; manifest: ExportManifest; problems: string[] }> {
  const manifest = Manifest.parse(JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'))) as ExportManifest;
  const raw = new DatabaseSync(':memory:');
  const host = nodeHost(raw);
  await applyLiteSchema(host);
  const db = liteDb(host);
  if (manifest.schema > LITE_SCHEMA_VERSION) {
    return { raw, db, manifest, problems: [`The backup is of schema version ${manifest.schema}, and this build knows version ${LITE_SCHEMA_VERSION}. Check it with a newer build.`] };
  }
  const problems: string[] = [];
  // The events guard stays on: it refuses an update and a delete, never an insert.
  await host.transaction(async () => {
    host.exec('delete from settings', []);
    host.exec('delete from office_meta', []);
    for (const table of Object.keys(manifest.tables)) {
      const file = join(folder, 'tables', `${table}.ndjson`);
      if (!existsSync(file)) {
        problems.push(`${table}: the backup has no file for it.`);
        continue;
      }
      const alias = ROWID_ALIAS.get(table);
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (line === '') continue;
        try {
          const row = JSON.parse(line) as Record<string, string | number | null>;
          const columns = Object.keys(row).filter((name) => name !== '_rowid');
          const names = alias ? columns : ['rowid', ...columns];
          const values = alias ? columns.map((name) => row[name]) : [row._rowid, ...columns.map((name) => row[name])];
          host.exec(`insert into ${quoteName(table)} (${names.map(quoteName).join(', ')}) values (${names.map((_, i) => `?${i + 1}`).join(', ')})`, values);
        } catch (error) {
          problems.push(`${table}: a row does not fit this schema (${error instanceof Error ? error.message : String(error)}).`);
          break;
        }
      }
    }
  });
  for (const [table, want] of Object.entries(manifest.tables)) {
    const digest = rowDigester();
    try {
      for (const row of host.exec(`select rowid as _rowid, * from ${quoteName(table)} order by rowid`, []).rows) digest.add(row);
    } catch (error) {
      problems.push(`${table}: the restore cannot read it (${error instanceof Error ? error.message : String(error)}).`);
      continue;
    }
    const got = digest.done();
    if (got.rows !== want.rows) problems.push(`${table}: the manifest says ${want.rows} rows, the restore holds ${got.rows}.`);
    else if (got.sha256 !== want.sha256) problems.push(`${table}: the same ${got.rows} rows, another hash.`);
  }
  return { raw, db, manifest, problems: [...new Set(problems)] };
}

type FileVersion = { blobKey?: unknown; size?: unknown; uploadedAt?: unknown };

/** The office restore check: the steps of scripts/restore-check.ts, on node:sqlite. */
export async function officeRestoreCheck(o: CheckOptions): Promise<CheckReport> {
  const steps: Step[] = [];
  const work = mkdtempSync(join(tmpdir(), `madar-restore-${process.pid}-`));
  /** One step. False when the step failed and stop is set: the later steps need it. */
  const attempt = async (step: string, job: () => Promise<string>, stop = false): Promise<boolean> => {
    try {
      steps.push({ step, ok: true, detail: await job() });
      return true;
    } catch (error) {
      steps.push({ step, ok: false, detail: error instanceof Error ? error.message : String(error) });
      return !stop;
    }
  };
  try {
    const archive = join(work, 'backup.tar.gz');
    const decrypted = await attempt('decrypt', async () => {
      await run('age --decrypt', o.age ?? process.env.MADAR_AGE ?? 'age', ['--decrypt', '-i', o.key, '-o', archive, o.file]);
      return 'The key opened the backup.';
    }, true);
    if (!decrypted) return { ok: false, steps };
    let folder = '';
    const unpacked = await attempt('archive', async () => {
      const entries = (await run('tar -t', 'tar', ['-tzf', archive])).stdout.split('\n').map((line) => line.trim());
      const problems = officeArchiveProblems(entries);
      if (problems.length > 0) throw new Error(problems.join(' '));
      await run('tar -x', 'tar', ['-xzf', archive, '-C', work]);
      folder = join(work, entries.find((entry) => entry !== '')!.split('/')[0]);
      return `One office backup: ${folder.split('/').pop()}.`;
    }, true);
    if (!unpacked) return { ok: false, steps };
    // A count that differs fails the step, and the later steps still run on what the restore holds. A manifest that does not
    // parse stops the check: no later step has an office to read.
    let restored: Awaited<ReturnType<typeof restoreOffice>> | undefined;
    await attempt('counts', async () => {
      restored = await restoreOffice(folder);
      if (restored.problems.length > 0) throw new Error(restored.problems.join(' '));
      const rows = Object.values(restored.manifest.tables).reduce((sum, t) => sum + t.rows, 0);
      return `${Object.keys(restored.manifest.tables).length} tables and ${rows} rows match the manifest, with the same sha256.`;
    });
    if (!restored) return { ok: false, steps };
    const office: Awaited<ReturnType<typeof restoreOffice>> = restored;
    await attempt('events guard', async () => {
      const events = Number((office.raw.prepare('select count(*) as n from events').get() as { n: number }).n);
      if (events === 0) return 'The office has no event, so the guard had no row to refuse.';
      try {
        office.raw.exec('update events set doc = doc where rowid = (select min(rowid) from events)');
      } catch (error) {
        if (error instanceof Error && error.message.includes('events only grow')) return 'An update of an event fails: the History only grows.';
        throw error;
      }
      throw new Error('An update of an event worked in the restored office.');
    });
    await attempt('dashboard.get', async () => {
      const people = office.raw.prepare('select id, doc from users order by rowid').all() as { id: string; doc: string }[];
      if (people.length === 0) return 'Skipped: the restored office has no person yet.';
      const admin = people.find((p) => {
        const doc = JSON.parse(p.doc) as { active?: boolean; kind?: string; systemRole?: string };
        return doc.active === true && doc.kind === 'human' && doc.systemRole === 'admin';
      });
      if (!admin) throw new Error('The restored office has people but no active Admin.');
      const result = await createRunCall({ data: liteData })(readOnlyDeps(office.db), {
        principal: { userId: admin.id }, name: 'dashboard.get', input: {}, batch: { storyRefs: new Map(), overviewCalls: 0 },
      });
      if (!result.ok) throw new Error(`dashboard.get failed: ${result.error.code}.`);
      return 'dashboard.get ran on the restored office for an active Admin.';
    });
    await attempt('files', async () => {
      if (o.filesRemote === null) return 'Skipped on purpose (--skip-files).';
      const files = office.raw.prepare('select doc from files').all() as { doc: string }[];
      const versions = files.flatMap((f) => ((JSON.parse(f.doc) as { versions?: FileVersion[] }).versions ?? [])
        .filter((v) => typeof v.blobKey === 'string')
        .map((v) => ({ key: v.blobKey as string, size: Number(v.size), at: typeof v.uploadedAt === 'string' ? v.uploadedAt : null })));
      return checkFileCopy({
        versions, madeAt: new Date(office.manifest.madeAt), lagDays: o.filesLagDays ?? 8, remote: o.filesRemote, rclone: o.rclone ?? 'rclone',
        sample: o.fileSample ?? 5, random: o.random ?? ((below: number) => randomInt(below)),
      });
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { ok: steps.length > 0 && steps.every((s) => s.ok), steps };
}
