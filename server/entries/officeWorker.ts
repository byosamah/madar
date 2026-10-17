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
import { OFFICE_NAME_HEADER, REHEARSAL_NAME } from '../office/ops';
import type { NetApi } from '../office/net';
import type { OpResult } from '../auth/own/office';
import { runInHost } from '../core/after';
import type {
  OfficeCronInput, OfficeCronReport, OfficeEffectsInput, OfficeEffectsReport, OfficeHealth, OfficeMailAnswer, OfficeMailInput, OfficeMailWork,
  OfficeMcpAnswer, OfficeMcpInput, OfficeSigninInput,
} from '../office/parts';

/**
 * The Worker side of the office path (exit wave 3). The Worker checks the build, the body and the token (the CPU-light part, 10 ms
 * on Free), then gives the whole batch to the office object in one RPC call with its network port (server/office/workerNet.ts),
 * and sends the JSON text of the answer on as it is. The mails and pushes of the batch run after the answer, in one more object
 * call with the same port. The socket route checks only the upgrade and the shape of the ticket; the object checks the ticket.
 * /mcp goes to the object in one call too (the merge of exit waves 2 and 3), and the routes option adds the own sign-in under /api.
 * Every request counts on the meter: the count goes with the next object call (worker).
 */

export const LIVE_PATH = '/api/live';

/** The routes of the office ops (exit wave 4): export, import, peek and drop, each behind its secret header. */
export const OFFICE_OPS_PREFIX = '/api/office/';

/** The name of the one office object of a copy (server/entries/officeEntry.ts names its stub with it). */
export const OFFICE_NAME = 'office';

/** The secret header of the nightly export of GitHub (MADAR_EXPORT_SECRET) and of the other ops from the Mac (MADAR_OPS_SECRET). */
export const EXPORT_SECRET_HEADER = 'x-madar-export-secret';
export const OPS_SECRET_HEADER = 'x-madar-ops-secret';

type OpRule = { secret: 'export' | 'ops'; names: 'any' | 'office' | 'rehearsal' };

/** Each op, its secret and the object names it takes. export is the nightly GitHub job; the others run from the Mac. */
const OPS: Readonly<Record<string, OpRule>> = {
  export: { secret: 'export', names: 'any' },
  import: { secret: 'ops', names: 'any' },
  peek: { secret: 'ops', names: 'office' },
  drop: { secret: 'ops', names: 'rehearsal' },
};

function nameAllowed(rule: OpRule['names'], name: string): boolean {
  if (rule === 'office') return name === OFFICE_NAME;
  if (rule === 'rehearsal') return REHEARSAL_NAME.test(name);
  return name === OFFICE_NAME || REHEARSAL_NAME.test(name);
}

/** True when the env has the office binding OFFICE (the test Worker from wave 3; production from wave 6). */
export function hasOfficeBinding(env: Record<string, unknown>): boolean {
  const namespace = env.OFFICE as { idFromName?: unknown; get?: unknown } | undefined;
  return typeof namespace?.idFromName === 'function' && typeof namespace.get === 'function';
}

/**
 * True when the office path serves this request: every path with MADAR_DATA = "office", and the office ops whenever the binding
 * exists, so the import of wave 5 reaches the object before the word of the copy changes.
 */
export function servesOffice(env: Record<string, unknown>, pathname: string): boolean {
  if (!hasOfficeBinding(env)) return false;
  return env.MADAR_DATA === 'office' || pathname.startsWith(OFFICE_OPS_PREFIX);
}

type Env = Record<string, unknown>;
type After = (work: Promise<unknown>) => void;
type Ctx = { waitUntil(work: Promise<unknown>): void; passThroughOnException?: () => void };

/** The RPC methods of the office object that the Worker calls (server/office/office.ts). */
export type OfficeStub = {
  batch(input: OfficeBatchInput, net: NetApi): Promise<OfficeBatchOutput>;
  runEffects(input: OfficeEffectsInput, net: NetApi): Promise<OfficeEffectsReport>;
  cron(input: OfficeCronInput, net: NetApi): Promise<OfficeCronReport>;
  signin(body: OfficeSigninInput): Promise<OpResult<unknown>>;
  mailRoute(input: OfficeMailInput, net: NetApi): Promise<OfficeMailAnswer>;
  mailWork(input: OfficeMailWork, net: NetApi): Promise<void>;
  mcp(input: OfficeMcpInput, net: NetApi): Promise<OfficeMcpAnswer>;
  health(): Promise<OfficeHealth>;
  fetch(request: Request): Promise<Response>;
};

/** What a route of the routes option gets for its request: the office object, a new network port, and the work after the answer. */
export type OfficeCall = { stub: OfficeStub; net: () => NetApi; after?: After };
export type OfficeRoute = { method: 'GET' | 'POST'; path: string; handler: (request: Request, call: OfficeCall) => Promise<Response> };

export type OfficeRoutesOptions = {
  deps: Pick<Deps, 'config' | 'clock' | 'log'>;
  verifyToken: (header: string | null) => Promise<{ authUserId: string }>;
  stub: (env: Env) => OfficeStub;
  net: () => NetApi;
  jobsSecret: () => string | undefined;
  /** More routes under /api (the own sign-in, server/entries/officeSignin.ts), as apiApp takes AppOptions.routes. */
  routes?: OfficeRoute[];
  /** The object of an op by its name (the office of the copy, or a spare object of the rehearsal). Default: stub, for "office". */
  stubOf?: (env: Env, name: string) => Pick<OfficeStub, 'fetch'>;
  /** MADAR_EXPORT_SECRET: the nightly export of GitHub. */
  exportSecret?: () => string | undefined;
  /** MADAR_OPS_SECRET: the import, the peek and the drop from the Mac. */
  opsSecret?: () => string | undefined;
};

const BUSY = new ApiError('failed', 'The office is busy. Try again in a moment.', { reason: 'busy' });

/** The headers that the Worker does not pass on to the office object: the object makes its own Request from the text body. */
const NOT_PASSED = new Set(['host', 'content-length', 'connection', 'transfer-encoding']);

/** A JSON-RPC refusal in the shape of the MCP app (server/mcp/app.ts). */
function mcpError(status: number, message: string, reason?: string): Response {
  return Response.json({ jsonrpc: '2.0', id: null, error: { code: status, message, ...(reason ? { data: { reason } } : {}) } }, { status });
}

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

  /**
   * /mcp and every address under it (the merge of exit waves 2 and 3): the whole request goes to the office object in one call, which
   * runs the MCP app with the own token check, the agent check and the OAuth routes there. Its answer goes on as it is; the mails
   * and pushes of a tool call run after it, as for a batch.
   */
  async function mcp(request: Request, env: Env, after: After | undefined): Promise<Response> {
    let body: string | null = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        body = await readBody(request);
      } catch {
        return mcpError(413, 'The request is too large.', 'too_large');
      }
    }
    const headers = [...request.headers].filter(([name]) => !NOT_PASSED.has(name.toLowerCase()));
    const net = o.net();
    let out: OfficeMcpAnswer;
    try {
      out = await o.stub(env).mcp({ url: request.url, method: request.method, headers, body, worker: reported() }, net);
    } catch (error) {
      const refusal = officeErrorOf(error, log);
      return refusal.details?.reason === 'busy' ? mcpError(503, refusal.message, 'busy') : mcpError(500, 'Something went wrong. Try again.');
    }
    if (out.later.length > 0) {
      const work = o.stub(env).runEffects({ ids: out.later, worker: 0 }, net).catch((error: unknown) => {
        log.warn('The effects after the answer did not run. The job tries them again.', { error: error instanceof Error ? error.message : String(error) });
      });
      if (after) after(work);
      else await work;
    }
    return new Response(out.body, { status: out.status, headers: out.headers });
  }

  /**
   * One office op (exit wave 4): the secret first, then the object name, then the body goes on to the object as a stream (no parse
   * here, so a page of 4 MB costs the Worker no CPU). The ops are server to server: no CORS, and a browser token is not enough.
   */
  async function ops(request: Request, env: Env, op: string): Promise<Response> {
    const rule = Object.hasOwn(OPS, op) ? OPS[op] : undefined;
    if (!rule || request.method !== 'POST') return errorResponse({ code: 'not_found', message: 'This address does not exist.' });
    const secret = rule.secret === 'export' ? o.exportSecret?.() : o.opsSecret?.();
    const given = request.headers.get(rule.secret === 'export' ? EXPORT_SECRET_HEADER : OPS_SECRET_HEADER);
    if (!secret || given === null || !(await sameSecret(given, secret))) {
      return errorResponse({ code: 'unauthenticated', message: 'The secret of this address is not right.' });
    }
    const name = new URL(request.url).searchParams.get('office') ?? OFFICE_NAME;
    if (!nameAllowed(rule.names, name)) return errorResponse({ code: 'forbidden', message: 'This office name is not allowed for this op.' });
    const stub = o.stubOf ? o.stubOf(env, name) : o.stub(env);
    try {
      return await stub.fetch(new Request(`https://office.internal/office/${op}`, {
        method: 'POST', headers: { 'content-type': 'application/json', [OFFICE_NAME_HEADER]: name }, body: request.body, duplex: 'half',
      } as RequestInit));
    } catch (error) {
      return errorResponse(officeErrorOf(error, log));
    }
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
  // CORS for the page api only. The MCP app checks the Origin itself, as on the Postgres path (server/mcp/app.ts).
  app.use('/api/*', cors(() => o.deps.config.allowedOrigins));
  app.all('/mcp', (c) => mcp(c.req.raw, c.env, afterOf(c)));
  app.all('/mcp/*', (c) => mcp(c.req.raw, c.env, afterOf(c)));
  app.get('/api/health', (c) => health(c.req.raw, c.env));
  app.post('/api/batch', (c) => batch(c.req.raw, c.env, afterOf(c)));
  for (const route of o.routes ?? []) {
    app.on(route.method, `/api${route.path}`, (c) => {
      const after = afterOf(c);
      return route.handler(c.req.raw, { stub: o.stub(c.env), net: o.net, ...(after ? { after } : {}) });
    });
  }
  app.notFound(() => errorResponse({ code: 'not_found', message: 'This address does not exist.' }));
  app.onError((error) => {
    if (!(error instanceof ApiError)) log.error('A route failed.', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse(runErrorOf(error));
  });

  return {
    async fetch(request: Request, env: Env, ctx?: Ctx): Promise<Response> {
      seen += 1;
      const path = new URL(request.url).pathname;
      if (path === LIVE_PATH) return live(request, env);
      if (path.startsWith(OFFICE_OPS_PREFIX)) return ops(request, env, path.slice(OFFICE_OPS_PREFIX.length));
      // The Workers host, as the Postgres Worker sets it (server/entries/worker.ts): clientAddress reads the address that the
      // Pages Function wrote.
      return runInHost({ host: 'workers', ...(ctx ? { after: (work: Promise<unknown>) => ctx.waitUntil(work) } : {}) }, () =>
        app.fetch(request, env, ctx as Parameters<typeof app.fetch>[2]));
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
