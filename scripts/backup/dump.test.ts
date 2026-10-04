import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCK_KEY } from '../../server/core/deps';
import { clientConfig, DATA_DUMP_TIMEOUT_MS, dumpOne, IDLE_CAP_MS, makeBackup, OFFICE_LOCK_KEY } from './dump';
import { run } from './run';

/** The parts of the backup that need no database (plan 5.7; task O2). scripts/restore-check.test.ts runs a whole backup [Docker]. */

describe('dump.ts', () => {
  it('holds the office lock key of the server, so an office write waits for the counts and the data dump', () => {
    expect(OFFICE_LOCK_KEY).toBe(DEFAULT_LOCK_KEY);
  });

  it('connects to this machine without TLS, and to the pooler with the Supabase root certificate', () => {
    const local = clientConfig('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    expect(local).toMatchObject({ host: '127.0.0.1', port: 54322, user: 'postgres', database: 'postgres' });
    expect(local.ssl).toBeUndefined();
    const pooler = clientConfig('postgresql://postgres.abc:p%40ss%2Fword@aws-1-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require');
    expect(pooler).toMatchObject({ user: 'postgres.abc', password: 'p@ss/word', port: 5432 });
    expect(pooler.ssl).toMatchObject({ rejectUnauthorized: true, servername: 'aws-1-eu-central-1.pooler.supabase.com' });
    expect(String((pooler.ssl as { ca: string }).ca)).toContain('BEGIN CERTIFICATE');
  });

  it('holds the office lock in the transaction form, so a lost client can never leave it on a pooled backend', () => {
    const source = readFileSync(new URL('./dump.ts', import.meta.url), 'utf8');
    expect(source).toContain('pg_advisory_xact_lock');
    expect(source).not.toContain('pg_advisory_lock(');
    expect(source).not.toContain('pg_advisory_unlock');
    expect(source).toMatch(/set local idle_in_transaction_session_timeout/);
    expect(source).toMatch(/set local lock_timeout/);
    // A healthy data dump ends before the idle cap ends the session, and a lost client frees the lock within minutes.
    expect(IDLE_CAP_MS).toBeGreaterThan(DATA_DUMP_TIMEOUT_MS);
    expect(IDLE_CAP_MS).toBeLessThanOrEqual(10 * 60_000);
  });

  it('runs the pg_dump script of the CLI with verify-full and the Supabase root certificate for a remote database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'madar-dump-'));
    try {
      const file = join(dir, 'data.sql');
      await dumpOne({
        dbUrl: 'postgresql://postgres.abc:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres',
        label: 'the data dump',
        file,
        flags: ['--data-only'],
        // The CLI prints its script; the shell gets it on stdin and shows what pg_dump would see.
        supabase: ['sh', '-c', 'printf "script %s\\n" "$*"', 'supabase'],
        shell: ['sh', '-c', 'cat; printf "%s\\n" "$PGSSLMODE" "$PGSSLROOTCERT"'],
      });
      const [script, mode, root] = readFileSync(file, 'utf8').trim().split('\n');
      expect(script).toBe('script db dump --db-url postgresql://postgres.abc:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres --dry-run --data-only');
      expect(mode).toBe('verify-full');
      expect(readFileSync(root, 'utf8')).toContain('BEGIN CERTIFICATE');
      expect(root.endsWith('scripts/proof/supabase-root-2021-ca.crt')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a recipient that is not an age public key before it runs anything', async () => {
    await expect(makeBackup({ dbUrl: 'postgresql://x:y@127.0.0.1:1/postgres', recipient: 'AGE-SECRET-KEY-1ABC', outDir: '.' })).rejects.toThrow(
      /public key that starts with age1/,
    );
  });
});

describe('run', () => {
  it('names the step and hides the redacted texts, never the arguments', async () => {
    const failed = run('the data dump', 'sh', ['-c', 'echo "cannot reach postgresql://u:hunter2@host/db" >&2; exit 3', 'hunter2-in-args'], {
      redact: ['postgresql://u:hunter2@host/db', 'hunter2'],
    });
    await expect(failed).rejects.toThrow('the data dump failed (exit 3): cannot reach ***');
    await expect(failed).rejects.not.toThrow(/hunter2/);
  });

  it('gives the output of a program that succeeds', async () => {
    expect((await run('echo', 'sh', ['-c', 'cat'], { input: 'hello' })).stdout).toBe('hello');
  });

  it('stops a program that runs past its time limit, with the children it started', async () => {
    const started = Date.now();
    await expect(run('the data dump', 'sh', ['-c', 'sleep 30 | cat'], { timeoutMs: 300 })).rejects.toThrow('the data dump took longer than 0.3 s and was stopped.');
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('shows only the error text that errorText keeps', async () => {
    const failed = run('psql restore', 'sh', ['-c', 'printf "x.sql:1: ERROR:  bad\\nCONTEXT:  COPY users: sara@example.com\\n" >&2; exit 3'], {
      errorText: (stderr) => stderr.split('\n')[0],
    });
    await expect(failed).rejects.toThrow('psql restore failed (exit 3): x.sql:1: ERROR:  bad');
    await expect(failed).rejects.not.toThrow(/sara/);
  });

  it('writes the output to a file that only the owner can read, and keeps none of it in memory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'madar-run-'));
    try {
      const file = join(dir, 'out.sql');
      expect((await run('the dump', 'sh', ['-c', 'cat'], { input: 'COPY rows', stdoutFile: file })).stdout).toBe('');
      expect(readFileSync(file, 'utf8')).toBe('COPY rows');
      expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
