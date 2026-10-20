import { Hono } from 'hono';
import type { Deps } from '../core/ports';
import { env } from '../env';
import { runJob, type JobReport } from './run';

/**
 * POST /jobs/run: the 15-minute job (plan 5.5; task N3.1). The entries mount this app at /jobs (server/entries/jobs.ts), so the
 * function path is /functions/v1/jobs/run on Supabase and /jobs/run on Workers. pg_cron calls it with the header
 * x-madar-jobs-secret (track N3.2).
 *
 * - The secret is JOBS_SECRET, read with each request, so a secret set after the deploy works without a new deploy. The check
 *   runs in constant time. A missing or wrong secret gets 401, and so does every request while JOBS_SECRET is not set.
 * - The answer is 200 with the report of each step when every step passed, else 500 with the same report, so the cron log
 *   (net._http_response) shows a failed run. The report holds counts and error messages, never a payload or a secret.
 */

export const JOBS_SECRET_HEADER = 'x-madar-jobs-secret';

export type JobsAppOptions = {
  /** The secret of the job runner. The default reads JOBS_SECRET. */
  secret?: () => string | undefined;
  /** The job. Tests pass their own. */
  run?: (deps: Deps, at: Date) => Promise<JobReport>;
};

/** Compares two secrets in constant time: both go through SHA-256 first, so the length of the secret does not show either. */
export async function sameSecret(given: string, secret: string): Promise<boolean> {
  const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const [a, b] = await Promise.all([digest(given), digest(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

const UNAUTHENTICATED = { v: 1, error: { code: 'unauthenticated', message: 'The job secret is not right.' } } as const;
const NOT_FOUND = { v: 1, error: { code: 'not_found', message: 'This address does not exist.' } } as const;

export function jobsApp(deps: Deps, o: JobsAppOptions = {}): Hono {
  const secretOf = o.secret ?? (() => env('JOBS_SECRET'));
  const run = o.run ?? ((d: Deps, at: Date) => runJob(d, at));
  const app = new Hono();

  app.post('/run', async (c) => {
    const secret = secretOf();
    if (secret === undefined || secret === '') {
      deps.log.error('JOBS_SECRET is not set, so the job runner refuses every request.');
      return c.json(UNAUTHENTICATED, 401);
    }
    const given = c.req.header(JOBS_SECRET_HEADER);
    if (given === undefined || !(await sameSecret(given, secret))) return c.json(UNAUTHENTICATED, 401);

    const report = await run(deps, deps.clock.now());
    return c.json({ v: 1, ...report }, report.ok ? 200 : 500);
  });

  app.all('*', (c) => c.json(NOT_FOUND, 404));
  return app;
}
