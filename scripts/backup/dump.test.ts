import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCK_KEY } from '../../server/core/deps';
import { clientConfig, makeBackup, OFFICE_LOCK_KEY } from './dump';
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
});
