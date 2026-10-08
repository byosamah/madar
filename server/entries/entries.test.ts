import { afterEach, describe, expect, it, vi } from 'vitest';
import { MissingConfigError } from '../core/deps';
import { setEnvSource } from '../env';
import { warmApi } from './api';
import denoApi from './deno-api';
import denoJobs from './deno-jobs';
import denoMcp from './deno-mcp';
import { lazyStart } from './start';
import worker from './worker';

/** A local environment with made-up values. No test here opens a database connection. */
const LOCAL = {
  DATABASE_URL: 'postgres://postgres.pooler-dev:postgres@127.0.0.1:54329/postgres',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  MADAR_SECRET_KEY: 'sb_secret_made_up',
  APP_URL: 'http://127.0.0.1:5173',
  MAIL_FROM: 'Madar <notices@madar.test>',
  MAIL_DRIVER: 'outbox',
};
const ORIGIN = 'http://127.0.0.1:5173';

const preflight = (url: string) =>
  new Request(url, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });

afterEach(() => {
  setEnvSource(undefined);
  vi.restoreAllMocks();
});

describe('the Supabase entries', () => {
  it('serve the api app under /api, the function name that Supabase puts first in the path', async () => {
    setEnvSource(LOCAL);
    const response = await denoApi.fetch(preflight('http://127.0.0.1/api/batch'));
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Max-Age')).toBe('7200');
    const unknown = await denoApi.fetch(new Request('http://127.0.0.1/api/nothing', { method: 'POST' }));
    expect(unknown.status).toBe(404);
  });

  it('serve the MCP app under /mcp and the job app under /jobs, mounted even before their tracks build them', async () => {
    setEnvSource(LOCAL);
    const mcp = await denoMcp.fetch(new Request('http://127.0.0.1/mcp', { method: 'POST' }));
    const jobs = await denoJobs.fetch(new Request('http://127.0.0.1/jobs/run', { method: 'POST' }));
    for (const response of [mcp, jobs]) expect(response.status).not.toBe(404);
  });
});

describe('the Workers entry', () => {
  it('mounts /api, /mcp and /jobs from the same source, with the bindings of the request', async () => {
    const api = await worker.fetch(preflight('http://127.0.0.1/api/batch'), LOCAL);
    expect(api.status).toBe(204);
    expect(api.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const mcp = await worker.fetch(new Request('http://127.0.0.1/mcp', { method: 'POST' }), LOCAL);
    const jobs = await worker.fetch(new Request('http://127.0.0.1/jobs/run', { method: 'POST' }), LOCAL);
    for (const response of [mcp, jobs]) expect(response.status).not.toBe(404);
    const other = await worker.fetch(new Request('http://127.0.0.1/elsewhere'), LOCAL);
    expect(other.status).toBe(404);
  });
});

describe('the warm-up of a new worker (performance audit LIV-7)', () => {
  it('builds the app once before the first request and starts its warm-up; the first request reuses that build', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let builds = 0;
    let warms = 0;
    const start = lazyStart('api', () => {
      builds += 1;
      return { fetch: () => new Response('ok'), region: 'eu-central-1', warm: () => void (warms += 1) };
    });
    start.warm();
    start.warm();
    expect([builds, warms]).toEqual([1, 1]);
    expect(await (await start(new Request('http://127.0.0.1/'))).text()).toBe('ok');
    expect([builds, warms]).toEqual([1, 1]);
  });

  it('keeps a failed build silent, and the first request logs it and answers 503 as before', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => void lines.push(line));
    const start = lazyStart('api', () => {
      throw new MissingConfigError(['DATABASE_URL']);
    });
    start.warm();
    expect(lines).toEqual([]);
    expect((await start(new Request('http://127.0.0.1/api/batch', { method: 'POST' }))).status).toBe(503);
    expect(lines.join('\n')).toContain('DATABASE_URL');
  });

  it('the api warm-up opens the read connection and loads the key set, and reads nothing', async () => {
    const steps: string[] = [];
    const db = {
      warm: async (mode: string) => void steps.push(`warm:${mode}`),
      tx: async () => steps.push('tx'),
      statement: async () => steps.push('statement'),
      savepoint: async () => steps.push('savepoint'),
    };
    const fetchJwks = vi.fn(async () => Response.json({ keys: [] }));
    vi.stubGlobal('fetch', fetchJwks);
    setEnvSource({ SUPABASE_URL: 'https://warm-api.supabase.co' });
    warmApi({ db } as never);
    expect(steps).toEqual(['warm:read']);
    expect(String((fetchJwks.mock.calls[0] as unknown[])[0])).toBe('https://warm-api.supabase.co/auth/v1/.well-known/jwks.json');
    vi.unstubAllGlobals();
  });

  it('the api function warms at import only on Supabase, never in a test or a script', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warmed: string[] = [];
    vi.resetModules();
    vi.doMock('./api', () => ({ startApi: () => ({ fetch: () => new Response('ok'), region: 'eu-central-1', warm: () => void warmed.push('warm') }) }));
    try {
      await import('./deno-api');
      expect(warmed).toEqual([]);
      vi.resetModules();
      vi.stubGlobal('EdgeRuntime', { waitUntil: () => undefined });
      const entry = (await import('./deno-api')).default;
      expect(warmed).toEqual(['warm']);
      expect(await (await entry.fetch(new Request('http://127.0.0.1/api/health'))).text()).toBe('ok');
      expect(warmed).toEqual(['warm']);
    } finally {
      vi.doUnmock('./api');
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

describe('a start with a missing value', () => {
  it('answers 503 not_configured, logs the missing names, and never shows them to the caller', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => void lines.push(line));
    const start = lazyStart('api', () => {
      throw new MissingConfigError(['DATABASE_URL', 'APP_URL']);
    });
    const response = await start(new Request('http://127.0.0.1/api/batch', { method: 'POST' }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: 'failed', details: { reason: 'not_configured' } } });
    expect(JSON.stringify(body)).not.toContain('DATABASE_URL');
    expect(lines.join('\n')).toContain('DATABASE_URL');
    expect(lines.join('\n')).toContain('APP_URL');
  });

  it('builds the app once, and tries again on the next request after a failed start', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let builds = 0;
    const start = lazyStart('api', () => {
      builds += 1;
      if (builds === 1) throw new Error('not yet');
      return { fetch: () => new Response('ok'), region: 'eu-central-1' };
    });
    expect((await start(new Request('http://127.0.0.1/'))).status).toBe(503);
    expect(await (await start(new Request('http://127.0.0.1/'))).text()).toBe('ok');
    expect(await (await start(new Request('http://127.0.0.1/'))).text()).toBe('ok');
    expect(builds).toBe(2);
  });
});
