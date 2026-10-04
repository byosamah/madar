import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { harnessDbUrl, prepareSchemas, readWorkerStats, speedGate, workerBaseline, workerLockKey, workerSchema } from './global-setup';

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

  it('refuses a host or hostaddr parameter, which pg takes over the host of the URL', async () => {
    const hidden = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres?host=db.qdgwpnesxppnqsaabqzd.supabase.co';
    expect(() => harnessDbUrl({ DATABASE_URL: hidden })).toThrow(/has a host parameter/);
    expect(() => harnessDbUrl({ DATABASE_URL: 'postgresql://postgres:postgres@localhost:54322/postgres?hostaddr=10.0.0.5' })).toThrow(/has a hostaddr parameter/);
    expect(() => harnessDbUrl({ DATABASE_URL: 'postgresql://postgres:postgres@localhost:54322/postgres?HOST=x' })).toThrow(/has a HOST parameter/);
    const connect = vi.fn();
    await expect(prepareSchemas({ env: { DATABASE_URL: hidden }, workers: 1, connect })).rejects.toThrow(/has a host parameter/);
    expect(connect).not.toHaveBeenCalled();
    expect(harnessDbUrl({ DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable' })).toContain('sslmode');
  });

  it('gives each worker its own schema and its own office lock key', () => {
    expect(workerSchema('1')).toBe('madar_w1');
    expect(workerSchema(undefined)).toBe('madar_w1');
    expect(workerSchema('7')).toBe('madar_w7');
    expect(() => workerSchema('1; drop schema public')).toThrow();
    expect(workerLockKey('madar_w1')).not.toBe(workerLockKey('madar_w2'));
  });
});

/** A client that records every statement and answers the few queries the setup reads. */
function fakeClient(o: { note?: string | null } = {}) {
  const sql: string[] = [];
  const client = {
    sql,
    async query(text: string) {
      sql.push(text);
      if (text.includes('pg_tables')) return { rows: [{ tablename: 'office_meta' }, { tablename: 'settings' }] };
      if (text.includes('md5(')) return { rows: [{ sum: sql.length.toString(16).padStart(32, '0') }] };
      if (text.includes("pg_has_role")) return { rows: [{ can: true }] };
      if (text.includes('obj_description')) return { rows: o.note === undefined ? [] : [{ note: o.note }] };
      return { rows: [] };
    },
    async end() {},
  };
  return client;
}

describe('the schemas of the db-mode workers', () => {
  it('drops the worker schemas a killed run left, then reads the baseline of each fresh schema in that schema', async () => {
    const client = fakeClient();
    const prepared = await prepareSchemas({ env: {}, workers: 1, connect: async () => client as never });
    expect(client.sql[0]).toMatch(/nspname ~ '\^madar_w\[0-9\]\+\$'/);
    const sums = client.sql.filter((text) => text.includes('md5('));
    expect(sums).toHaveLength(1);
    expect(sums[0]).toContain('from madar_w1.office_meta t');
    expect(sums[0]).toContain('from madar_w1.settings t');
    expect(prepared.baselines).toEqual({ madar_w1: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(prepared.run).toMatch(/^[0-9a-f]{32}$/);
  });

  it('takes the baseline of the global setup for a schema it made', async () => {
    const client = fakeClient();
    expect(await workerBaseline(client as never, 'madar_w1', { url: '', baselines: { madar_w1: 'sum_given' }, run: 'abc' })).toBe('sum_given');
    expect(client.sql).toEqual([]);
  });

  it('reuses a schema an earlier file of this run made, with the baseline it noted', async () => {
    const client = fakeClient({ note: 'madar run abc baseline 0123abcd' });
    expect(await workerBaseline(client as never, 'madar_w3', { url: '', baselines: {}, run: 'abc' })).toBe('0123abcd');
    expect(client.sql.some((text) => /drop schema/.test(text))).toBe(false);
  });

  it('makes again a schema of another run, or with no note, and notes its baseline for the next file', async () => {
    for (const note of ['madar run old baseline 0123abcd', null]) {
      const client = fakeClient({ note });
      const sum = await workerBaseline(client as never, 'madar_w3', { url: '', baselines: {}, run: 'abc' });
      expect(client.sql).toContain('drop schema if exists madar_w3 cascade');
      expect(client.sql.find((text) => text.includes('md5('))).toContain('from madar_w3.office_meta t');
      expect(client.sql.at(-1)).toBe(`comment on schema madar_w3 is 'madar run abc baseline ${sum}'`);
    }
  });
});

describe('the speed gate of the db job (TM 4.1, plan 7.2: 120 s, 25 ms a call)', () => {
  it('adds up the calls of every file into one line with the average and the run time', () => {
    const verdict = speedGate([{ n: 100, ms: 1_000 }, { n: 300, ms: 3_000, standIns: 2 }], 60_000, { ci: true });
    expect(verdict.failure).toBeUndefined();
    expect(verdict.line).toMatch(/400 calls/);
    expect(verdict.line).toMatch(/10\.0 ms a call/);
    expect(verdict.line).toMatch(/60 s/);
    expect(verdict.line).toMatch(/2 upload steps ran on the stand-ins/);
  });

  it('fails in CI when a call takes more than 25 ms on average, or the run more than 120 s', () => {
    expect(speedGate([{ n: 10, ms: 260 }], 1_000, { ci: true }).failure).toMatch(/26\.0 ms a call.*25 ms/);
    expect(speedGate([{ n: 10, ms: 250 }], 1_000, { ci: true }).failure).toBeUndefined();
    expect(speedGate([{ n: 10, ms: 10 }], 121_000, { ci: true }).failure).toMatch(/121 s.*120 s/);
    expect(speedGate([{ n: 10, ms: 10 }], 120_000, { ci: true }).failure).toBeUndefined();
  });

  it('only warns off CI, where the load of other work on the Mac can slow a run that is right', () => {
    const verdict = speedGate([{ n: 10, ms: 400 }], 200_000, { ci: false });
    expect(verdict.failure).toBeUndefined();
    expect(verdict.line).toMatch(/over the gate/);
  });

  it('passes a run with no call', () => {
    const verdict = speedGate([], 5_000, { ci: true });
    expect(verdict.failure).toBeUndefined();
    expect(verdict.line).toMatch(/0 calls, 0\.0 ms a call/);
  });

  it('reads the stats file of each worker file in the run folder, and nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'madar-stats-test-'));
    try {
      writeFileSync(join(dir, 'madar_w1-a.json'), JSON.stringify({ n: 3, ms: 30 }));
      writeFileSync(join(dir, 'madar_w2-b.json'), JSON.stringify({ n: 1, ms: 5, standIns: 1 }));
      writeFileSync(join(dir, 'notes.txt'), 'not a stats file');
      expect(readWorkerStats(dir).sort((a, b) => a.n - b.n)).toEqual([{ n: 1, ms: 5, standIns: 1 }, { n: 3, ms: 30 }]);
      expect(() => writeFileSync(join(dir, 'madar_w3-c.json'), '{"n":"x"}')).not.toThrow();
      expect(() => readWorkerStats(dir)).toThrow(/madar_w3-c\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
