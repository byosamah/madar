import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localClient } from './migrate';

/**
 * Suite 10, the schedule (plan 5.5; task N3.2) [Docker]: the platform migration 20261004000300_platform_cron.sql on the local
 * stack after `supabase db reset`. pg_cron calls POST /functions/v1/jobs/run every 15 minutes through pg_net, with the headers
 * x-region and x-madar-jobs-secret. The address and the secret come from the Vault secrets project_url and jobs_secret, by
 * name. The suite gives them local values only: a made-up secret, and an address inside the Docker network or on this Mac.
 *
 * It needs the local stack and the Docker lock. It builds the server bundle and runs `supabase functions serve`. It talks only
 * to 127.0.0.1 and to the local Docker network. It leaves the schedule and the Vault as it found them.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261004000300_platform_cron.sql');
const SUPABASE = 'http://127.0.0.1:54321';
/** Kong inside the local Docker network, as pg_net in the database container reaches it. */
const KONG_IN_DOCKER = 'http://kong:8000';
/** A made-up local value. */
const JOBS_SECRET = 'local-cron-secret-made-up';
const SCHEDULE = '*/15 * * * *';
const HISTORY_SCHEDULE = '0 3 * * *';

let db: pg.Client;
let dir = '';
let serve: ChildProcess | undefined;
let echo: Server | undefined;
let vaultBefore: { name: string; id: string }[] = [];

type Job = { jobid: number; schedule: string; command: string; active: boolean; username: string; database: string };
type Response = { id: number; status_code: number | null; content: string | null; error_msg: string | null; timed_out: boolean | null };

const job = async (name = 'madar-jobs'): Promise<Job | undefined> =>
  (await db.query<Job>('select jobid::integer, schedule, command, active, username, database from cron.job where jobname = $1', [name])).rows[0];
const lastResponseId = async (): Promise<number> => (await db.query<{ id: number }>('select coalesce(max(id), 0)::integer as id from net._http_response')).rows[0].id;
const heartbeat = async (): Promise<Date | undefined> =>
  (await db.query<{ done_at: Date }>("select done_at from public.job_runs where key = 'heartbeat'")).rows[0]?.done_at;

/** Sets a Vault secret by name: a new one, or a new value for the one that exists. */
async function setSecret(name: string, value: string): Promise<void> {
  const { rows } = await db.query<{ id: string }>('select id::text from vault.secrets where name = $1', [name]);
  if (rows[0]) await db.query('select vault.update_secret($1::uuid, $2)', [rows[0].id, value]);
  else await db.query('select vault.create_secret($1, $2)', [value, name]);
}

async function dropSecrets(): Promise<void> {
  await db.query("delete from vault.secrets where name in ('project_url', 'jobs_secret') and not (id::text = any($1::text[]))", [vaultBefore.map((s) => s.id)]);
}

/** Runs the command of the schedule once, now, as pg_cron runs it. */
const runCommand = async (): Promise<void> => {
  await db.query((await job())!.command);
};

/** The first response after `after`, once pg_net has it. */
async function responseAfter(after: number, ms: number): Promise<Response> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const { rows } = await db.query<Response>(
      'select id::integer, status_code, content, error_msg, timed_out from net._http_response where id > $1 order by id limit 1',
      [after],
    );
    if (rows[0]) return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`pg_net wrote no response in ${ms} ms.`);
}

function secretKey(): string {
  const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as Record<string, string>;
  return status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
}

/**
 * Waits until the functions of this suite's serve process answer. A 401 is no proof: an edge runtime without JOBS_SECRET
 * (CI starts one before the suite) gives 401 to every jobs call. Only this suite's env file gives region local-deno with
 * JOBS_SECRET, and only with that secret does GET /api/health run its database check.
 */
async function waitForServe(ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const response = await fetch(`${SUPABASE}/functions/v1/api/health`, { headers: { 'x-madar-jobs-secret': JOBS_SECRET } });
      const body = (await response.json().catch(() => ({}))) as { region?: string; checks?: { database?: string } };
      if (body.region === 'local-deno' && body.checks?.database === 'ok') return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`The functions of this suite did not answer in ${ms} ms.`);
}

/**
 * The address of this machine as the database container sees it. Docker Desktop on macOS forwards host.docker.internal.
 * On Linux (CI) the Supabase CLI does not promise that name, so the suite uses the gateway of the stack network.
 */
function hostSeenFromDocker(): string {
  if (process.platform === 'darwin') return 'host.docker.internal';
  return execFileSync('docker', ['network', 'inspect', 'supabase_network_madar', '--format', '{{(index .IPAM.Config 0).Gateway}}'], { encoding: 'utf8' }).trim();
}

beforeAll(async () => {
  db = await localClient();
  vaultBefore = (await db.query<{ name: string; id: string }>("select name, id::text from vault.secrets where name in ('project_url', 'jobs_secret')")).rows;
  expect(vaultBefore, 'the local Vault already holds project_url or jobs_secret; run supabase db reset first').toEqual([]);
}, 30_000);

afterAll(async () => {
  try {
    if (serve?.pid) process.kill(-serve.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
  echo?.close();
  if (db) {
    const current = await job().catch(() => undefined);
    if (current && current.schedule !== SCHEDULE) await db.query('select cron.alter_job($1, schedule => $2)', [current.jobid, SCHEDULE]);
    await db.query("delete from cron.job_run_details where command = 'madar-cron-history test row'").catch(() => undefined);
    await dropSecrets();
    await db.end();
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('suite 10: the schedule of the 15-minute job', () => {
  it('schedules madar-jobs every 15 minutes as postgres, with a command that reads the address and the secret from the Vault by name', async () => {
    const current = await job();
    expect(current).toMatchObject({ schedule: SCHEDULE, active: true, username: 'postgres', database: 'postgres' });
    const command = current!.command;
    expect(command).toContain('/functions/v1/jobs/run');
    expect(command).toMatch(/'x-region',\s*'eu-central-1'/);
    expect(command).toMatch(/'x-madar-jobs-secret',\s*jobs_secret/);
    expect(command).toMatch(/vault\.decrypted_secrets where name = 'project_url'/);
    expect(command).toMatch(/vault\.decrypted_secrets where name = 'jobs_secret'/);
    // pg_net waits up to 2 minutes, under the 150 s wall clock of a function on the free plan.
    expect(command).toMatch(/timeout_milliseconds\s*:=\s*120000/);
  });

  it('holds no secret and no environment address in the migration (plan 6.1, rule 4)', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).not.toMatch(/https?:\/\//);
    expect(sql).not.toMatch(/supabase\.co/);
    expect(sql).not.toMatch(/create_secret|update_secret/);
  });

  it('makes the schedule once: the migration run again keeps one madar-jobs job and one madar-cron-history job', async () => {
    const before = await job();
    const history = await job('madar-cron-history');
    await db.query(readFileSync(MIGRATION, 'utf8'));
    const { rows } = await db.query<{ name: string; n: number }>(
      "select jobname as name, count(*)::integer as n from cron.job where jobname in ('madar-jobs', 'madar-cron-history') group by jobname order by jobname",
    );
    expect(rows).toEqual([
      { name: 'madar-cron-history', n: 1 },
      { name: 'madar-jobs', n: 1 },
    ]);
    expect((await job())!.jobid).toBe(before!.jobid);
    expect((await job('madar-cron-history'))!.jobid).toBe(history!.jobid);
  });

  it('deletes the run history of pg_cron older than 7 days every night at 03:00, and keeps the newer rows', async () => {
    const history = await job('madar-cron-history');
    expect(history).toMatchObject({ schedule: HISTORY_SCHEDULE, active: true, username: 'postgres', database: 'postgres' });
    const jobid = (await job())!.jobid;
    // The role postgres may not read the sequence of pg_cron, so the test rows take run numbers far above the real ones.
    const insert = (days: number) =>
      db.query<{ runid: number }>(
        `insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
         select $1, coalesce(max(runid), 0) + 1000000, 0, 'postgres', 'postgres', 'madar-cron-history test row', 'succeeded', 'test',
           now() - make_interval(days => $2), now() - make_interval(days => $2)
         from cron.job_run_details
         returning runid::integer`,
        [jobid, days],
      );
    const old = (await insert(8)).rows[0].runid;
    const recent = (await insert(6)).rows[0].runid;
    await db.query(history!.command);
    const { rows } = await db.query<{ runid: number }>('select runid::integer from cron.job_run_details where runid = any($1::bigint[]) order by runid', [[old, recent]]);
    expect(rows.map((row) => row.runid)).toEqual([recent]);
  });

  it('refuses to send the secret to a project_url that is plain http outside the local Docker network', async () => {
    const before = await lastResponseId();
    const queued = async () => (await db.query<{ n: number }>('select count(*)::integer as n from net.http_request_queue')).rows[0].n;
    const queue = await queued();
    await setSecret('jobs_secret', JOBS_SECRET);
    for (const url of ['http://example.invalid', 'HTTP://example.invalid/', 'http://kong@example.invalid', 'http://10.0.0.1.example.invalid']) {
      await setSecret('project_url', url);
      await expect(runCommand(), url).rejects.toThrow(/project_url must use https/);
    }
    expect(await queued()).toBe(queue);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await lastResponseId()).toBe(before);
    await dropSecrets();
  });

  it('fails with a plain message and sends nothing while a Vault secret is missing', async () => {
    const before = await lastResponseId();
    const queued = async () => (await db.query<{ n: number }>('select count(*)::integer as n from net.http_request_queue')).rows[0].n;
    const queue = await queued();
    await expect(runCommand()).rejects.toThrow(/Vault secrets project_url and jobs_secret/);
    await setSecret('project_url', KONG_IN_DOCKER);
    await expect(runCommand()).rejects.toThrow(/Vault secrets project_url and jobs_secret/);
    expect(await queued()).toBe(queue);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await lastResponseId()).toBe(before);
    await dropSecrets();
  });

  it('posts to <project_url>/functions/v1/jobs/run with x-region eu-central-1 and the secret, also when the address ends with /', async () => {
    const seen: { method?: string; url?: string; headers: IncomingHttpHeaders }[] = [];
    echo = createServer((request, response) => {
      seen.push({ method: request.method, url: request.url, headers: request.headers });
      request.resume();
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"v":1,"ok":true}');
    });
    // All addresses: on Linux the request comes from the gateway of the stack network, not from 127.0.0.1.
    await new Promise<void>((resolve) => echo!.listen(0, '0.0.0.0', resolve));
    const port = (echo.address() as AddressInfo).port;
    await setSecret('project_url', `http://${hostSeenFromDocker()}:${port}/`);
    await setSecret('jobs_secret', JOBS_SECRET);
    const before = await lastResponseId();
    await runCommand();
    const response = await responseAfter(before, 20_000);
    expect({ status: response.status_code, error: response.error_msg }).toEqual({ status: 200, error: null });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/functions/v1/jobs/run' });
    expect(seen[0].headers).toMatchObject({ 'x-region': 'eu-central-1', 'x-madar-jobs-secret': JOBS_SECRET, 'content-type': 'application/json' });
    echo.close();
    echo = undefined;
  }, 30_000);

  describe('against the jobs function on supabase functions serve', () => {
    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), 'madar-n3-cron-'));
      execFileSync('npm', ['run', 'build:server'], { cwd: ROOT, stdio: 'ignore' });
      const env = {
        MADAR_SECRET_KEY: secretKey(),
        APP_URL: 'http://127.0.0.1:5173',
        MAIL_FROM: 'Madar <notices@madar.test>',
        MAIL_DRIVER: 'outbox',
        MIN_CLIENT_BUILD: '2026.10.4',
        JOBS_SECRET,
        // Inside the Docker network the pooler is "pooler" (proof E1).
        DATABASE_URL: 'postgres://postgres.pooler-dev:postgres@pooler:6543/postgres',
        SB_REGION: 'local-deno',
      };
      const file = join(dir, 'functions.env');
      writeFileSync(file, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
      serve = spawn('npx', ['supabase', 'functions', 'serve', '--env-file', file], { cwd: ROOT, detached: true, stdio: 'ignore' });
      await waitForServe(240_000);
      await setSecret('project_url', KONG_IN_DOCKER);
    }, 300_000);

    it('gets 401 from the function for a wrong secret in the Vault, and the heartbeat stays', async () => {
      await setSecret('jobs_secret', 'not-the-secret');
      const beat = await heartbeat();
      const before = await lastResponseId();
      await runCommand();
      const response = await responseAfter(before, 60_000);
      expect(response.status_code).toBe(401);
      expect(await heartbeat()).toEqual(beat);
    }, 90_000);

    it('runs on the pg_cron clock: net._http_response shows 200 from /functions/v1/jobs/run, and the heartbeat moves', async () => {
      await setSecret('jobs_secret', JOBS_SECRET);
      const current = (await job())!;
      const beat = await heartbeat();
      const before = await lastResponseId();
      const started = new Date();
      // The schedule runs every 2 seconds for this test only; afterAll puts back */15 also when the test fails.
      await db.query('select cron.alter_job($1, schedule => $2)', [current.jobid, '2 seconds']);
      let response: Response;
      try {
        response = await responseAfter(before, 120_000);
      } finally {
        await db.query('select cron.alter_job($1, schedule => $2)', [current.jobid, SCHEDULE]);
      }
      expect({ status: response.status_code, error: response.error_msg }).toEqual({ status: 200, error: null });
      const report = JSON.parse(response.content ?? '{}') as { ok?: boolean; steps?: unknown };
      expect(report.ok).toBe(true);
      const moved = await heartbeat();
      expect(moved).toBeDefined();
      expect(moved!.getTime()).toBeGreaterThanOrEqual(started.getTime() - 1000);
      if (beat) expect(moved!.getTime()).toBeGreaterThan(beat.getTime());
      const { rows } = await db.query<{ status: string }>(
        'select status from cron.job_run_details where jobid = $1 and start_time >= $2 order by start_time limit 1',
        [current.jobid, started],
      );
      expect(rows[0]?.status).toBe('succeeded');
      expect((await job())!.schedule).toBe(SCHEDULE);
    }, 150_000);
  });
});
