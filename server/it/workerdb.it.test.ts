import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localClient } from './migrate';

/**
 * The C1 proof of the Workers path (plan 6.3, C1 "done when"; proof.md, E4 and Z0a item 7): requests in a row through deps.db on
 * "wrangler dev" all answer 200. Each request opens its own pgDb from the Hyperdrive binding DB, which points at the local
 * transaction pooler, runs a write transaction that takes a transaction lock with the set local timeouts, runs one statement, and
 * closes its pools after the answer. A pool kept for the isolate would answer the first request and hang the next (proof.md, E4).
 * It needs the local stack (`supabase start`) and the Docker lock. It talks only to 127.0.0.1.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const PORT = 8798;
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_PASSWORD = 'madar-local-test';
/** The local transaction pooler from the Mac, as the server role (tenant pooler-dev). Local test values only. */
const LOCAL_POOLER = `postgres://madar_server.pooler-dev:${SERVER_PASSWORD}@127.0.0.1:54329/postgres?sslmode=disable`;

let dir = '';
let child: ChildProcess | undefined;
let admin: pg.Client | undefined;

function secretKey(): string {
  const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as Record<string, string>;
  return status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
}

beforeAll(async () => {
  admin = await localClient();
  await admin.query(`alter role madar_server login password '${SERVER_PASSWORD}'`);
  dir = mkdtempSync(join(tmpdir(), 'madar-c1-'));
  const envFile = join(dir, 'worker.env');
  // No DATABASE_URL and no DATABASE_CA: the Worker takes its database from the binding.
  const values = {
    SUPABASE_URL: 'http://127.0.0.1:54321', MADAR_SECRET_KEY: secretKey(), APP_URL: 'http://127.0.0.1:5173',
    MAIL_FROM: 'Madar <notices@madar.test>', MAIL_DRIVER: 'outbox', SB_REGION: 'local-workers',
  };
  writeFileSync(envFile, Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  child = spawn(
    'npx',
    ['wrangler', 'dev', '-c', 'server/it/workerdb/wrangler.toml', '--env-file', envFile, '--port', String(PORT), '--ip', '127.0.0.1', '--show-interactive-dev-session=false'],
    { cwd: ROOT, detached: true, stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB: LOCAL_POOLER } },
  );
  const until = Date.now() + 180_000;
  while (Date.now() < until) {
    try {
      await fetch(`${BASE}/nothing`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error('wrangler dev did not answer in 180 s.');
}, 200_000);

afterAll(async () => {
  try {
    if (child?.pid) process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
  if (admin) {
    await admin.query('alter role madar_server nologin password null');
    await admin.end();
  }
});

describe('deps.db on wrangler dev, through the Hyperdrive binding', () => {
  it('answers 200 to requests in a row, each with its own transaction, lock, set local timeouts and statement', async () => {
    for (let n = 0; n < 3; n += 1) {
      const response = await fetch(`${BASE}/api/db`, { signal: AbortSignal.timeout(20_000) });
      const body = await response.text();
      expect(response.status, `request ${n + 1}: ${body}`).toBe(200);
      expect(JSON.parse(body)).toEqual({ ok: true, tx: { user: 'madar_server', lockHeld: true, timeouts: { lock: '5s', statement: '10s' } }, settingsRows: 1 });
    }
  });

  it('answers 200 to requests at the same time, each on its own connections', async () => {
    const answers = await Promise.all(Array.from({ length: 3 }, async () => {
      const response = await fetch(`${BASE}/api/db`, { signal: AbortSignal.timeout(20_000) });
      return `${response.status} ${await response.text()}`;
    }));
    for (const answer of answers) expect(answer).toMatch(/^200 /);
  });
});
