import { describe, expect, it } from 'vitest';
import { checkHealth, HEALTH_LOCK_KEY, type HealthClient } from './health';

type Seen = { text: string; values?: unknown[] };

/** A database client that records each statement. "failOn" makes the statement that contains it throw. */
function fakeClient(o: { failOn?: string; held?: number } = {}): HealthClient & { seen: Seen[]; ended: boolean } {
  const seen: Seen[] = [];
  const client = {
    seen,
    ended: false,
    async query(text: string, values?: unknown[]) {
      seen.push(values === undefined ? { text } : { text, values });
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (o.failOn && text.includes(o.failOn)) throw new Error('connection reset');
      if (text.includes('pg_locks')) return { rows: [{ held: o.held ?? 1 }] };
      return { rows: [] };
    },
    async end() {
      client.ended = true;
    },
  };
  return client;
}

describe('the health check', () => {
  it('runs one read-only transaction that holds the health lock, and names the region and the call count', async () => {
    const client = fakeClient();
    const result = await checkHealth({ connect: async () => client, region: 'eu-central-1' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, region: 'eu-central-1', calls: 108, checks: { database: 'ok', lock: 'ok', asyncContext: 'ok' } });
    const starts = ['begin isolation level repeatable read, read only', 'set local statement_timeout', 'select pg_advisory_xact_lock($1)', 'select count(*)::int as held', 'commit'];
    expect(client.seen).toHaveLength(starts.length);
    client.seen.forEach((s, n) => expect(s.text.startsWith(starts[n])).toBe(true));
    expect(client.seen[2].values).toEqual([HEALTH_LOCK_KEY]);
    expect(client.ended).toBe(true);
  });

  it('never takes the office lock: the health key is its own', () => {
    expect(HEALTH_LOCK_KEY).not.toBe(1);
    expect(Number.isSafeInteger(HEALTH_LOCK_KEY)).toBe(true);
  });

  it('answers 503 when the database fails, rolls back, closes the client, and never shows the database error', async () => {
    const client = fakeClient({ failOn: 'pg_advisory_xact_lock' });
    const logged: unknown[] = [];
    const log = { info: () => undefined, warn: () => undefined, error: (message: string, fields?: unknown) => void logged.push({ message, fields }) };
    const result = await checkHealth({ connect: async () => client, region: 'eu-central-1', log });
    expect(logged).toEqual([{ message: 'The health check failed.', fields: { error: 'connection reset' } }]);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, checks: { database: 'failed' } });
    expect(JSON.stringify(result.body)).not.toContain('connection reset');
    expect(client.seen.at(-1)?.text).toBe('rollback');
    expect(client.ended).toBe(true);
  });

  it('answers 503 when the connection fails', async () => {
    const result = await checkHealth({ connect: async () => { throw new Error('refused'); }, region: 'eu-central-1' });
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, checks: { database: 'failed' } });
  });

  it('reports a lock that the pooler did not hold', async () => {
    const result = await checkHealth({ connect: async () => fakeClient({ held: 0 }), region: 'eu-central-1' });
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, checks: { database: 'ok', lock: 'failed' } });
  });

  it('keeps the request context across the database awaits (AsyncLocalStorage)', async () => {
    const results = await Promise.all([1, 2, 3].map(() => checkHealth({ connect: async () => fakeClient(), region: 'r' })));
    for (const result of results) expect(result.body.checks.asyncContext).toBe('ok');
  });
});
