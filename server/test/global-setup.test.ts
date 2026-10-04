import { describe, expect, it, vi } from 'vitest';
import { harnessDbUrl, prepareSchemas, workerLockKey, workerSchema } from './global-setup';

const SUPABASE = 'postgresql://postgres.qdgwpnesxppnqsaabqzd:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';

describe('the db-mode global setup', () => {
  it('stops before any SQL when DATABASE_URL names a Supabase host', async () => {
    const connect = vi.fn();
    await expect(prepareSchemas({ env: { DATABASE_URL: SUPABASE }, workers: 2, connect })).rejects.toThrow(/only on the local stack/);
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuses any host except 127.0.0.1 and localhost, and a URL that does not parse', () => {
    expect(() => harnessDbUrl({ DATABASE_URL: 'postgresql://postgres:postgres@db.example.com:5432/postgres' })).toThrow(/db\.example\.com/);
    expect(() => harnessDbUrl({ MADAR_LOCAL_DB_URL: 'postgresql://postgres:postgres@10.0.0.5:54322/postgres' })).toThrow(/local stack/);
    expect(() => harnessDbUrl({ DATABASE_URL: 'not a url' })).toThrow(/does not parse/);
    expect(harnessDbUrl({})).toBe('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    expect(harnessDbUrl({ DATABASE_URL: 'postgresql://postgres:postgres@localhost:54322/postgres' })).toContain('@localhost:');
  });

  it('gives each worker its own schema and its own office lock key', () => {
    expect(workerSchema('1')).toBe('madar_w1');
    expect(workerSchema(undefined)).toBe('madar_w1');
    expect(workerSchema('7')).toBe('madar_w7');
    expect(() => workerSchema('1; drop schema public')).toThrow();
    expect(workerLockKey('madar_w1')).not.toBe(workerLockKey('madar_w2'));
  });
});
