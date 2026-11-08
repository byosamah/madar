import { describe, expect, it } from 'vitest';
import { JOBS_SECRET_HEADER } from '../jobs/app';
import { fakeDeps } from '../test/fakes/deps';
import { CRON_PATH, FANOUT_PARALLEL, runFanout, selfTransport, type FanoutTransport } from './fanout';

const AT = new Date('2026-11-08T06:15:00.000Z');

describe('runFanout', () => {
  it('runs every id once, in order, and one leg that fails does not stop the next', async () => {
    const { log } = fakeDeps();
    const seen: string[] = [];
    const transport: FanoutTransport = async (leg) => {
      seen.push(leg.ent);
      if (seen.length === 1) throw new Error('The leg broke.');
      return new Response('{}', { status: 200 });
    };
    const out = await runFanout({ ids: ['ent_001', 'ent_002'], at: AT, transport, log });
    expect(seen).toEqual(['ent_001', 'ent_002']);
    expect(out.legs.map((leg) => [leg.ent, leg.ok, leg.status])).toEqual([['ent_001', false, null], ['ent_002', true, 200]]);
    expect(FANOUT_PARALLEL).toBe(1);
  });

  it('counts an answer with status 500 as a failed leg and logs no secret', async () => {
    const { log, logs } = fakeDeps();
    const transport: FanoutTransport = async () => new Response('secret-text-of-the-body', { status: 500 });
    const out = await runFanout({ ids: ['ent_001'], at: AT, transport, log, now: () => 5 });
    expect(out.legs).toEqual([{ ent: 'ent_001', ok: false, ms: 0, status: 500 }]);
    const text = JSON.stringify(logs);
    expect(text).toContain('ent_001');
    expect(text).toContain('500');
    expect(text).not.toContain('secret-text-of-the-body');
  });

  it('gives a result for an empty list and never throws', async () => {
    const { log } = fakeDeps();
    expect(await runFanout({ ids: [], at: AT, transport: async () => new Response(), log })).toEqual({ legs: [] });
  });
});

describe('the transports', () => {
  it('self transport posts {ent, at} to env.SELF with the jobs secret header', async () => {
    const seen: Request[] = [];
    const env = { SELF: { fetch: async (request: Request) => (seen.push(request), new Response('{}')) } };
    const transport = selfTransport(env, { kind: 'self', secret: 'jobs-secret', apiUrl: 'https://madar.test/api' });
    await transport({ ent: 'ent_002', at: AT.toISOString() });
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0].url).pathname).toBe(CRON_PATH);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].headers.get(JOBS_SECRET_HEADER)).toBe('jobs-secret');
    expect(await seen[0].json()).toEqual({ ent: 'ent_002', at: AT.toISOString() });
  });

  it('api transport posts to <apiUrl>/internal/cron', async () => {
    const seen: Request[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => (seen.push(new Request(input, init)), new Response('{}'))) as typeof fetch;
    try {
      const transport = selfTransport({}, { kind: 'api', secret: 'jobs-secret', apiUrl: 'https://madar.test/api' });
      await transport({ ent: 'ent_001', at: AT.toISOString() });
    } finally {
      globalThis.fetch = original;
    }
    expect(seen.map((request) => request.url)).toEqual(['https://madar.test/api/internal/cron']);
    expect(seen[0].headers.get(JOBS_SECRET_HEADER)).toBe('jobs-secret');
  });

  it('self transport throws a clear error that names the binding SELF when env.SELF is absent', async () => {
    const transport = selfTransport({}, { kind: 'self', secret: 's', apiUrl: 'https://madar.test/api' });
    await expect(transport({ ent: 'ent_001', at: AT.toISOString() })).rejects.toThrow(/SELF/);
  });

  it('merges extra body fields and takes another path (the probe)', async () => {
    const seen: Request[] = [];
    const env = { SELF: { fetch: async (request: Request) => (seen.push(request), new Response('{}')) } };
    const transport = selfTransport(env, { kind: 'self', secret: 's', apiUrl: 'https://madar.test/api', path: '/api/internal/probe/leg', extra: { outside: 3 } });
    await transport({ ent: 'ent_901', at: AT.toISOString() });
    expect(new URL(seen[0].url).pathname).toBe('/api/internal/probe/leg');
    expect(await seen[0].json()).toEqual({ ent: 'ent_901', at: AT.toISOString(), outside: 3 });
  });
});
