import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LITE_SCHEMA_VERSION } from '../../server/data/lite/schema';
import { nodeOffice } from '../../server/office/test/nodeOffice';
import { rowDigest } from '../office/digest';
import { opsOf, partsOps } from '../office/ops';
import { exportArgProblems, exportOffice, makeOfficeBackup, OFFICE_BACKUP_NAME, type ExportManifest } from './officeExport';

const folder = () => mkdtempSync(join(tmpdir(), 'madar-office-export-test-'));

describe('the export client (scripts/backup/officeExport.ts)', () => {
  it('writes one NDJSON file for each table and a manifest whose digests match the lines', async () => {
    const t = await nodeOffice();
    const dir = folder();
    const manifest = await exportOffice(partsOps(t.parts), { copy: 'local', folder: dir, now: new Date('2026-10-04T23:07:00Z') });
    expect(manifest).toMatchObject({ format: 2, kind: 'office', copy: 'local', schema: LITE_SCHEMA_VERSION, madeAt: '2026-10-04T23:07:00.000Z' });
    const events = readFileSync(join(dir, 'tables', 'events.ndjson'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(manifest.tables.events).toEqual(rowDigest(events));
    expect(events.length).toBe(Number((t.raw.prepare('select count(*) as n from events').get() as { n: number }).n));
    expect(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as ExportManifest).toEqual(manifest);
    expect(manifest.drift).toContain('auth_sessions');
    // A table with no row gets an empty file and a digest of 0 rows.
    expect(readFileSync(join(dir, 'tables', 'mail_log.ndjson'), 'utf8')).toBe('');
    expect(manifest.tables.mail_log.rows).toBe(0);
    expect(statSync(join(dir, 'manifest.json')).mode & 0o777).toBe(0o600);
    expect(t.parts.hold.active(t.clock.now())).toBeUndefined();
  });

  it('fails when a write lands between the begin and the end, and ends the hold', async () => {
    const t = await nodeOffice();
    const ops = partsOps(t.parts);
    let pages = 0;
    const sneaky = {
      post: async <T,>(op: string, body: unknown): Promise<T> => {
        if ((body as { step: string }).step === 'page' && ++pages === 3) t.raw.exec('update office_meta set office_seq = office_seq + 1');
        return ops.post<T>(op, body);
      },
    };
    await expect(exportOffice(sneaky, { copy: 'local', folder: folder() })).rejects.toThrow('A write landed during the export');
    expect(t.parts.hold.active(t.clock.now())).toBeUndefined();
  });

  it('ends the hold when a page fails, so the office does not wait 5 minutes', async () => {
    const t = await nodeOffice();
    const ops = partsOps(t.parts);
    const broken = {
      post: async <T,>(op: string, body: unknown): Promise<T> => {
        if ((body as { step: string }).step === 'page') throw new Error('the network dropped');
        return ops.post<T>(op, body);
      },
    };
    await expect(exportOffice(broken, { copy: 'local', folder: folder() })).rejects.toThrow('the network dropped');
    expect(t.parts.hold.active(t.clock.now())).toBeUndefined();
  });

  it('makes one encrypted file named madar-office-<copy>-<stamp> and leaves no plain folder behind', async () => {
    const t = await nodeOffice();
    const out = folder();
    // A stand-in for age: it copies the archive to the -o file, so the test needs no real key.
    const age = join(out, 'fake-age');
    writeFileSync(age, '#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done\nshift; out="$1"; shift; cp "$1" "$out"\n');
    chmodSync(age, 0o755);
    const result = await makeOfficeBackup({ ops: partsOps(t.parts), copy: 'local', recipient: `age1${'q'.repeat(58)}`, outDir: out, age, now: new Date('2026-10-04T23:07:00Z') });
    expect(result.name).toBe('madar-office-local-20261004-230700Z');
    expect(result.name).toMatch(OFFICE_BACKUP_NAME);
    expect(result.file).toBe(join(out, 'madar-office-local-20261004-230700Z.tar.gz.age'));
    expect(existsSync(result.file)).toBe(true);
    expect(result.tables).toBeGreaterThan(30);
    expect(readdirSync(tmpdir()).filter((name) => name.startsWith('madar-office-work-') && name.includes(String(process.pid)))).toEqual([]);
  });

  it('refuses a recipient that is not an age public key, before any export', async () => {
    const t = await nodeOffice();
    await expect(makeOfficeBackup({ ops: partsOps(t.parts), copy: 'local', recipient: 'not-a-key', outDir: folder() })).rejects.toThrow('starts with age1');
    expect(t.parts.hold.active(t.clock.now())).toBeUndefined();
  });
});

describe('the arguments of the export script (scripts/backup/officeExport.ts)', () => {
  it('names each missing argument and value by name, and takes only the copies test and production', () => {
    expect(exportArgProblems([], {})).toEqual([
      '--url <page address of the copy> is missing.', '--copy must be test or production.', '--out <folder> is missing.',
      'OFFICE_EXPORT_SECRET is missing.', 'BACKUP_AGE_RECIPIENT is missing.',
    ]);
    const env = { OFFICE_EXPORT_SECRET: 'secret-of-the-test', BACKUP_AGE_RECIPIENT: `age1${'q'.repeat(58)}` };
    expect(exportArgProblems(['--url', 'https://preview.madar-46r.pages.dev', '--copy', 'test', '--out', '/tmp/x'], env)).toEqual([]);
    expect(exportArgProblems(['--url', 'https://w.test', '--copy', 'local', '--out', '/tmp/x'], env)).toEqual(['--copy must be test or production.']);
    expect(exportArgProblems([], env).join(' ')).not.toContain('secret-of-the-test');
  });
});

describe('the ops port of the scripts (scripts/office/ops.ts)', () => {
  it('posts to /api/office/<op> with the office name and the secret in the header only', async () => {
    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response('{"ok":true}');
    }) as unknown as typeof fetch;
    const ops = opsOf({ base: 'https://preview.madar-46r.pages.dev', secret: 'secret-of-the-test', header: 'x-madar-ops-secret', office: 'rehearsal-20261020', fetch: fake });
    expect(await ops.post('import', { step: 'begin' })).toEqual({ ok: true });
    expect(seen).toEqual([{
      url: 'https://preview.madar-46r.pages.dev/api/office/import?office=rehearsal-20261020',
      headers: { 'content-type': 'application/json', 'x-madar-ops-secret': 'secret-of-the-test' },
      body: '{"step":"begin"}',
    }]);
  });

  it('names the op and the status of a refusal, and never the secret', async () => {
    const fake = (async () => new Response('{"v":1,"error":{"code":"unauthenticated"}}', { status: 401 })) as unknown as typeof fetch;
    const ops = opsOf({ base: 'https://w.test', secret: 'secret-of-the-test', header: 'x-madar-export-secret', fetch: fake });
    const error = await ops.post('export', {}).catch((e: Error) => e);
    expect(String(error)).toContain('The office op export answered 401');
    expect(String(error)).not.toContain('secret-of-the-test');
  });
});
