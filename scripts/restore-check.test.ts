import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSeed } from '../src/data/seed';
import { writeState } from '../server/data/whole';
import type { Query } from '../server/core/ports';
import { applyMigrations, dropSchema, localClient, localDbUrl } from '../server/it/migrate';
import { DEFAULT_RESTORE_IMAGE } from './backup/check';
import { makeBackup, type BackupResult } from './backup/dump';
import { run } from './backup/run';
import { restoreCheck, type CheckReport } from './restore-check';

/**
 * Suite 14 of TM 7 (plan 5.7; task O2) on the local stack [Docker]: the backup of a seeded office (dump.ts, the same code as the
 * nightly workflow, with a test age key), then the restore check into a Postgres container. A good backup passes every step; a
 * changed byte, a lost row, a broken row and a missing file each fail at their step.
 *
 * The office is the sample office in public, as postgres, because the backup dumps the real database. The test keeps every row
 * of public in a schema of its own, starts the seed from the rows of the migrations, and puts every row back after (TM 7.3). The file copy is an rclone crypt remote over a temporary folder, set by environment
 * variables, with one object of the right size for each sample file.
 * Needs age: brew install age (or set MADAR_AGE to the age program; age-keygen must sit next to it).
 */

const AGE = process.env.MADAR_AGE ?? 'age';
const KEYGEN = process.env.MADAR_AGE ? join(dirname(AGE), 'age-keygen') : 'age-keygen';
const COPY = 'o2copy:current';
const TODAY = '2026-10-04';
const SLOW = 240_000;
/** Fixed names: the it project runs one file at a time, and a new run removes what a stopped run left. */
const KEEP = 'madar_o2_keep';
const BASE = 'madar_o2_base';

let work: string;
let key: string;
let image: string;
let backup: BackupResult;
let client: pg.Client;
const blobSizes = new Map<string, number>();

const q: Query = async (text, values) => (await client.query(text, values)).rows;

/** The tables of a schema, and their columns that take a value (not the generated ones). */
async function tablesOf(schema: string): Promise<Map<string, string[]>> {
  const rows = (
    await client.query<{ t: string; c: string }>(
      "select table_name as t, column_name as c from information_schema.columns where table_schema = $1 and is_generated = 'NEVER' order by table_name, ordinal_position",
      [schema],
    )
  ).rows;
  const tables = new Map<string, string[]>();
  for (const row of rows) tables.set(row.t, [...(tables.get(row.t) ?? []), `"${row.c}"`]);
  return tables;
}

/**
 * In one transaction (the project foreign keys wait for the commit): empties every public table, then copies in the rows of the
 * same tables of another schema.
 */
async function refillFrom(schema: string): Promise<void> {
  const tables = await tablesOf('public');
  await client.query('begin');
  try {
    await client.query(`truncate ${[...tables.keys()].map((t) => `public."${t}"`).join(', ')}`);
    for (const [table, columns] of tables) {
      await client.query(`insert into public."${table}" (${columns.join(', ')}) overriding system value select ${columns.join(', ')} from "${schema}"."${table}"`);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

const check = (file: string, more: { filesRemote?: string | null } = {}) =>
  restoreCheck({ file, key, image, filesRemote: more.filesRemote === undefined ? COPY : more.filesRemote, age: AGE });

const failedAt = (report: CheckReport) => report.steps.filter((s) => !s.ok).map((s) => s.step);

/** Opens the backup, changes data.sql, and closes it again with the same key. */
async function rewrite(change: (data: string) => string): Promise<string> {
  const dir = mkdtempSync(join(work, 'rewrite-'));
  await run('age', AGE, ['--decrypt', '-i', key, '-o', join(dir, 'b.tar.gz'), backup.file]);
  await run('tar', 'tar', ['-xzf', join(dir, 'b.tar.gz'), '-C', dir]);
  const data = join(dir, backup.name, 'data.sql');
  const before = readFileSync(data, 'utf8');
  const after = change(before);
  expect(after).not.toBe(before);
  writeFileSync(data, after);
  await run('tar', 'tar', ['-C', dir, '-czf', join(dir, 'c.tar.gz'), backup.name]);
  const out = join(dir, `${backup.name}.tar.gz.age`);
  const recipient = /# public key: (age1\S+)/.exec(readFileSync(key, 'utf8'))![1];
  await run('age', AGE, ['-r', recipient, '-o', out, join(dir, 'c.tar.gz')]);
  return out;
}

/** The lines of one COPY block of the data dump. */
function blockOf(data: string, table: string): { start: number; rows: string[] } {
  const lines = data.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`COPY "public"."${table}" `));
  const end = lines.indexOf('\\.', start);
  return { start, rows: lines.slice(start + 1, end) };
}

beforeAll(async () => {
  await run('age --version', AGE, ['--version']).catch(() => {
    throw new Error('age is missing: brew install age, or set MADAR_AGE to the age program.');
  });
  work = mkdtempSync(join(tmpdir(), 'madar-o2-'));
  key = join(work, 'key.txt');
  await run('age-keygen', KEYGEN, ['-o', key]);
  const recipient = /# public key: (age1\S+)/.exec(readFileSync(key, 'utf8'))![1];

  // The sample office starts from the rows that the migrations make (office_meta, settings), copied from a fresh schema. Every
  // row of public waits in a schema of its own and comes back after the test, so the later integration tests find public as it was.
  client = await localClient();
  await client.query(`drop schema if exists ${KEEP} cascade`);
  await dropSchema(client, BASE);
  await client.query(`create schema ${KEEP}`);
  for (const table of (await tablesOf('public')).keys()) await client.query(`create table ${KEEP}."${table}" as select * from public."${table}"`);
  await applyMigrations(client, BASE);
  await refillFrom(BASE);
  await dropSchema(client, BASE);
  const seed = await buildSeed(TODAY, async (blobKey, blob) => {
    blobSizes.set(blobKey, blob.size);
  });
  await client.query('begin');
  await writeState(q, seed);
  await client.query('commit');

  // The file copy: an rclone crypt remote over a folder, with one object of the right size for each sample file.
  const plain = join(work, 'plain');
  mkdirSync(plain);
  for (const [blobKey, size] of blobSizes) writeFileSync(join(plain, blobKey), randomBytes(size));
  process.env.RCLONE_CONFIG_O2COPY_TYPE = 'crypt';
  process.env.RCLONE_CONFIG_O2COPY_REMOTE = join(work, 'copy');
  process.env.RCLONE_CONFIG_O2COPY_PASSWORD = (await run('rclone obscure', 'rclone', ['obscure', 'o2-test-copy'])).stdout.trim();
  await run('rclone copy', 'rclone', ['copy', plain, COPY]);

  image = (await run('docker inspect', 'docker', ['inspect', '--format', '{{.Config.Image}}', 'supabase_db_madar']).catch(() => ({ stdout: DEFAULT_RESTORE_IMAGE }))).stdout.trim();
  backup = await makeBackup({ dbUrl: localDbUrl(), recipient, outDir: work, now: new Date('2026-10-04T23:07:00Z') });
}, SLOW);

afterAll(async () => {
  if (client) {
    await dropSchema(client, BASE);
    await refillFrom(KEEP);
    await dropSchema(client, KEEP);
    await client.end();
  }
  for (const name of ['TYPE', 'REMOTE', 'PASSWORD']) delete process.env[`RCLONE_CONFIG_O2COPY_${name}`];
  if (work) rmSync(work, { recursive: true, force: true });
});

describe('the backup and the restore check on the local stack', () => {
  it('makes one encrypted file whose manifest counts every Madar table', () => {
    expect(backup.name).toBe('madar-db-20261004-230700Z');
    expect(backup.file.endsWith('madar-db-20261004-230700Z.tar.gz.age')).toBe(true);
    expect(readFileSync(backup.file).subarray(0, 21).toString()).toBe('age-encryption.org/v1');
    expect(backup.tables).toBeGreaterThanOrEqual(30);
    expect(backup.rows).toBeGreaterThan(100);
    expect(blobSizes.size).toBeGreaterThan(5);
  });

  it('passes every step on a good backup, and leaves no container and no plain dump', async () => {
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith('madar-restore-'));
    const report = await check(backup.file);
    expect(failedAt(report)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.steps.map((s) => s.step)).toEqual(['decrypt', 'archive', 'manifest', 'container', 'restore', 'counts', 'events guard', 'dashboard.get', 'files']);
    expect(report.steps.find((s) => s.step === 'counts')!.detail).toBe(`${backup.tables} tables and ${backup.rows} rows match the manifest.`);
    expect(report.steps.find((s) => s.step === 'events guard')!.detail).toContain('the trigger refuses the owner');
    expect(report.steps.find((s) => s.step === 'files')!.detail).toBe(`5 of ${blobSizes.size} file keys are in the copy with their sizes.`);
    expect((await run('docker ps', 'docker', ['ps', '-a', '--filter', 'name=madar-restore-check-', '--format', '{{.Names}}'])).stdout.trim()).toBe('');
    expect(readdirSync(tmpdir()).filter((name) => name.startsWith('madar-restore-'))).toEqual(before);
  }, SLOW);

  it('fails at decrypt when one byte of the file changed', async () => {
    const damaged = join(work, 'damaged.age');
    copyFileSync(backup.file, damaged);
    const bytes = readFileSync(damaged);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    writeFileSync(damaged, bytes);
    const report = await check(damaged);
    expect(report.ok).toBe(false);
    expect(report.steps.map((s) => [s.step, s.ok])).toEqual([['decrypt', false]]);
  }, SLOW);

  it('fails at the counts when the dump lost a row of the History', async () => {
    const events = Number((await client.query<{ n: string }>('select count(*) as n from public.events')).rows[0].n);
    const lost = await rewrite((data) => {
      const lines = data.split('\n');
      lines.splice(blockOf(data, 'events').start + 1, 1);
      return lines.join('\n');
    });
    const report = await check(lost);
    expect(failedAt(report)).toEqual(['counts']);
    expect(report.steps.find((s) => s.step === 'counts')!.detail).toBe(`public.events: the manifest says ${events} rows, the dump and the restore hold ${events - 1}.`);
  }, SLOW);

  it('fails at the restore when a row of the dump is broken, and restores nothing', async () => {
    const broken = await rewrite((data) => {
      const { start } = blockOf(data, 'users');
      const lines = data.split('\n');
      lines[start + 1] = lines[start + 1].replace('\t{', '\t{"id": broken, ');
      return lines.join('\n');
    });
    const report = await check(broken);
    expect(failedAt(report)).toEqual(['restore']);
    expect(report.steps.at(-1)!.step).toBe('restore');
  }, SLOW);

  it('fails at the files when the copy lost the files', async () => {
    await run('rclone purge', 'rclone', ['purge', COPY]);
    const report = await check(backup.file);
    expect(failedAt(report)).toEqual(['files']);
    expect(report.steps.find((s) => s.step === 'files')!.detail).toMatch(/not in the copy/);
    expect((await check(backup.file, { filesRemote: null })).ok).toBe(true);
  }, SLOW);
});
