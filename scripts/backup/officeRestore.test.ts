import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeOffice } from '../../server/office/test/nodeOffice';
import { partsOps } from '../office/ops';
import { checkFileCopy } from '../restore-check';
import { exportOffice, makeOfficeBackup } from './officeExport';
import { officeArchiveProblems, officeRestoreCheck, restoreOffice } from './officeRestore';

const folderOf = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

async function exported() {
  const t = await nodeOffice();
  const folder = folderOf('madar-office-restore-test-');
  const manifest = await exportOffice(partsOps(t.parts), { copy: 'local', folder });
  return { t, folder, manifest };
}

/** A stand-in for age: it copies the file after -o's value to the -o file, for encrypt and decrypt, so no test needs a real key. */
function fakeAge(dir: string): string {
  const path = join(dir, 'fake-age');
  writeFileSync(path, '#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done\nshift; out="$1"; shift; cp "$1" "$out"\n');
  chmodSync(path, 0o755);
  return path;
}

/** A stand-in for rclone: lsf answers unless the remote is "broken:", and lsjson --stat gives the size of a key of sizes. */
function fakeRclone(dir: string, sizes: Record<string, number>): string {
  const table = join(dir, 'sizes.json');
  writeFileSync(table, JSON.stringify(sizes));
  const path = join(dir, 'fake-rclone');
  writeFileSync(path, [
    '#!/usr/bin/env node',
    "const [op, ...rest] = process.argv.slice(2);",
    "if (op === 'lsf') { if (rest[rest.length - 1].startsWith('broken:')) { console.error('Failed to create file system: didn\\'t find section'); process.exit(1); } process.exit(0); }",
    `const sizes = JSON.parse(require('node:fs').readFileSync(${JSON.stringify(table)}, 'utf8'));`,
    "const key = rest[rest.length - 1].replace(/^[^/]*\\//, '');",
    "if (!(key in sizes)) { console.error('error: object not found'); process.exit(3); }",
    'console.log(JSON.stringify({ Path: key, Size: sizes[key] }));',
  ].join('\n'));
  chmodSync(path, 0o755);
  return path;
}

describe('the restore of an office backup (scripts/backup/officeRestore.ts)', () => {
  it('restores every table into a new node:sqlite office with the same rows, byte for byte', async () => {
    const { t, folder } = await exported();
    const restored = await restoreOffice(folder);
    expect(restored.problems).toEqual([]);
    expect(restored.raw.prepare('select count(*) as n from events').get()).toEqual(t.raw.prepare('select count(*) as n from events').get());
    expect(restored.raw.prepare("select doc from tasks where id = 'tsk_001'").get()).toEqual(t.raw.prepare("select doc from tasks where id = 'tsk_001'").get());
    expect(restored.raw.prepare('select version, office_seq from office_meta').get()).toEqual(t.raw.prepare('select version, office_seq from office_meta').get());
    expect(restored.raw.prepare('select doc from settings').get()).toEqual(t.raw.prepare('select doc from settings').get());
  });

  it('keeps the events guard: an update of an event fails in the restored office', async () => {
    const { folder } = await exported();
    const { raw } = await restoreOffice(folder);
    expect(() => raw.exec('update events set doc = doc where rowid = (select min(rowid) from events)')).toThrow('events only grow');
  });

  it('fails when a table file lost a row, and names the table', async () => {
    const { folder } = await exported();
    const file = join(folder, 'tables', 'tasks.ndjson');
    writeFileSync(file, readFileSync(file, 'utf8').split('\n').slice(1).join('\n'));
    expect((await restoreOffice(folder)).problems.join(' ')).toMatch(/^tasks: /);
  });

  it('fails when a byte of a doc changed', async () => {
    const { folder } = await exported();
    const file = join(folder, 'tables', 'users.ndjson');
    const [first, ...rest] = readFileSync(file, 'utf8').split('\n');
    const row = JSON.parse(first) as { doc: string };
    writeFileSync(file, [JSON.stringify({ ...row, doc: row.doc.replace('usr_', 'usR_') }), ...rest].join('\n'));
    const users = 1 + rest.filter((line) => line !== '').length;
    expect((await restoreOffice(folder)).problems).toEqual([`users: the same ${users} rows, another hash.`]);
  });

  it('fails when a row does not fit this schema, and names the table', async () => {
    const { folder } = await exported();
    const file = join(folder, 'tables', 'stages.ndjson');
    const [first, ...rest] = readFileSync(file, 'utf8').split('\n');
    writeFileSync(file, [JSON.stringify({ ...(JSON.parse(first) as object), no_such_column: 1 }), ...rest].join('\n'));
    expect((await restoreOffice(folder)).problems.join(' ')).toMatch(/^stages: a row does not fit this schema/);
  });

  it('fails when a backup is of a newer schema than this build', async () => {
    const { folder } = await exported();
    const path = join(folder, 'manifest.json');
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), schema: 99 }));
    expect((await restoreOffice(folder)).problems).toEqual(['The backup is of schema version 99, and this build knows version 6. Check it with a newer build.']);
  });

  it('accepts the entries of one office backup and refuses any other entry', () => {
    const ok = ['madar-office-test-20261004-230700Z/', 'madar-office-test-20261004-230700Z/manifest.json', 'madar-office-test-20261004-230700Z/tables/', 'madar-office-test-20261004-230700Z/tables/events.ndjson'];
    expect(officeArchiveProblems(ok)).toEqual([]);
    expect(officeArchiveProblems([...ok, 'madar-office-test-20261004-230700Z/../evil'])).toHaveLength(1);
    expect(officeArchiveProblems([...ok, 'madar-office-test-20261005-230700Z/manifest.json'])).toEqual(['The archive holds more than one backup folder.']);
    expect(officeArchiveProblems(ok.slice(0, 1))).toEqual(['The archive has no manifest.json.']);
  });
});

describe('the restore check of an office backup file (scripts/backup/officeRestore.ts)', () => {
  it('decrypts, unpacks, restores, counts, checks the guard and runs dashboard.get, with no Docker', async () => {
    const t = await nodeOffice();
    const out = folderOf('madar-office-check-test-');
    const age = fakeAge(out);
    const backup = await makeOfficeBackup({ ops: partsOps(t.parts), copy: 'local', recipient: `age1${'q'.repeat(58)}`, outDir: out, age, now: new Date('2026-10-04T23:07:00Z') });
    const report = await officeRestoreCheck({ file: backup.file, key: join(out, 'no-key'), filesRemote: null, image: '', age });
    expect(report.steps.map((s) => [s.step, s.ok])).toEqual([
      ['decrypt', true], ['archive', true], ['counts', true], ['events guard', true], ['dashboard.get', true], ['files', true],
    ]);
    expect(report.ok).toBe(true);
    expect(report.steps.find((s) => s.step === 'files')?.detail).toBe('Skipped on purpose (--skip-files).');
  });

  it('stops at the archive step when the file holds another archive', async () => {
    const out = folderOf('madar-office-check-test-');
    const age = fakeAge(out);
    const file = join(out, 'madar-office-test-20261004-230700Z.tar.gz.age');
    writeFileSync(file, 'not a tar file');
    const report = await officeRestoreCheck({ file, key: join(out, 'no-key'), filesRemote: null, image: '', age });
    expect(report.ok).toBe(false);
    expect(report.steps.map((s) => s.step)).toEqual(['decrypt', 'archive']);
  });
});

describe('the file step of a restore check (scripts/restore-check.ts, checkFileCopy)', () => {
  const madeAt = new Date('2026-10-04T23:07:00Z');
  const versions = [{ key: 'projects/a.pdf', size: 3, at: '2026-10-01T00:00:00.000Z' }, { key: 'projects/b.pdf', size: 5, at: '2026-10-04T00:00:00.000Z' }];
  const first = (below: number) => below - below;

  it('looks up every key in the live R2 bucket with lag 0 (decision 5: R2 alone)', async () => {
    const rclone = fakeRclone(folderOf('madar-rclone-test-'), { 'projects/a.pdf': 3, 'projects/b.pdf': 5 });
    expect(await checkFileCopy({ versions, madeAt, lagDays: 0, remote: 'madar-r2:madar-files-test', rclone, sample: 5, random: first }))
      .toBe('2 of 2 file keys are in the copy with their sizes.');
  });

  it('skips the versions that the weekly copy cannot hold yet with lag 8', async () => {
    const rclone = fakeRclone(folderOf('madar-rclone-test-'), {});
    expect(await checkFileCopy({ versions, madeAt, lagDays: 8, remote: 'madar-copy:current', rclone, sample: 5, random: first }))
      .toBe('No file version is old enough for the weekly copy yet. 2 newer file versions were skipped: the weekly copy cannot hold them yet.');
  });

  it('names a missing key and another size, and a copy that cannot be read', async () => {
    const rclone = fakeRclone(folderOf('madar-rclone-test-'), { 'projects/a.pdf': 4 });
    await expect(checkFileCopy({ versions, madeAt, lagDays: 0, remote: 'madar-r2:madar-files-test', rclone, sample: 5, random: first }))
      .rejects.toThrow('projects/a.pdf: 4 bytes in the copy, 3 in the office. projects/b.pdf: not in the copy.');
    await expect(checkFileCopy({ versions, madeAt, lagDays: 0, remote: 'broken:x', rclone, sample: 5, random: first }))
      .rejects.toThrow('The file copy cannot be read');
    await expect(checkFileCopy({ versions, madeAt: new Date(Number.NaN), lagDays: 0, remote: 'madar-r2:madar-files-test', rclone, sample: 5, random: first }))
      .rejects.toThrow('The manifest has no valid time');
  });

  it('says so when the office has no file yet', async () => {
    const rclone = fakeRclone(folderOf('madar-rclone-test-'), {});
    expect(await checkFileCopy({ versions: [], madeAt, lagDays: 0, remote: 'madar-r2:madar-files-test', rclone, sample: 5, random: first })).toBe('The restored office has no file yet.');
  });
});
