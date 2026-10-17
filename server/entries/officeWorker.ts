import { Hono, type Context } from 'hono';
import { ApiError } from '../../src/api/errors';
import { sharedCalls } from '../../src/api/sharedCalls';
import type { Deps } from '../core/ports';
import type { RunError } from '../core/types';
import { cors } from '../http/cors';
import { errorResponse, runErrorOf } from '../http/errors';
import { checkBuild, parseBatch, readBody } from '../http/limits';
import { JOBS_SECRET_HEADER, sameSecret } from '../jobs/app';
import type { OfficeBatchInput, OfficeBatchOutput } from '../office/batch';
import { TICKET_REFUSED, TICKET_SHAPE } from '../office/live';
import type { NetApi } from '../office/net';
import type { OfficeCronInput, OfficeCronReport, OfficeEffectsInput, OfficeEffectsReport, OfficeHealth } from '../office/parts';

/**
 * The Worker side of the office path (exit wave 3). The Worker checks the build, the body and the token (the CPU-light part, 10 ms
 * on Free), then gives the whole batch to the office object in one RPC call with its network port (server/office/workerNet.ts),
 * and sends the JSON text of the answer on as it is. The mails and pushes of the batch run after the answer, in one more object
 * call with the same port. The socket route checks only the upgrade and the shape of the ticket; the object checks the ticket.
 * Every request counts on the meter: the count goes with the next object call (worker).
 */

export const LIVE_PATH = '/api/live';

type Env = Record<string, unknown>;
type After = (work: Promise<unknown>) => void;
type Ctx = { waitUntil(work: Promise<unknown>): void; passThroughOnException?: () => void };

/** The RPC methods of the office object that the Worker calls (server/office/office.ts). */
export type OfficeStub = {
  batch(input: OfficeBatchInput, net: NetApi): Promise<OfficeBatchOutput>;
  runEffects(input: OfficeEffectsInput, net: NetApi): Promise<OfficeEffectsReport>;
  cron(input: OfficeCronInput, net: NetApi): Promise<OfficeCronReport>;
  health(): Promise<OfficeHealth>;
  fetch(request: Request): Promise<Response>;
};

export type OfficeRoutesOptions = {
  deps: Pick<Deps, 'config' | 'clock' | 'log'>;
  verifyToken: (header: string | null) => Promise<{ authUserId: string }>;
  stub: (env: Env) => OfficeStub;
  net: () => NetApi;
  jobsSecret: () => string | undefined;
};

const BUSY = new ApiError('failed', 'The office is busy. Try again in a moment.', { reason: 'busy' });

/** The refusal of an office object call that threw: busy when Cloudflare marks the error overloaded or retryable. */
export function officeErrorOf(error: unknown, log: Deps['log']): RunError {
  const marks = error as { overloaded?: unknown; retryable?: unknown } | null;
  if (marks !== null && typeof marks === 'object' && (marks.overloaded === true || marks.retryable === true)) return runErrorOf(BUSY);
  log.error('The office object failed.', { error: error instanceof Error ? error.message : String(error) });
  return runErrorOf(error);
}

export function officeRoutes(o: OfficeRoutesOptions) {
  const { log } = o.deps;
  let seen = 0;
  const reported = (): number => {
    const n = seen;
    seen = 0;
    return n;
  };

  async function batch(request: Request, env: Env, after: After | undefined): Promise<Response> {
    let calls: OfficeBatchInput['calls'];
    let overviewCalls: number;
    let authUserId: string;
    try {
      checkBuild(request.headers.get('X-Madar-Build') ?? undefined, o.deps.config.minClientBuild);
      const parsed = parseBatch(await readBody(request));
      calls = parsed.request.calls;
      overviewCalls = parsed.overviewCalls;
      ({ authUserId } = await o.verifyToken(request.headers.get('Authorization')));
    } catch (error) {
      if (!(error instanceof ApiError)) log.error('The batch failed before its calls.', { error: error instanceof Error ? error.message : String(error) });
      return errorResponse(runErrorOf(error));
    }
    const net = o.net();
    let out: OfficeBatchOutput;
    try {
      out = await o.stub(env).batch({ who: { kind: 'browser', authUserId }, calls, overviewCalls, worker: reported() }, net);
    } catch (error) {
      return errorResponse(officeErrorOf(error, log));
    }
    if (!out.ok) return errorResponse(out.error);
    if (out.later.length > 0) {
      const work = o.stub(env).runEffects({ ids: out.later, worker: 0 }, net).catch((error: unknown) => {
        log.warn('The effects after the answer did not run. The job tries them again.', { error: error instanceof Error ? error.message : String(error) });
      });
      if (after) after(work);
      else await work;
    }
    return new Response(out.body, { headers: { 'content-type': 'application/json' } });
  }

  async function live(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('This address needs a WebSocket.', { status: 426 });
    if (!TICKET_SHAPE.test(new URL(request.url).searchParams.get('ticket') ?? '')) return errorResponse(TICKET_REFUSED);
    try {
      return await o.stub(env).fetch(request);
    } catch (error) {
      return errorResponse(officeErrorOf(error, log));
    }
  }

  async function health(request: Request, env: Env): Promise<Response> {
    const base = { ok: true, region: o.deps.config.region, host: 'office', calls: Object.keys(sharedCalls).length };
    const given = request.headers.get(JOBS_SECRET_HEADER);
    if (given === null) return Response.json(base);
    const secret = o.jobsSecret();
    if (!secret || !(await sameSecret(given, secret))) return errorResponse({ code: 'unauthenticated', message: 'The job secret is not right.' });
    try {
      return Response.json({ ...base, office: await o.stub(env).health() });
    } catch (error) {
      log.error('The office object failed its health check.', { error: error instanceof Error ? error.message : String(error) });
      return Response.json({ ...base, ok: false }, { status: 503 });
    }
  }

  const afterOf = (c: Context): After | undefined => {
    try {
      const ctx = c.executionCtx;
      return (work) => ctx.waitUntil(work);
    } catch {
      return undefined;
    }
  };

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', cors(() => o.deps.config.allowedOrigins));
  app.get('/api/health', (c) => health(c.req.raw, c.env));
  app.post('/api/batch', (c) => batch(c.req.raw, c.env, afterOf(c)));
  app.notFound(() => errorResponse({ code: 'not_found', message: 'This address does not exist.' }));
  app.onError((error) => {
    if (!(error instanceof ApiError)) log.error('A route failed.', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse(runErrorOf(error));
  });

  return {
    async fetch(request: Request, env: Env, ctx?: Ctx): Promise<Response> {
      seen += 1;
      if (new URL(request.url).pathname === LIVE_PATH) return live(request, env);
      return app.fetch(request, env, ctx as Parameters<typeof app.fetch>[2]);
    },

    /** One Cron run: the whole job in one office object call. The report goes to the log, where wave 5 reads the day meters. */
    async scheduled(at: Date, env: Env): Promise<OfficeCronReport | undefined> {
      seen += 1;
      try {
        const report = await o.stub(env).cron({ at: at.toISOString(), worker: reported() }, o.net());
        log.info('The office jobs ran.', { ok: report.ok, failed: report.steps.filter((step) => !step.ok).map((step) => step.name), closed: report.closed, day: report.day });
        return report;
      } catch (error) {
        log.error('The office jobs did not run. The next run tries again.', { error: error instanceof Error ? error.message : String(error) });
        return undefined;
      }
    },
  };
}
