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
import { TICKET_REFUSE_MIN_MS, TICKET_REFUSED, TICKET_SHAPE } from '../office/live';
import { OFFICE_NAME_HEADER, REHEARSAL_NAME, testToolsOn, writesIn } from '../office/ops';
import { CRON_PATH, runFanout, selfTransport, type FanoutLeg, type FanoutTransport } from '../enterprise/fanout';
import { utcDay } from '../mail/quota';
import { firstRunOfDay } from '../office/jobs';
import { ENT_VADO, isEnterpriseId, untag, type EnterpriseId } from '../enterprise/ids';
import { RegisterBodyShape } from '../enterprise/shapes';
import { accountGate } from '../enterprise/accountGate';
import { logoResponse } from '../enterprise/logoRoute';
import { padTo } from '../enterprise/pad';
import { platformAuth } from '../enterprise/platform/auth';
import { platformRoute } from '../enterprise/platform/route';
import type { PlatformStub } from '../enterprise/platform/stub';
import { runInEnterprise } from '../enterprise/context';
import { entRouter, isMcpToolPath, mcpAddressOf, newListedCache, type EntRouter } from '../enterprise/router';
import { challengeOf } from '../mcp/metadata';
import { isPlatformBearer, type PlatformTokenChecker } from '../auth/verify';
import type { EnterpriseInit, EnterpriseLimits, EnterpriseState, EnterpriseStatus } from '../enterprise/types';
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

/**
 * names: any (the old name office, a rehearsal name, or a listed enterprise id), office (the old name or a listed enterprise id), rehearsal
 * (a rehearsal name only), none (an op of the platform object: it takes no ?office=).
 */
type OpRule = { secret: 'export' | 'ops'; names: 'any' | 'office' | 'rehearsal' | 'none' };

/** Each op, its secret and the object names it takes. export is the nightly GitHub job; the others run from the Mac. */
const OPS: Readonly<Record<string, OpRule>> = {
  export: { secret: 'export', names: 'any' },
  import: { secret: 'ops', names: 'any' },
  peek: { secret: 'ops', names: 'office' },
  drop: { secret: 'ops', names: 'rehearsal' },
  // The ids of the enterprises that the nightly backup must export (Madar enterprises). The export secret opens it, as it opens export.
  enterprises: { secret: 'export', names: 'none' },
  'platform-register': { secret: 'ops', names: 'none' },
};

/** The names that an op takes without the list of the platform. An enterprise id needs the list (listed). */
function nameAllowed(rule: OpRule['names'], name: string, listed: boolean): boolean {
  if (rule === 'none') return false;
  if (rule === 'rehearsal') return REHEARSAL_NAME.test(name);
  if (rule === 'office') return name === OFFICE_NAME || listed;
  return name === OFFICE_NAME || REHEARSAL_NAME.test(name) || listed;
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
  status(input: { ent: EnterpriseId }): Promise<EnterpriseStatus>;
  init(input: EnterpriseInit, net: NetApi): Promise<OpResult<{ adminUserId: string }>>;
  setState(input: { ent: EnterpriseId; state: EnterpriseState }): Promise<void>;
  setLimits(input: { ent: EnterpriseId; limits: EnterpriseLimits }): Promise<void>;
  setIdentity(input: { ent: EnterpriseId; name?: string; nameAr?: string; logo?: string | null }): Promise<void>;
  reinvite(input: { ent: EnterpriseId }, net: NetApi): Promise<OpResult<{ sentAt: string }>>;
  brand(input: { ent: EnterpriseId }): Promise<{ name: string; nameAr: string; logo: string | null }>;
  fetch(request: Request): Promise<Response>;
};

/**
 * What a route of the routes option gets for its request: the router that turns an enterprise id into an office object (the only way,
 * server/enterprise/router.ts), the platform object, a new network port, and the work after the answer.
 */
export type OfficeCall = { router: EntRouter; platform: PlatformStub; net: (ent: EnterpriseId) => NetApi; after?: After };
export type OfficeRoute = { method: 'GET' | 'POST'; path: string; handler: (request: Request, call: OfficeCall) => Promise<Response> };

export type OfficeRoutesOptions = {
  deps: Pick<Deps, 'config' | 'clock' | 'log'>;
  /** The token check. ent is the claim of an own-key token; a token with no claim (the Supabase key on an office copy) serves ENT_VADO. */
  verifyToken: (header: string | null) => Promise<{ authUserId: string; ent?: EnterpriseId }>;
  /**
   * The check of a platform token (plan F, design D10) for POST /api/platform and the platform sign-out. Default: refuses every token, so a
   * Worker that forgets it serves no platform call.
   */
  verifyPlatformToken?: PlatformTokenChecker;
  /** The office object of an enterprise, by its id (server/entries/officeEntry.ts names it with idFromName). Reach it through the router. */
  stubFor: (env: Env, ent: EnterpriseId) => OfficeStub;
  /** The one platform object. */
  platform: (env: Env) => PlatformStub;
  /**
   * A new network port for the object of one enterprise. The id comes from the Worker, never from the object: the file port works inside
   * its key folder (plan D), and the port carries the email directory of that enterprise (plan C).
   */
  net: (env: Env, ent: EnterpriseId) => NetApi;
  jobsSecret: () => string | undefined;
  /** More routes under /api (the own sign-in, server/entries/officeSignin.ts), as apiApp takes AppOptions.routes. */
  routes?: OfficeRoute[];
  /** The transport of the Cron legs. Default: selfTransport (the binding SELF, or the public API address when MADAR_CRON_TRANSPORT is api). */
  fanout?: (env: Env) => FanoutTransport;
  /** The timer of the minimum answer time of a refused ticket. Default: setTimeout. A test records the waits here. */
  sleep?: (ms: number) => Promise<void>;
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

/**
 * The 401 of an MCP request that names no enterprise: the words and the challenge that the MCP app gives a request with no token, or with a
 * token it cannot read. The address is the one the request named, so the challenge points at that address and tells a stranger nothing.
 */
function mcpUnauthorized(mcpUrl: string, tokenCame: boolean): Response {
  const message = tokenCame ? 'This access token is not for Madar\'s MCP server.' : 'Send the Madar access token in the Authorization header.';
  const challenge = challengeOf(mcpUrl, tokenCame ? { error: 'invalid_token', description: message } : {});
  return Response.json({ jsonrpc: '2.0', id: null, error: { code: 401, message } }, { status: 401, headers: { 'WWW-Authenticate': challenge } });
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
  // The list of enterprises and the resolved addresses live as long as the isolate, so most requests read no platform object.
  const listedCache = newListedCache();
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const routerOf = (env: Env): EntRouter => entRouter({ stubFor: (ent) => o.stubFor(env, ent), platform: o.platform(env), cache: listedCache });
  // The account gate (plan C): at 90 percent of a free day limit, every enterprise but ENT_VADO gets the busy answer. batch and mcp only.
  const accountCap = accountGate<Env>({ platform: o.platform, now: () => o.deps.clock.now() });
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
    let ent: EnterpriseId;
    try {
      checkBuild(request.headers.get('X-Madar-Build') ?? undefined, o.deps.config.minClientBuild);
      const parsed = parseBatch(await readBody(request));
      calls = parsed.request.calls;
      overviewCalls = parsed.overviewCalls;
      const checked = await o.verifyToken(request.headers.get('Authorization'));
      authUserId = checked.authUserId;
      // The claim of the signed token names the enterprise. No claim (the Postgres way back) is ENT_VADO.
      ent = checked.ent ?? ENT_VADO;
    } catch (error) {
      if (!(error instanceof ApiError)) log.error('The batch failed before its calls.', { error: error instanceof Error ? error.message : String(error) });
      return errorResponse(runErrorOf(error));
    }
    // The rest of the request runs for this enterprise: every log line gets its id (server/enterprise/context.ts). The work after the answer
    // starts inside the scope, so it keeps the id.
    return runInEnterprise(ent, async () => {
      const stopped = await accountCap(env, ent, writesIn(calls));
      if (stopped) return errorResponse(stopped);
      const net = o.net(env, ent);
      const stub = routerOf(env).stub(ent);
      let out: OfficeBatchOutput;
      try {
        out = await stub.batch({ ent, who: { kind: 'browser', authUserId }, calls, overviewCalls, worker: reported() }, net);
      } catch (error) {
        return errorResponse(officeErrorOf(error, log));
      }
      if (!out.ok) return errorResponse(out.error);
      if (out.later.length > 0) {
        const work = stub.runEffects({ ent, ids: out.later, worker: 0 }, net).catch((error: unknown) => {
          log.warn('The effects after the answer did not run. The job tries them again.', { error: error instanceof Error ? error.message : String(error) });
        });
        if (after) after(work);
        else await work;
      }
      return new Response(out.body, { headers: { 'content-type': 'application/json' } });
    });
  }

  /**
   * /mcp and every address under it (the merge of exit waves 2 and 3): the whole request goes to the office object in one call, which
   * runs the MCP app with the own token check, the agent check and the OAuth routes there. Its answer goes on as it is; the mails
   * and pushes of a tool call run after it, as for a batch.
   */
  async function mcp(request: Request, env: Env, after: After | undefined): Promise<Response> {
    // A platform token never works on the company MCP address (design D10). It is sent away here, before any address or object work.
    if (isPlatformBearer(request.headers.get('authorization'))) return mcpUnauthorized(o.deps.config.mcpUrl.replace(/\/+$/, ''), true);
    let body: string | null = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        body = await readBody(request);
      } catch {
        return mcpError(413, 'The request is too large.', 'too_large');
      }
    }
    // The enterprise of the request comes from the address (design 5.5): /mcp serves ENT_VADO, /mcp/<address> serves the enterprise that the
    // platform lists for that address. A bad or unknown address gets the 401 of a missing token and makes no object.
    const url = new URL(request.url);
    const base = o.deps.config.mcpUrl.replace(/\/+$/, '');
    const parsed = mcpAddressOf(url.pathname);
    const router = routerOf(env);
    const target = parsed === 'bad' ? null : parsed.address === null ? { ent: ENT_VADO, stub: router.stub(ENT_VADO) } : await router.addressStub(parsed.address);
    if (parsed === 'bad' || !target) {
      // The text of the app for a request with no token or a token it cannot read, so a listed and an unlisted address answer alike.
      const named = parsed !== 'bad' && parsed.address !== null ? `${base}/${parsed.address}` : base;
      return mcpUnauthorized(named, request.headers.has('authorization'));
    }
    const mcpUrl = parsed.address === null ? base : `${base}/${parsed.address}`;
    // The object routes the path without the address: the app serves /mcp, /mcp/oauth/... and /mcp/.well-known/....
    const forward = new URL(request.url);
    forward.pathname = parsed.rest;
    const headers = [...request.headers].filter(([name]) => !NOT_PASSED.has(name.toLowerCase()));
    const { ent } = target;
    // The rest of the request runs for this enterprise (log lines carry its id).
    return runInEnterprise(ent, async () => {
      // A tool call of MCP (the path /mcp) carries work; the OAuth routes under it do not (design 5.14).
      const stopped = await accountCap(env, ent, isMcpToolPath(parsed.rest));
      if (stopped) return mcpError(503, stopped.message, 'busy');
      const net = o.net(env, ent);
      let out: OfficeMcpAnswer;
      try {
        out = await target.stub.mcp({ ent, mcpUrl, url: forward.toString(), method: request.method, headers, body, worker: reported() }, net);
      } catch (error) {
        const refusal = officeErrorOf(error, log);
        return refusal.details?.reason === 'busy' ? mcpError(503, refusal.message, 'busy') : mcpError(500, 'Something went wrong. Try again.');
      }
      if (out.later.length > 0) {
        const work = target.stub.runEffects({ ent, ids: out.later, worker: 0 }, net).catch((error: unknown) => {
          log.warn('The effects after the answer did not run. The job tries them again.', { error: error instanceof Error ? error.message : String(error) });
        });
        if (after) after(work);
        else await work;
      }
      return new Response(out.body, { status: out.status, headers: out.headers });
    });
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
    if (op === 'enterprises') return enterpriseList(env);
    if (rule.names === 'none') return platformOp(request, env, op);
    // Without ?office= the op is for ENT_VADO. An enterprise id works only when the platform object lists it, so an op never makes an object.
    const name = new URL(request.url).searchParams.get('office') ?? ENT_VADO;
    const listed = isEnterpriseId(name) ? await routerOf(env).listedStub(name) : null;
    if (!nameAllowed(rule.names, name, listed !== null)) return errorResponse({ code: 'forbidden', message: 'This office name is not allowed for this op.' });
    const stub = listed?.stub ?? o.stubFor(env, name);
    try {
      return await stub.fetch(new Request(`https://office.internal/office/${op}`, {
        method: 'POST', headers: { 'content-type': 'application/json', [OFFICE_NAME_HEADER]: name }, body: request.body, duplex: 'half',
      } as RequestInit));
    } catch (error) {
      return errorResponse(officeErrorOf(error, log));
    }
  }

  /**
   * The op enterprises (Madar enterprises, design 5.15): the ids of the enterprises that the platform object lists (active and paused), so the
   * nightly backup exports each one. The answer holds ids only, no name and no address. It makes no office object.
   */
  async function enterpriseList(env: Env): Promise<Response> {
    try {
      const ids = (await o.platform(env).listed()).filter((id) => isEnterpriseId(id));
      return Response.json({ enterprises: [...new Set(ids)].sort() });
    } catch (error) {
      return errorResponse(officeErrorOf(error, log));
    }
  }

  /**
   * One Cron leg (Madar enterprises): the job of one enterprise in its object, then its status and its meter to the platform object. A
   * leg that throws (a paused object) still sends the status, which a paused object answers. The jobs secret opens the route.
   */
  async function cronLeg(request: Request, env: Env): Promise<Response> {
    const secret = o.jobsSecret();
    const given = request.headers.get(JOBS_SECRET_HEADER);
    if (request.method !== 'POST' || !secret || given === null || !(await sameSecret(given, secret))) {
      return errorResponse({ code: 'unauthenticated', message: 'The job secret is not right.' });
    }
    let body: { ent?: unknown; at?: unknown } = {};
    try {
      body = JSON.parse(await readBody(request)) as typeof body;
    } catch {
      return errorResponse({ code: 'invalid_input', message: 'A Cron leg needs { ent, at }.' });
    }
    const at = typeof body.at === 'string' ? new Date(body.at) : new Date(Number.NaN);
    if (Number.isNaN(at.getTime())) return errorResponse({ code: 'invalid_input', message: 'A Cron leg needs { ent, at }.' });
    const target = await routerOf(env).listedStub(body.ent);
    if (!target) return errorResponse({ code: 'not_found', message: 'This address does not exist.' });
    const platform = o.platform(env);
    const { ent, stub } = target;
    seen += 1;
    return runInEnterprise(ent, async () => {
      try {
        const report = await stub.cron({ ent, at: at.toISOString(), worker: reported() }, o.net(env, ent));
        log.info('The office jobs ran.', { ent, ok: report.ok, failed: report.steps.filter((step) => !step.ok).map((step) => step.name), closed: report.closed });
        await platform.report(report.status);
        await platform.meter({ ent, day: utcDay(at), counts: report.status.day });
        return Response.json({ ok: report.ok });
      } catch (error) {
        log.error('The office jobs did not run. The next run tries again.', { ent, error: error instanceof Error ? error.message : String(error) });
        // A paused object refuses the jobs but answers its status, so the platform page still shows it.
        try {
          await platform.report(await stub.status({ ent }));
        } catch (again) {
          log.warn('The status of an enterprise did not load.', { ent, error: again instanceof Error ? again.message : String(again) });
        }
        return errorResponse({ code: 'failed', message: 'Something went wrong. Try again.' });
      }
    });
  }

  /**
   * The ops of the platform object (Madar enterprises, with the ops secret): platform-register writes one enterprise row and its emails (an
   * upsert, any state). The body is checked with zod first.
   */
  async function platformOp(request: Request, env: Env, op: string): Promise<Response> {
    let value: unknown;
    try {
      value = JSON.parse(await readBody(request));
    } catch {
      return errorResponse(runErrorOf(new ApiError('invalid_input', 'The body of this op is one JSON object.')));
    }
    try {
      const platform = o.platform(env);
      if (op === 'platform-register') {
        const parsed = RegisterBodyShape.safeParse(value);
        if (!parsed.success) return errorResponse(runErrorOf(new ApiError('invalid_input', 'The body is { row, emails }, with an enterprise row.')));
        await platform.register(parsed.data);
        // This isolate reads the list again at its next lookup, so the import that follows finds the new enterprise at once. Another
        // isolate sees it after LISTED_MISS_MS at most.
        delete listedCache.list;
        listedCache.addresses.clear();
        return Response.json({ ok: true });
      }
      return errorResponse({ code: 'not_found', message: 'This address does not exist.' });
    } catch (error) {
      if (error instanceof ApiError || (error as { code?: unknown })?.code !== undefined) return errorResponse(runErrorOf(error));
      return errorResponse(officeErrorOf(error, log));
    }
  }

  /**
   * The socket (Madar enterprises): the ticket is <ent>.<secret>. The shape and the listed tag come first; a ticket that fails here, or in
   * the object, gets the one refusal after the same minimum time, and a failure here makes no object.
   */
  async function live(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('This address needs a WebSocket.', { status: 426 });
    const started = performance.now();
    const refused = async (): Promise<Response> => {
      await padTo(started, TICKET_REFUSE_MIN_MS, sleep);
      return errorResponse(TICKET_REFUSED);
    };
    const ticket = new URL(request.url).searchParams.get('ticket') ?? '';
    if (!TICKET_SHAPE.test(ticket)) return refused();
    const target = await routerOf(env).listedStub(untag(ticket)?.ent);
    if (!target) return refused();
    return runInEnterprise(target.ent, async () => {
      try {
        const response = await target.stub.fetch(request);
        return response.status === 401 ? await refused() : response;
      } catch (error) {
        return errorResponse(officeErrorOf(error, log));
      }
    });
  }

  async function health(request: Request, env: Env): Promise<Response> {
    const base = { ok: true, region: o.deps.config.region, host: 'office', calls: Object.keys(sharedCalls).length };
    const given = request.headers.get(JOBS_SECRET_HEADER);
    if (given === null) return Response.json(base);
    const secret = o.jobsSecret();
    if (!secret || !(await sameSecret(given, secret))) return errorResponse({ code: 'unauthenticated', message: 'The job secret is not right.' });
    try {
      // Only ENT_VADO, and only when the platform lists it: the health check reads no other enterprise.
      const vado = await routerOf(env).listedStub(ENT_VADO);
      return Response.json(vado ? { ...base, office: await vado.stub.health() } : base);
    } catch (error) {
      log.error('The office object failed its health check.', { error: error instanceof Error ? error.message : String(error) });
      return Response.json({ ...base, ok: false }, { status: 503 });
    }
  }

  /**
   * The probe routes of spike S1 (Madar enterprises): only with the test tools on and the jobs secret. The fan-out route sends
   * count legs through the transport; each leg makes plain outside calls to the health route of its own address and says how many worked.
   */
  async function probe(request: Request, env: Env, kind: 'fanout' | 'leg'): Promise<Response> {
    const read = (name: string): string | undefined => (typeof env[name] === 'string' ? (env[name] as string) : undefined);
    if (request.method !== 'POST' || !testToolsOn(read)) return errorResponse({ code: 'not_found', message: 'This address does not exist.' });
    const secret = o.jobsSecret();
    const given = request.headers.get(JOBS_SECRET_HEADER);
    if (!secret || given === null || !(await sameSecret(given, secret))) {
      return errorResponse({ code: 'unauthenticated', message: 'The job secret is not right.' });
    }
    const body = (await request.json().catch(() => ({}))) as { kind?: unknown; count?: unknown; outside?: unknown };
    const outside = Math.max(0, Math.min(45, Number(body.outside) || 0));
    if (kind === 'leg') {
      // The outside calls go to the health route of the Worker's own address, never to another copy (spike S1 once called production).
      const health = new URL('/api/health', request.url).toString();
      let worked = 0;
      for (let i = 0; i < outside; i += 1) {
        try {
          if ((await fetch(health)).ok) worked += 1;
        } catch {
          // A failed outside call counts as not worked.
        }
      }
      return Response.json({ outside, worked });
    }
    const count = Math.max(1, Math.min(30, Number(body.count) || 1));
    const ids = Array.from({ length: count }, (_, i) => `ent_9${String(i).padStart(2, '0')}`);
    const transport = selfTransport(env, {
      kind: body.kind === 'api' ? 'api' : 'self', secret, apiUrl: `${o.deps.config.appUrl.replace(/\/$/, '')}/api`,
      path: '/api/internal/probe/leg', extra: { outside },
    });
    return Response.json(await runFanout({ ids, at: o.deps.clock.now(), transport, log }));
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
  // The logo of an enterprise for the mail header: public, the same 404 for every miss (plan C, Task 16).
  app.get('/api/enterprise-logo/:ent', (c) => logoResponse(routerOf(c.env), c.req.param('ent')));
  app.all(CRON_PATH, (c) => cronLeg(c.req.raw, c.env));
  app.all('/api/internal/probe/fanout', (c) => probe(c.req.raw, c.env, 'fanout'));
  app.all('/api/internal/probe/leg', (c) => probe(c.req.raw, c.env, 'leg'));
  app.post('/api/batch', (c) => batch(c.req.raw, c.env, afterOf(c)));
  // The platform calls (plan C): the office path only. The route checks the token and the owner before it reads anything else.
  // The platform has its own accounts and tokens (plan F, design D8 and D10): its token has the audience madar-platform, and a company token
  // never works here. The sign-in routes of the platform sit under /api/platform/auth.
  const verifyPlatform: PlatformTokenChecker = o.verifyPlatformToken ?? (() => Promise.reject(new ApiError('unauthenticated', 'Sign in to continue.')));
  const platformCall = platformRoute({ deps: o.deps, verifyToken: verifyPlatform, stubFor: o.stubFor, platform: o.platform, net: o.net });
  const platformSignin = platformAuth({ deps: o.deps, platform: o.platform, verifyToken: verifyPlatform });
  app.post('/api/platform', (c) => platformCall(c.req.raw, c.env, afterOf(c)));
  app.all('/api/platform/auth/token', (c) => platformSignin.token(c.req.raw, c.env));
  app.all('/api/platform/auth/logout', (c) => platformSignin.logout(c.req.raw, c.env));
  for (const route of o.routes ?? []) {
    app.on(route.method, `/api${route.path}`, (c) => {
      const after = afterOf(c);
      return route.handler(c.req.raw, { router: routerOf(c.env), platform: o.platform(c.env), net: (ent) => o.net(c.env, ent), ...(after ? { after } : {}) });
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

    /**
     * One Cron run (Madar enterprises, design 5.13): read the list of enterprises, then send one leg for each through the transport. A leg is
     * one Worker call (cronLeg), so the job of each enterprise has its own budget of outside calls. The first run after 00:00 UTC also
     * sweeps the rate limits of the platform object. The log line names ids and counts only.
     */
    async scheduled(at: Date, env: Env): Promise<{ legs: FanoutLeg[] } | undefined> {
      seen += 1;
      const platform = o.platform(env);
      let ids: EnterpriseId[];
      try {
        // Only the active enterprises get a job: a paused one sends no mail and no push (design 5.8).
        ids = await platform.activeIds();
      } catch (error) {
        log.error('The list of enterprises did not load. The next run tries again.', { error: error instanceof Error ? error.message : String(error) });
        return undefined;
      }
      if (firstRunOfDay(at)) {
        await platform.sweep({ at: at.toISOString() }).catch((error: unknown) => {
          log.warn('The platform cleanup did not run.', { error: error instanceof Error ? error.message : String(error) });
        });
      }
      const secret = o.jobsSecret();
      let transport: FanoutTransport;
      try {
        if (o.fanout) transport = o.fanout(env);
        else if (secret) transport = selfTransport(env, { kind: env.MADAR_CRON_TRANSPORT === 'api' ? 'api' : 'self', secret, apiUrl: o.deps.config.apiUrl });
        else throw new Error('JOBS_SECRET is not set: the Cron legs need it.');
      } catch (error) {
        log.error('The Cron legs cannot start.', { error: error instanceof Error ? error.message : String(error) });
        return undefined;
      }
      const out = await runFanout({ ids, at, transport, log });
      log.info('The Cron legs ran.', { count: out.legs.length, failed: out.legs.filter((leg) => !leg.ok).map((leg) => leg.ent), ms: out.legs.map((leg) => leg.ms) });
      return out;
    },
  };
}
