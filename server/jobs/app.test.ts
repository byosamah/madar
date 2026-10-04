import { describe, expect, it } from 'vitest';
import { fakeDeps } from '../test/fakes/deps';
import { JOBS_SECRET_HEADER, jobsApp } from './app';
import type { JobReport } from './run';

/**
 * POST /jobs/run (plan 5.5; task N3.1): pg_cron calls it every 15 minutes with the jobs secret. The entries mount the app at
 * /jobs, so the app itself answers /run.
 */

const SECRET = 'made-up-jobs-secret';
const OK: JobReport = { ok: true, at: '2026-10-04T06:00:00.000Z', steps: [{ name: 'heartbeat', ok: true, result: {} }] };

function setup(o: { secret?: string; report?: JobReport } = {}) {
  const deps = fakeDeps();
  deps.clock.set('2026-10-04T06:00:00Z');
  const runs: string[] = [];
  const app = jobsApp(deps, {
    secret: () => ('secret' in o ? o.secret : SECRET),
    run: async (_deps, at) => {
      runs.push(at.toISOString());
      return o.report ?? OK;
    },
  });
  const post = (headers: Record<string, string> = { [JOBS_SECRET_HEADER]: SECRET }, path = '/run') =>
    app.fetch(new Request(`http://127.0.0.1${path}`, { method: 'POST', headers }));
  return { deps, runs, app, post };
}

describe('the job runner app (plan 5.5)', () => {
  it('refuses a request with no secret or a wrong secret with 401, and never runs the job', async () => {
    const { post, runs } = setup();
    const tries: Record<string, string>[] = [{}, { [JOBS_SECRET_HEADER]: 'guess' }, { [JOBS_SECRET_HEADER]: `${SECRET}x` }];
    for (const headers of tries) {
      const response = await post(headers);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ v: 1, error: { code: 'unauthenticated', message: 'The job secret is not right.' } });
    }
    expect(runs).toEqual([]);
  });

  it('refuses every request while JOBS_SECRET is not set, and logs why', async () => {
    const { post, runs, deps } = setup({ secret: undefined });
    expect((await post()).status).toBe(401);
    expect((await post({ [JOBS_SECRET_HEADER]: '' })).status).toBe(401);
    expect(runs).toEqual([]);
    expect(deps.logs).toContainEqual({ level: 'error', message: 'JOBS_SECRET is not set, so the job runner refuses every request.' });
  });

  it('runs the job once at the time of the clock for the right secret, answers 200 with the report, and counts one request', async () => {
    const { post, runs, deps } = setup();
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ v: 1, ...OK });
    expect(runs).toEqual(['2026-10-04T06:00:00.000Z']);
    expect(deps.meter.requests).toBe(1);
  });

  it('answers 500 with the report when a step failed, so the cron log shows it', async () => {
    const report: JobReport = { ok: false, at: OK.at, steps: [{ name: 'uploads', ok: false, error: 'The store is down.' }] };
    const { post } = setup({ report });
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ v: 1, ...report });
  });

  it('answers 404 for any other path or method', async () => {
    const { app, runs } = setup();
    const get = await app.fetch(new Request('http://127.0.0.1/run', { method: 'GET', headers: { [JOBS_SECRET_HEADER]: SECRET } }));
    const other = await app.fetch(new Request('http://127.0.0.1/other', { method: 'POST', headers: { [JOBS_SECRET_HEADER]: SECRET } }));
    for (const response of [get, other]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ v: 1, error: { code: 'not_found' } });
    }
    expect(runs).toEqual([]);
  });
});
