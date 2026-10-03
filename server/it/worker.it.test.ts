import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES } from '../../src/api/remote/wire';

/**
 * The batch smoke on both hosts of the same bundle (plan 2b, point 2; task E4): `supabase functions serve` (Deno, the main host)
 * and `wrangler dev` (Cloudflare Workers, the fallback host), each against the local stack. It needs the local stack
 * (`supabase start`) and the Docker lock. It builds the bundles first. It talks only to 127.0.0.1.
 *
 * The parts that other tracks still build (the token check, runCall, MCP, jobs) answer with their stubs today, so the smoke
 * asks the two hosts to give the same answer there, not a fixed one.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const SUPABASE = 'http://127.0.0.1:54321';
const WORKER_PORT = 8797;
const ORIGIN = 'http://127.0.0.1:5173';
const MIN_BUILD = '2026.10.4';

type Host = { name: 'supabase' | 'workers'; base: string; region: string };
const HOSTS: Host[] = [
  { name: 'supabase', base: `${SUPABASE}/functions/v1`, region: 'local-deno' },
  { name: 'workers', base: `http://127.0.0.1:${WORKER_PORT}`, region: 'local-workers' },
];

let dir = '';
const children: ChildProcess[] = [];

function secretKey(): string {
  const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as Record<string, string>;
  return status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
}

function envFile(name: string, values: Record<string, string>): string {
  const path = join(dir, name);
  writeFileSync(path, Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  return path;
}

function start(command: string, args: string[]): void {
  const child = spawn(command, args, { cwd: ROOT, detached: true, stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  children.push(child);
}

async function waitFor(url: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (body.includes('"calls"')) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`${url} did not answer in ${ms} ms.`);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'madar-e4-'));
  execFileSync('npm', ['run', 'build:server'], { cwd: ROOT, stdio: 'ignore' });
  const common = {
    MADAR_SECRET_KEY: secretKey(),
    APP_URL: ORIGIN,
    MAIL_FROM: 'Madar <notices@madar.test>',
    MAIL_DRIVER: 'outbox',
    MIN_CLIENT_BUILD: MIN_BUILD,
  };
  // Inside the Docker network the pooler is "pooler" (the Deno resolver refuses the container name with "_"; proof E1).
  const functions = envFile('functions.env', { ...common, DATABASE_URL: 'postgres://postgres.pooler-dev:postgres@pooler:6543/postgres', SB_REGION: 'local-deno' });
  const worker = envFile('worker.env', { ...common, SUPABASE_URL: SUPABASE, DATABASE_URL: 'postgres://postgres.pooler-dev:postgres@127.0.0.1:54329/postgres', SB_REGION: 'local-workers' });
  start('npx', ['supabase', 'functions', 'serve', '--env-file', functions]);
  start('npx', ['wrangler', 'dev', '-c', 'wrangler.server.toml', '--env-file', worker, '--port', String(WORKER_PORT), '--ip', '127.0.0.1', '--show-interactive-dev-session=false']);
  await Promise.all(HOSTS.map((host) => waitFor(`${host.base}/api/health`, 240_000)));
}, 300_000);

afterAll(() => {
  for (const child of children) {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const post = (host: Host, path: string, body: string, headers: Record<string, string> = {}) =>
  fetch(`${host.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Madar-Build': MIN_BUILD, ...headers }, body });
const batchOf = (calls: unknown[]) => JSON.stringify({ v: 1, calls });
const call = (i: number, name: string, input: unknown = {}) => ({ i, name, input });

describe.each(HOSTS)('the server on $name', (host) => {
  it('answers GET /api/health from the database, through the transaction pooler, with its region', async () => {
    const response = await fetch(`${host.base}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, region: host.region, calls: 108, checks: { database: 'ok', lock: 'ok', asyncContext: 'ok' } });
  });

  it('refuses 13 entries, two overview calls, a body over 256 KB and an old build, before any sign-in', async () => {
    const many = await post(host, '/api/batch', batchOf(Array.from({ length: 13 }, (_, i) => call(i, 'tasks.get', { id: `tsk_${i}` }))));
    expect([many.status, ((await many.json()) as { error: { details: { reason: string } } }).error.details.reason]).toEqual([413, 'too_many_calls']);
    const overviews = await post(host, '/api/batch', batchOf([call(0, 'projects.list'), call(1, 'dashboard.get')]));
    expect([overviews.status, ((await overviews.json()) as { error: { details: { reason: string } } }).error.details.reason]).toEqual([413, 'too_many_overviews']);
    const big = await post(host, '/api/batch', batchOf([call(0, 'comments.create', { text: 'x'.repeat(MAX_BODY_BYTES) })]));
    expect(big.status).toBe(413);
    const old = await post(host, '/api/batch', batchOf([call(0, 'tasks.get')]), { 'X-Madar-Build': '2026.9.30' });
    expect([old.status, ((await old.json()) as { error: { details: { reason: string } } }).error.details.reason]).toEqual([409, 'client_outdated']);
  });

  it('answers a batch without a valid sign-in with a refusal, never with 200', async () => {
    const response = await post(host, '/api/batch', batchOf([call(0, 'session.get')]), { Authorization: 'Bearer not-a-token' });
    expect([401, 500]).toContain(response.status);
  });

  it('answers 404 for an unknown path of the api app', async () => {
    const response = await post(host, '/api/nothing', '{}');
    expect(response.status).toBe(404);
  });
});

describe('both hosts', () => {
  async function answer(host: Host, path: string, init: RequestInit): Promise<{ status: number; body: string }> {
    const response = await fetch(`${host.base}${path}`, init);
    return { status: response.status, body: await response.text() };
  }

  it('give the same answer for the parts that other tracks still build: sign-in, MCP and jobs', async () => {
    const cases: [string, RequestInit][] = [
      ['/api/batch', { method: 'POST', headers: { 'X-Madar-Build': MIN_BUILD, Authorization: 'Bearer not-a-token' }, body: batchOf([call(0, 'session.get')]) }],
      ['/mcp', { method: 'POST', body: '{}' }],
      ['/jobs/run', { method: 'POST', body: '{}' }],
    ];
    for (const [path, init] of cases) {
      const [deno, workers] = await Promise.all(HOSTS.map((host) => answer(host, path, init)));
      expect(workers, path).toEqual(deno);
      expect(deno.status, path).not.toBe(404);
    }
  });

  it('answer the CORS preflight of the screens on Workers, with the allowed origin and a 2-hour max age', async () => {
    const workers = HOSTS[1];
    const response = await fetch(`${workers.base}/api/batch`, {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type, x-madar-build' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(response.headers.get('Access-Control-Max-Age')).toBe('7200');
  });
});
