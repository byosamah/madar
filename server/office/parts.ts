import { Hono } from 'hono';
import { ApiError } from '../../src/api/errors';
import { consoleLogger, serverEnvFrom, type ReadEnv } from '../core/deps';
import { processOutbox } from '../core/effects';
import { CLIENT_ADDRESS_HEADER, createForgotRoute, FORGOT_PATH, sendReset } from '../auth/forgot';
import { signingKeysOf, type SigningKeys } from '../auth/own/keys';
import { liteAuthAdmin } from '../auth/own/liteAdmin';
import { localSigninOffice, runSigninOp, type OpInput, type OpResult, type SigninOpName } from '../auth/own/office';
import { OWN_AUTH_SECRET, ownIssuer, ownKeySet, ownPublicJwks } from '../auth/ownKeys';
import { createRenewRoute, RENEW_PATH, renewInvitation } from '../auth/renew';
import { runInHost } from '../core/after';
import type { Clock, Deps, Logger } from '../core/ports';
import { createRunCall, type RunCall } from '../core/runCall';
import type { CallEntry } from '../core/serverCallMap';
import type { OfficeSnapshot, Principal, RunError, RunResult } from '../core/types';
import { liteDb, type LiteDb } from '../data/lite/db';
import type { SqlHost } from '../data/lite/host';
import { readLiteOffice } from '../data/lite/office';
import { LITE_SCHEMA_VERSION } from '../data/lite/schema';
import { errorResponse, runErrorOf, statusOf } from '../http/errors';
import type { JobReport } from '../jobs/run';
import { outboxMailPort } from '../mail/outboxDriver';
import { utcDay } from '../mail/quota';
import { mcpApp } from '../mcp/app';
import { agentTokenChecker } from '../mcp/auth';
import { liteAgentOf } from '../mcp/oauth/agent';
import { mountOAuth } from '../mcp/oauth/routes';
import { stateKeyFrom } from '../mcp/reasons';
import { JOBS_LAST_RUN_SQL } from '../usage/meters';
import { checkDayLimits } from '../usage/warn';
import { EffectLedger, officeData, runOfficeBatch, runOfficeEntries, type OfficeBatchInput, type OfficeBatchOutput } from './batch';
import { runOfficeJobs } from './jobs';
import { LIVE_PING, LIVE_PONG, LIVE_STALE_MS, LiveTickets, acceptLive, closeOff, liveSignals, sweep, type LiveSocket, type Sockets } from './live';
import { DAY_ROW_LITE, OfficeMeter } from './meter';
import { netPorts, type NetApi } from './net';
import { EXPORT_TABLES, exportPage, exportStepOf, META_ROW_LITE, OfficeHold, peek, testToolsOn, writesIn, type ExportStep } from './ops';
import type { OfficeWho } from './who';

/**
 * The work of the office object (exit wave 3), apart from workerd: server/office/office.ts gives it the host of ctx.storage and
 * the sockets of the Hibernation API, and node tests give it node:sqlite and fake sockets. One Deps for each object call, with
 * the network port of that call, so the ports never outlive the RPC call whose stub they hold.
 */

export type OfficeHost = SqlHost & { readonly totals: { rowsRead: number; rowsWritten: number } };
export type OfficeEffectsInput = { ids: string[]; worker: number };
export type OfficeEffectsReport = { done: number; failed: number };
export type OfficeHealth = { schema: number; lastJob: string | null };
/** One Cron run: its time (ISO text) and the Worker requests since the last report. */
export type OfficeCronInput = { at: string; worker: number };
export type DayRow = { rows_read: number; rows_written: number; requests: number; calls: number; worker_requests: number };
/** One step of the own sign-in (exit wave 2): its name in SIGNIN_STEPS (server/auth/own/office.ts) and its input. */
export type OfficeSigninInput = { signin: string; input: unknown };
/**
 * The forgot and renew routes (exit wave 2) on the office path. mailRoute runs the shape check and the limits and answers at once,
 * with the value of the mail work (the email or the renew key); mailWork runs that work in a second call, after the answer of the
 * Worker, so the answer takes the same time for a known and an unknown email (server/office/signinRoutes.ts).
 */
export type OfficeMailRoute = 'forgot' | 'renew';
export type OfficeMailInput = { route: OfficeMailRoute; body: string; address: string };
export type OfficeMailAnswer = { status: number; body: string; work?: string };
export type OfficeMailWork = { route: OfficeMailRoute; value: string };
/**
 * One request of /mcp on the office path (the merge of exit waves 2 and 3), as plain data: the Worker sends it on as it came, and
 * the object runs the MCP app (server/mcp/app.ts) with the own token check, the agent check on SQLite and each tool call through
 * the batch path. later: the mails and pushes of a tool call, which the Worker runs after the answer (runEffects).
 */
export type OfficeMcpInput = { url: string; method: string; headers: [string, string][]; body: string | null; worker: number };
export type OfficeMcpAnswer = { status: number; headers: [string, string][]; body: string; later: string[] };
/** The report of the job, the sockets that the sweep closed, and the day row of the meters after the run. */
export type OfficeCronReport = JobReport & { closed: number; day: DayRow | null };

export type PartsInput = {
  host: OfficeHost;
  read: ReadEnv;
  sockets: Sockets;
  principal: (who: OfficeWho, office: OfficeSnapshot) => Principal;
  clock?: Clock;
  log?: Logger;
  calls?: ReadonlyMap<string, CallEntry>;
};

export type OfficeParts = {
  readonly db: LiteDb;
  readonly meter: OfficeMeter;
  readonly tickets: LiveTickets;
  /** The hold of an export or an import (exit wave 4, server/office/ops.ts): in memory, so a restart of the object ends it. */
  readonly hold: OfficeHold;
  depsFor(net: NetApi): Deps;
  batch(input: OfficeBatchInput, net: NetApi): Promise<OfficeBatchOutput>;
  runEffects(input: OfficeEffectsInput, net: NetApi): Promise<OfficeEffectsReport>;
  cron(input: OfficeCronInput, net: NetApi): Promise<OfficeCronReport>;
  signin(body: OfficeSigninInput): Promise<OpResult<unknown>>;
  mailRoute(input: OfficeMailInput, net: NetApi): Promise<OfficeMailAnswer>;
  mailWork(input: OfficeMailWork, net: NetApi): Promise<void>;
  mcp(input: OfficeMcpInput, net: NetApi): Promise<OfficeMcpAnswer>;
  socket(request: Request): Promise<Response>;
  message(socket: LiveSocket, message: string | ArrayBuffer): void;
  closed(socket: LiveSocket, code: number): void;
  health(): Promise<OfficeHealth>;
  /** One office op of the Worker (exit wave 4): /office/export and /office/peek, as JSON in and out. */
  ops(request: Request): Promise<Response>;
};

/** The office object does no network work, so no region hop of the MCP app (server/mcp/forward.ts) may run here. */
const NO_HOP = (() => Promise.reject(new Error('The office object does no network work: no MCP region hop runs here.'))) as unknown as typeof fetch;

/** A JSON-RPC refusal of the MCP address, in the shape of the MCP app. A reason goes into data, as the Worker writes it. */
function mcpRefusal(status: number, message: string, reason?: string): OfficeMcpAnswer {
  const error = { code: -32603, message, ...(reason ? { data: { reason } } : {}) };
  return { status, headers: [['content-type', 'application/json']], body: JSON.stringify({ jsonrpc: '2.0', id: null, error }), later: [] };
}

/** The answer of a forgot or renew route that the hold refuses: the shape and status of errorResponse (server/http/errors.ts). */
function mailRefusal(error: RunError): OfficeMailAnswer {
  return { status: statusOf(error), body: JSON.stringify({ v: 1, error }) };
}

const toolCallsIn = (body: string | null): number => {
  try {
    const value = JSON.parse(body ?? 'null') as unknown;
    return (Array.isArray(value) ? value : [value]).filter((m) => m && typeof m === 'object' && (m as { method?: unknown }).method === 'tools/call').length;
  } catch {
    return 0;
  }
};

/** The close codes that a server may not send back (1005, 1006, 1015): the object answers them with a normal close. */
const RESERVED_CLOSE = new Set([1005, 1006, 1015]);

export function officeParts(o: PartsInput): OfficeParts {
  // The office object holds the database, so the values of the Postgres pools are not read (serverEnvFrom, o.database).
  const values = serverEnvFrom(o.read, { database: { writeUrl: '', readUrl: '' } });
  const db = liteDb(o.host);
  const clock = o.clock ?? { now: () => new Date() };
  const log = o.log ?? consoleLogger();
  const meter = new OfficeMeter(o.host);
  const tickets = new LiveTickets();
  const hold = new OfficeHold();
  // The test tools (the peek route; the replace mode of the import, Task 10): MADAR_TEST_TOOLS = "on", never on production.
  const tools = testToolsOn(o.read);
  const staleMs = Number(o.read('MADAR_LIVE_STALE_MS') ?? LIVE_STALE_MS);
  const signals = liveSignals({ sockets: o.sockets, meter, log, now: () => clock.now(), staleMs });
  const ledgers = new WeakMap<Deps, EffectLedger>();
  const data = officeData({ meter, ledgerOf: (deps) => ledgers.get(deps) });
  const run = createRunCall({
    ...(o.calls ? { calls: o.calls } : {}),
    data,
    // runCall gives each committed effect to afterCommit (the object has no host "after"): the ledger keeps it for the batch.
    afterCommit: async (deps, ids) => ledgers.get(deps)?.committed(ids),
  });
  const office = () => db.tx('read', (q) => readLiteOffice(db, q));
  // The sign-in rows live in the object (exit wave 2): the effects of server/auth/invite.ts and server/auth/effects.ts run here,
  // and only their mail goes through the network port of the Worker.
  const authAdmin = liteAuthAdmin({ db, clock });
  // The keys of the own tokens, imported once for each value of the secret and always before a transaction of a step.
  let held: { text: string; keys: Promise<SigningKeys> } | undefined;
  const keysOf = (): Promise<SigningKeys> => {
    const text = o.read(OWN_AUTH_SECRET);
    if (text === undefined) return Promise.reject(new Error(`${OWN_AUTH_SECRET} is not set: the own sign-in of the office object needs it.`));
    if (held?.text !== text) {
      const keys = signingKeysOf(text, values.config.mcpUrl);
      held = { text, keys };
      keys.catch(() => {
        if (held?.keys === keys) held = undefined;
      });
    }
    return held.keys;
  };

  // The key of the reason questions of the MCP app (server/mcp/reasons.ts), from the server secret key, as on the Postgres path.
  let stateKey: Promise<Uint8Array> | undefined;
  const stateKeyOf = (): Promise<Uint8Array> => (stateKey ??= stateKeyFrom(values.secretKey));

  function depsFor(net: NetApi): Deps {
    const ports = netPorts(net, { guard: { open: () => db.isOpen(), now: () => clock.now() }, kind: values.config.fileStore, maxFileBytes: values.config.limits.maxFileBytes });
    const deps: Deps = {
      db,
      clock,
      files: ports.files,
      // MAIL_DRIVER=outbox (the test copy) writes the mail into mail_outbox of the object: no network, so no port.
      mail: values.mail.driver === 'outbox' ? outboxMailPort(db) : ports.mail,
      signal: signals,
      authAdmin,
      meter,
      config: values.config,
      log,
      pushFetch: ports.pushFetch,
      live: tickets,
    };
    ledgers.set(deps, new EffectLedger());
    return deps;
  }

  /** One step of an export: begin takes the hold, each page checks it, end gives the version back and ends it. */
  async function exportStep(step: ExportStep, now: Date) {
    const meta = async () => {
      const [row] = await db.statement<{ version: number; office_seq: number }>('read', META_ROW_LITE);
      return { version: Number(row.version), officeSeq: Number(row.office_seq) };
    };
    if (step.step === 'begin') {
      const id = hold.begin('export', now);
      return { id, schema: LITE_SCHEMA_VERSION, ...(await meta()), tables: [...EXPORT_TABLES], until: new Date(hold.active(now)!.until).toISOString() };
    }
    hold.check(step.id, now);
    if (step.step === 'page') return exportPage(db, step.table, step.after);
    const out = await meta();
    hold.end(step.id);
    return out;
  }

  /** The JSON body of an op, or invalid_input. */
  async function bodyOf(request: Request): Promise<Record<string, unknown>> {
    try {
      const value = (await request.json()) as unknown;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // The body is not JSON: the same refusal as a body of another shape.
    }
    throw new ApiError('invalid_input', 'The body of an office op is one JSON object.');
  }

  return {
    db,
    meter,
    tickets,
    hold,
    depsFor,
    async batch(input, net) {
      meter.request({ calls: input.calls.length, worker: input.worker });
      // An export refuses a batch with a write and serves a read batch; an import refuses every batch.
      const held = hold.refusal({ now: clock.now(), writes: writesIn(input.calls) });
      if (held) return { ok: false, error: held };
      const deps = depsFor(net);
      const out = await runOfficeBatch(deps, input, { run, data: data(deps), principal: o.principal, ledger: ledgers.get(deps)! });
      if (!out.ok) return out;
      if (out.officeChanged) closeOff(o.sockets, await office());
      return { ok: true, body: out.body, later: out.later };
    },
    async runEffects(input, net) {
      meter.request({ worker: input.worker });
      // An import writes every table: the outbox rows wait for the Cron. An export lets them run (outbox and mail are drift tables).
      if (hold.active(clock.now())?.kind === 'import') return { done: 0, failed: 0 };
      const result = await processOutbox(depsFor(net), input.ids);
      return { done: result.done.length, failed: result.failed.length };
    },
    async cron(input, net) {
      meter.request({ worker: input.worker });
      const at = new Date(input.at);
      if (hold.active(at)) {
        log.info('The office jobs wait: an export or an import holds the office.', { at: input.at });
        const closed = sweep(o.sockets, clock.now(), staleMs);
        return { ok: true, at: input.at, steps: [], closed, day: null };
      }
      // One Deps, so the whole run shares one network budget: one Cron run is one Worker invocation (50 subrequests on Free).
      const deps = depsFor(net);
      const report = await runOfficeJobs(deps, at);
      await db.tx('write', (q) => meter.flush(q, at));
      await checkDayLimits(deps, at).catch((error: unknown) => {
        log.warn('The day meters were not checked. The next run checks them.', { error: error instanceof Error ? error.message : String(error) });
      });
      const closed = sweep(o.sockets, clock.now(), staleMs);
      const [day] = await db.statement<DayRow>('read', DAY_ROW_LITE, [utcDay(at)]);
      return { ...report, closed, day: day ?? null };
    },
    async signin(body) {
      meter.request();
      // An export lets the sign-in steps run (their rows are drift tables of server/office/ops.ts); an import refuses them.
      const held = hold.refusal({ now: clock.now(), writes: false });
      if (held) return { ok: false, error: held };
      let keys: SigningKeys;
      try {
        keys = await keysOf();
      } catch (error) {
        log.error('The sign-in keys of the office object did not load.', { error: error instanceof Error ? error.message : String(error) });
        return { ok: false, error: runErrorOf(error) };
      }
      // runSigninOp answers a name that is not in SIGNIN_STEPS with not_found, so the cast gives no step that does not exist.
      return runSigninOp({ db, clock, log, config: values.config, keys }, body.signin as SigninOpName, body.input as OpInput<SigninOpName>);
    },
    async mailRoute(input, net) {
      meter.request();
      // The limits and the links of forgot and renew are drift tables: an export lets them run, an import refuses them.
      const held = hold.refusal({ now: clock.now(), writes: false });
      if (held) return mailRefusal(held);
      let work: string | undefined;
      const keep = async (value: string) => void (work = value);
      // No after on this host: the route waits for keep, which only notes the value. The Worker pads the answer to the minimum time.
      const host = () => ({ host: 'workers' as const });
      const route = input.route === 'forgot' ? createForgotRoute({ minMs: 0, host, work: keep }) : createRenewRoute({ minMs: 0, host, work: keep });
      const request = new Request(`https://office.internal/api${input.route === 'forgot' ? FORGOT_PATH : RENEW_PATH}`, {
        method: 'POST', headers: { 'content-type': 'application/json', [CLIENT_ADDRESS_HEADER]: input.address }, body: input.body,
      });
      const response = await runInHost({ host: 'workers' }, () => route(request, depsFor(net)));
      return { status: response.status, body: await response.text(), ...(work === undefined ? {} : { work }) };
    },
    async mailWork(input, net) {
      meter.request();
      if (hold.refusal({ now: clock.now(), writes: false })) {
        log.warn(input.route === 'forgot' ? 'A reset mail did not go out: an import holds the office.' : 'A renewed invitation did not go out: an import holds the office.');
        return;
      }
      const deps = depsFor(net);
      try {
        if (input.route === 'forgot') await sendReset(input.value, deps);
        else await renewInvitation(input.value, deps);
      } catch (error) {
        log.warn(input.route === 'forgot' ? 'A reset mail did not go out.' : 'A renewed invitation did not go out.', { error: error instanceof Error ? error.message : String(error) });
      }
    },
    async mcp(input, net) {
      meter.request({ calls: toolCallsIn(input.body), worker: input.worker });
      // An export lets the OAuth routes under /mcp run (their rows are drift tables); a request of /mcp itself may write, so it waits.
      const path = new URL(input.url).pathname;
      const held = hold.refusal({ now: clock.now(), writes: path === '/mcp' || path === '/mcp/' });
      if (held) return mcpRefusal(503, held.message, 'busy');
      const secret = o.read(OWN_AUTH_SECRET);
      let keys: SigningKeys;
      try {
        if (secret === undefined) throw new Error(`${OWN_AUTH_SECRET} is not set: MCP on the office path needs the own sign-in.`);
        keys = await keysOf();
      } catch (error) {
        log.error('The MCP address of the office object is off.', { error: error instanceof Error ? error.message : String(error) });
        return mcpRefusal(503, 'The MCP server of this copy is not set up yet.');
      }
      const deps = depsFor(net);
      const mcpUrl = values.config.mcpUrl;
      const issuer = ownIssuer(mcpUrl);
      const later: string[] = [];
      let officeChanged = false;
      // Each tool call is a batch of one entry on the batch path of the object: the agent who, its effects and the office flag.
      const toolRun: RunCall = async (_deps, req): Promise<RunResult> => {
        let principal: Principal;
        try {
          principal = o.principal({ kind: 'agent', agentUserId: req.principal.userId, clientId: req.principal.agent?.clientId ?? '' }, req.batch.office ?? await office());
        } catch (error) {
          return { ok: false, error: runErrorOf(error) };
        }
        const out = await runOfficeEntries(deps, {
          run, ledger: ledgers.get(deps)!, principal, batch: req.batch, calls: [{ name: req.name, input: req.input, story: req.story, key: req.key }],
        });
        later.push(...out.later);
        if (out.officeChanged) officeChanged = true;
        return out.results[0];
      };
      const app = mcpApp(deps, {
        issuer,
        checkToken: agentTokenChecker({ issuer, audience: mcpUrl, jwks: ownKeySet(secret) }),
        agentOf: liteAgentOf,
        runCall: toolRun,
        readOffice: () => office(),
        stateKey: await stateKeyOf(),
        fetch: NO_HOP,
        oauth: (routes) => mountOAuth(routes, localSigninOffice({ db, clock, log, config: values.config, keys }), { mcpUrl, jwks: ownPublicJwks(secret) }),
      });
      const root = new Hono();
      root.route('/mcp', app);
      const request = new Request(input.url, { method: input.method, headers: input.headers, ...(input.body === null ? {} : { body: input.body }) });
      // The Workers host: the OAuth routes read the address that the Pages Function wrote (clientAddress).
      const response = await runInHost({ host: 'workers' }, () => root.fetch(request));
      if (officeChanged) closeOff(o.sockets, await office());
      return { status: response.status, headers: [...response.headers], body: await response.text(), later };
    },
    async socket(request) {
      meter.request();
      return acceptLive({ sockets: o.sockets, tickets, office, now: () => clock.now() }, request);
    },
    message(socket, message) {
      // The runtime answers "ping" itself (setWebSocketAutoResponse). This covers a ping that reaches the object while it is awake.
      if (message === LIVE_PING) socket.send(LIVE_PONG);
    },
    closed(socket, code) {
      try {
        socket.close(RESERVED_CLOSE.has(code) ? 1000 : code, 'Closed.');
      } catch {
        // The socket is closed already.
      }
    },
    async health() {
      meter.request();
      const [row] = await db.statement<{ done_at: string }>('read', JOBS_LAST_RUN_SQL);
      return { schema: LITE_SCHEMA_VERSION, lastJob: row?.done_at ?? null };
    },
    async ops(request) {
      meter.request();
      const now = clock.now();
      try {
        const path = new URL(request.url).pathname;
        if (path === '/office/export') return Response.json(await exportStep(exportStepOf(await bodyOf(request)), now));
        if (path === '/office/peek') {
          if (!tools) throw new ApiError('forbidden', 'The test reads are off on this copy.');
          const body = await bodyOf(request);
          return Response.json(await peek(db, String(body.text ?? ''), Array.isArray(body.values) ? body.values : []));
        }
        throw new ApiError('not_found', 'This office op does not exist.');
      } catch (error) {
        if (!(error instanceof ApiError)) log.error('An office op failed.', { error: error instanceof Error ? error.message : String(error) });
        return errorResponse(runErrorOf(error));
      }
    },
  };
}
