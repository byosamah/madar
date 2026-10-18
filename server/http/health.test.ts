import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCK_KEY } from '../core/deps';
import { checkHealth, HEALTH_LOCK_KEY, HEALTH_SECRET_HEADER, healthAnswer, type HealthClient } from './health';

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
  it('runs one read-only transaction that holds a health lock, and names the region and the call count', async () => {
    const client = fakeClient();
    const result = await checkHealth({ connect: async () => client, region: 'eu-central-1' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, region: 'eu-central-1', calls: 118, checks: { database: 'ok', lock: 'ok', asyncContext: 'ok' } });
    const starts = ['begin isolation level repeatable read, read only', 'set local statement_timeout', 'select pg_advisory_xact_lock($1::int4, $2::int4)', 'select count(*)::int as held', 'commit'];
    expect(client.seen).toHaveLength(starts.length);
    client.seen.forEach((s, n) => expect(s.text.startsWith(starts[n])).toBe(true));
    expect(client.seen[2].values?.[0]).toBe(HEALTH_LOCK_KEY);
    expect(client.seen[3].values).toEqual(client.seen[2].values);
    expect(client.ended).toBe(true);
  });

  it('never takes the office lock: the health key is its own, in the two-key space', () => {
    expect(HEALTH_LOCK_KEY).not.toBe(DEFAULT_LOCK_KEY);
    expect(Number.isSafeInteger(HEALTH_LOCK_KEY)).toBe(true);
  });

  it('takes a new lock key for each check, so two health checks never wait on each other', async () => {
    const clients = Array.from({ length: 20 }, () => fakeClient());
    let next = 0;
    await Promise.all(clients.map(() => checkHealth({ connect: async () => clients[next++], region: 'r' })));
    const keys = new Set(clients.map((c) => JSON.stringify(c.seen[2].values)));
    expect(keys.size).toBe(20);
    for (const client of clients) {
      const [cls, obj] = client.seen[2].values as number[];
      expect(cls).toBe(HEALTH_LOCK_KEY);
      expect(Number.isInteger(obj) && obj >= 0 && obj <= 0x7fffffff).toBe(true);
    }
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

describe('GET /api/health', () => {
  const SECRET = 'made-up-jobs-secret';
  const get = (headers: Record<string, string> = {}) => new Request('http://127.0.0.1/api/health', { headers });

  it('answers a caller without the secret from memory: the region and the call count, and no database work', async () => {
    let connects = 0;
    const o = { connect: async () => { connects += 1; return fakeClient(); }, region: 'eu-central-1', secret: SECRET };
    const results = await Promise.all(Array.from({ length: 20 }, () => healthAnswer(get(), o)));
    for (const result of results) {
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ ok: true, region: 'eu-central-1', calls: 118 });
    }
    expect(connects).toBe(0);
  });

  it('runs the database check only for a caller with the jobs secret', async () => {
    let connects = 0;
    const o = { connect: async () => { connects += 1; return fakeClient(); }, region: 'eu-central-1', secret: SECRET };
    const result = await healthAnswer(get({ [HEALTH_SECRET_HEADER]: SECRET }), o);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, checks: { database: 'ok', lock: 'ok', asyncContext: 'ok' } });
    expect(connects).toBe(1);
  });

  it('refuses a wrong secret with 401 and no database work, also when the server has no secret', async () => {
    let connects = 0;
    const connect = async () => { connects += 1; return fakeClient(); };
    const wrong = await healthAnswer(get({ [HEALTH_SECRET_HEADER]: 'guess' }), { connect, region: 'r', secret: SECRET });
    const unset = await healthAnswer(get({ [HEALTH_SECRET_HEADER]: SECRET }), { connect, region: 'r' });
    for (const result of [wrong, unset]) {
      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ error: { code: 'unauthenticated' } });
    }
    expect(connects).toBe(0);
  });
});

describe('the host and the file store in the health answer (owner, 2026-10-16)', () => {
  const SECRET = 'made-up-jobs-secret';
  const get = (headers: Record<string, string> = {}) => new Request('http://127.0.0.1/api/health', { headers });

  it('names the host and the file store without the secret, and needs no database for it', async () => {
    let connects = 0;
    const o = { connect: async () => { connects += 1; return fakeClient(); }, region: 'workers-eu-central-1', host: 'workers', fileStore: 'r2', secret: SECRET };
    const result = await healthAnswer(get(), o);
    expect(result.body).toEqual({ ok: true, region: 'workers-eu-central-1', host: 'workers', fileStore: 'r2', calls: 118 });
    expect(connects).toBe(0);
  });

  it('names them beside the database checks too, and never a secret', async () => {
    const o = { connect: async () => fakeClient(), region: 'eu-central-1', host: 'supabase', fileStore: 'supabase', secret: SECRET };
    const result = await healthAnswer(get({ [HEALTH_SECRET_HEADER]: SECRET }), o);
    expect(result.body).toMatchObject({ ok: true, host: 'supabase', fileStore: 'supabase', checks: { database: 'ok', lock: 'ok', asyncContext: 'ok' } });
    expect(JSON.stringify(result.body)).not.toContain(SECRET);
  });
});
