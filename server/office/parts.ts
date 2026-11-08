import { Hono } from 'hono';
import { ApiError } from '../../src/api/errors';
import { consoleLogger, serverEnvFrom, type ReadEnv } from '../core/deps';
import { processOutbox } from '../core/effects';
import { sendReset } from '../auth/forgot';
import { signingKeysOf, type SigningKeys } from '../auth/own/keys';
import { liteAuthAdmin } from '../auth/own/liteAdmin';
import { sessionEnded } from '../auth/own/sessions';
import { localSigninOffice, runSigninOp, type OpInput, type OpResult, type SigninOpName } from '../auth/own/office';
import { OWN_AUTH_SECRET, ownIssuer, ownKeySet, ownPublicJwks } from '../auth/ownKeys';
import { renewInvitation } from '../auth/renew';
import { runInHost } from '../core/after';
import type { Clock, Deps, Logger } from '../core/ports';
import { createRunCall, type RunCall } from '../core/runCall';
import { DAFTRA_INTERNAL_CALLS } from '../daftra/paidCall';
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
import { agentTokenChecker, signInAgain } from '../mcp/auth';
import { liteAgentOf } from '../mcp/oauth/agent';
import { mountOAuth } from '../mcp/oauth/routes';
import { stateKeyFrom } from '../mcp/reasons';
import { JOBS_LAST_RUN_SQL } from '../jobs/steps/heartbeat';
import { capRefusal, COMPANY_BUSY, DAY_CAP_TTL_MS, dayCapOf } from './cap';
import { EffectLedger, officeData, runOfficeBatch, runOfficeEntries, type OfficeBatchInput, type OfficeBatchOutput } from './batch';
import { runOfficeJobs } from './jobs';
import { LIVE_PING, LIVE_PONG, LIVE_STALE_MS, LiveTickets, TICKET_REFUSED, acceptLive, closeOff, liveSignals, sweep, type LiveSocket, type Sockets } from './live';
import { DAY_ROW_LITE, OfficeMeter } from './meter';
import { brandOfSettings } from '../enterprise/brand';
import { EnterpriseFacts } from '../enterprise/facts';
import { EnterpriseGate } from '../enterprise/gate';
import { entLogger } from '../enterprise/context';
import { FREE_LIMITS, planFrom, shareCapOf } from '../enterprise/plan';
import { isMcpToolPath } from '../enterprise/router';
import { initEnterprise, reinviteAdmin, writeIdentity, writeLimits, writePlatformOwners, writeState } from '../enterprise/lifecycle';
import { runMailRoute } from '../enterprise/mailRoute';
import { ENT_VADO, isEnterpriseId, type EnterpriseId } from '../enterprise/ids';
import { enterpriseStatusOf } from '../enterprise/status';
import type { EnterpriseInit, EnterpriseLimits, EnterpriseState, EnterpriseStatus } from '../enterprise/types';
import { officeTyping, socketClosed, stateMessage } from './presence';
import { importBegin, importFinish, importPart, importStepOf, type ImportStep } from './import';
import { netPorts, type NetApi } from './net';
import { EXPORT_TABLES, exportPage, exportStepOf, META_ROW_LITE, OFFICE_NAME_HEADER, OfficeHold, peek, testToolsOn, writesIn, type ExportStep } from './ops';
import type { OfficeWho } from './who';

/**
 * The work of the office object (exit wave 3), apart from workerd: server/office/office.ts gives it the host of ctx.storage and
 * the sockets of the Hibernation API, and node tests give it node:sqlite and fake sockets. One Deps for each object call, with
 * the network port of that call, so the ports never outlive the RPC call whose stub they hold.
 */

export type OfficeHost = SqlHost & { readonly totals: { rowsRead: number; rowsWritten: number } };
/**
 * Madar enterprises: every input of an object call carries ent, the enterprise that the Worker found (from the token, a tag or an address).
 * The gate of the object checks it against the identity row before any other work.
 */
export type OfficeEffectsInput = { ent: EnterpriseId; ids: string[]; worker: number };
export type OfficeEffectsReport = { done: number; failed: number };
export type OfficeHealth = { schema: number; lastJob: string | null };
/** One Cron run: its time (ISO text) and the Worker requests since the last report. */
export type OfficeCronInput = { ent: EnterpriseId; at: string; worker: number };
export type DayRow = { rows_read: number; rows_written: number; requests: number; calls: number; worker_requests: number };
/** One step of the own sign-in (exit wave 2): its name in SIGNIN_STEPS (server/auth/own/office.ts) and its input. */
export type OfficeSigninInput = { ent: EnterpriseId; signin: string; input: unknown };
/**
 * The forgot and renew routes (exit wave 2) on the office path. mailRoute runs the shape check and the limits and answers at once,
 * with the value of the mail work (the email or the renew key); mailWork runs that work in a second call, after the answer of the
 * Worker, so the answer takes the same time for a known and an unknown email (server/office/signinRoutes.ts).
 */
export type OfficeMailRoute = 'forgot' | 'renew';
export type OfficeMailInput = { ent: EnterpriseId; route: OfficeMailRoute; body: string; address: string; addressChecked?: boolean };
export type OfficeMailAnswer = { status: number; body: string; work?: string };
export type OfficeMailWork = { ent: EnterpriseId; route: OfficeMailRoute; value: string };
/**
 * One request of /mcp on the office path (the merge of exit waves 2 and 3), as plain data: the Worker sends it on as it came, and
 * the object runs the MCP app (server/mcp/app.ts) with the own token check, the agent check on SQLite and each tool call through
 * the batch path. later: the mails and pushes of a tool call, which the Worker runs after the answer (runEffects).
 */
/** mcpUrl (Madar enterprises): the MCP address of this request, built by the Worker from its own MCP_URL and the address name. */
export type OfficeMcpInput = { ent: EnterpriseId; mcpUrl: string; url: string; method: string; headers: [string, string][]; body: string | null; worker: number };
export type OfficeMcpAnswer = { status: number; headers: [string, string][]; body: string; later: string[] };
/** The report of the job, the sockets that the sweep closed, and the day row of the meters after the run. */
export type OfficeCronReport = JobReport & { closed: number; day: DayRow | null; status: EnterpriseStatus };

export type PartsInput = {
  host: OfficeHost;
  read: ReadEnv;
  sockets: Sockets;
  principal: (who: OfficeWho, office: OfficeSnapshot) => Principal;
  /** The name of the object (ctx.id.name; spike S3). The gate refuses every call when it differs from the id of the identity row. */
  name?: () => string | undefined;
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
  /** The identity of the enterprise of this object (server/enterprise/gate.ts). */
  readonly gate: EnterpriseGate;
  /** The facts of the enterprise in memory (server/enterprise/facts.ts). */
  readonly facts: EnterpriseFacts;
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
  /** The status row of this enterprise (Madar enterprises). A paused object answers it too. */
  status(input: { ent: EnterpriseId }): Promise<EnterpriseStatus>;
  /** The first start of an enterprise (plan C): its row, its settings, the first Admin and the invitation. A repeat changes nothing. */
  init(input: EnterpriseInit, net: NetApi): Promise<OpResult<{ adminUserId: string }>>;
  /**
   * The changes that the platform makes (plan C, Task 6). setState runs on a paused object too, so a resume works. The other four refuse
   * a paused object. Each one names the id in ent, and the gate checks it first.
   */
  setState(input: { ent: EnterpriseId; state: EnterpriseState }): Promise<void>;
  setLimits(input: { ent: EnterpriseId; limits: EnterpriseLimits }): Promise<void>;
  setIdentity(input: { ent: EnterpriseId; name?: string; nameAr?: string; logo?: string | null }): Promise<void>;
  setPlatformOwners(input: { ent: EnterpriseId; userIds: string[] }): Promise<void>;
  /** The Madar person behind a sign-in id, or null for a turned-off, a removed, an agent or an unknown one. */
  person(input: { ent: EnterpriseId; authUserId: string }): Promise<{ userId: string } | null>;
  /** The name and the logo of this enterprise, for the public logo route of the Worker (plan C, Task 16). */
  brand(input: { ent: EnterpriseId }): Promise<{ name: string; nameAr: string; logo: string | null }>;
  /** The invitation of the first Admin again. */
  reinvite(input: { ent: EnterpriseId }, net: NetApi): Promise<OpResult<{ sentAt: string }>>;
  /** One office op of the Worker (exit wave 4): /office/export, /office/import and /office/peek, as JSON in and out. */
  ops(request: Request): Promise<Response>;
  /** The counts of the UTC day of now: the day row and the counts that the meter holds in memory still (exit wave 4). */
  dayCounts(now: Date): Promise<DayRow>;
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

/** An object method that throws its refusal (runEffects, cron, mailWork, status): the Worker maps a thrown ApiError to its status. */
function refusalError(error: RunError): ApiError {
  return new ApiError(error.code, error.message, error.details ?? {});
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
  // Every line of the object carries its enterprise, from the identity row (design 5.16). Before the gate has a row, a line has no ent.
  const log = entLogger(o.log ?? consoleLogger(), () => gate.current()?.id);
  const meter = new OfficeMeter(o.host);
  const tickets = new LiveTickets(() => gate.id());
  const hold = new OfficeHold();
  const gate = new EnterpriseGate(db, o.name ? { name: o.name } : {});
  // The facts of the enterprise (plan C): loaded with the first call, from the row of the gate and enterprise_use.
  const facts = new EnterpriseFacts();
  const factsReady = async () => {
    if (!facts.loaded()) await facts.load(db, gate.current() ?? null);
  };
  /** The refusal of the gate for one call (server/enterprise/gate.ts), with the facts loaded for the Deps that follow. */
  const guard = async (ent: unknown, allow: { allow?: 'paused' } = {}): Promise<RunError | undefined> => {
    const refused = await gate.refusal(ent, allow);
    await factsReady();
    return refused;
  };
  // The test tools (the peek route; the replace mode of the import, Task 10): MADAR_TEST_TOOLS = "on", never on production.
  const tools = testToolsOn(o.read);
  // The day cap of the test Worker (exit wave 4, server/office/cap.ts): MADAR_DAY_CAP, set for the test Worker only.
  const cap = dayCapOf(o.read('MADAR_DAY_CAP'));
  // The share of the free day limits of one enterprise except ENT_VADO (plan C, design 5.14): read when first needed, so a bad setting stops
  // only the call that needs it.
  let share: ReturnType<typeof shareCapOf> | undefined;
  let dayHeld: { at: number; day: DayRow } | undefined;
  // The mails a UTC day of the account (MADAR_PLAN_MAILS), read once. A bad setting must not stop every call: the platform object, which
  // decides the places of the pool, then fails its own call and no mail goes out (design 5.12), so the local count may use the Free value.
  let mailLimit: number | undefined;
  const mailDayLimit = (): number => {
    if (mailLimit !== undefined) return mailLimit;
    try {
      mailLimit = planFrom(o.read).limits.mails;
    } catch {
      mailLimit = FREE_LIMITS.mails;
    }
    return mailLimit;
  };
  const staleMs = Number(o.read('MADAR_LIVE_STALE_MS') ?? LIVE_STALE_MS);
  const signals = liveSignals({ sockets: o.sockets, log, now: () => clock.now(), staleMs });
  const ledgers = new WeakMap<Deps, EffectLedger>();
  const data = officeData({ meter, ledgerOf: (deps) => ledgers.get(deps) });
  // runCall gives each committed effect to afterCommit (the object has no host "after"): the ledger keeps it for the batch.
  const afterCommit = async (deps: Deps, ids: string[]) => ledgers.get(deps)?.committed(ids);
  const run = createRunCall({ ...(o.calls ? { calls: o.calls } : {}), data, afterCommit });
  // The internal call of the Daftra step (payments.daftraPaid) runs on the same SQLite data, with the same ledger.
  const daftraRun = createRunCall({ calls: DAFTRA_INTERNAL_CALLS, data, afterCommit });
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
    const ports = netPorts(net, { guard: { open: () => db.isOpen(), now: () => clock.now() }, kind: values.config.fileStore, maxFileBytes: values.config.limits.maxFileBytes,
      // The second wall of the file keys: this object works inside the key folder of its own enterprise (server/files/guard.ts). An object
      // with no identity row (the old name "office" and a rehearsal name) is VADOs' Companies, as entOfConfig reads a config with no ent.
      ent: gate.current() ? gate.id() : ENT_VADO });
    const deps: Deps = {
      db,
      clock,
      files: ports.files,
      // The email directory of the platform, through the network port of this call (plan C). The hooks of the people calls use it.
      directory: ports.directory,
      // MAIL_DRIVER=outbox (the test copy) writes the mail into mail_outbox of the object: no network, so no port.
      mail: values.mail.driver === 'outbox' ? outboxMailPort(db) : ports.mail,
      // The mail pool of the account (plan D): the outbox driver sends no real mail, so it takes no place.
      mailPool: values.mail.driver === 'outbox' ? undefined : ports.mailPool,
      signal: signals,
      authAdmin,
      // The enterprise of this object, once the gate has its row (every method checks the gate before it makes the deps).
      config: gate.current() ? { ...values.config, ent: gate.id(), mailDayLimit: mailDayLimit() } : { ...values.config, mailDayLimit: mailDayLimit() },
      // The facts of the enterprise: hooks read the limits and the owners from them (plan C).
      enterprise: facts,
      log,
      pushFetch: ports.pushFetch,
      // Google and Daftra requests leave from the Worker (server/office/net.ts): the object sends them through its network port.
      googleFetch: ports.googleFetch,
      daftraFetch: ports.daftraFetch,
      // The rows that a server call (google.connect, google.disconnect) wrote run after the answer, as the rows of a shared call.
      later: (ids, kinds) => {
        const ledger = ledgers.get(deps);
        ledger?.wrote(ids, kinds);
        ledger?.committed(ids);
      },
      live: tickets,
      // The typing signal of chats.typing goes to the sockets of the members (server/office/presence.ts).
      typing: officeTyping({ sockets: o.sockets }),
      // A job step that runs a normal call (the meetings step) runs it on the SQLite data of this object.
      runCall: run,
      daftraRun,
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
      const row = await gate.load();
      return { id, schema: LITE_SCHEMA_VERSION, ...(await meta()), tables: [...EXPORT_TABLES], until: new Date(hold.active(now)!.until).toISOString(), ...(row ? { ent: row.id } : {}) };
    }
    hold.check(step.id, now);
    if (step.step === 'page') return exportPage(db, step.table, step.after);
    const out = await meta();
    hold.end(step.id);
    return out;
  }

  async function dayCounts(now: Date): Promise<DayRow> {
    const [row] = await db.statement<DayRow>('read', DAY_ROW_LITE, [utcDay(now)]);
    const pending = meter.pending();
    return {
      rows_read: Number(row?.rows_read ?? 0) + pending.rowsRead,
      rows_written: Number(row?.rows_written ?? 0) + pending.rowsWritten,
      requests: Number(row?.requests ?? 0) + pending.requests,
      calls: Number(row?.calls ?? 0) + pending.calls,
      worker_requests: Number(row?.worker_requests ?? 0) + pending.workerRequests,
    };
  }

  /** The day counts for the cap, read again at most once a minute and at each new UTC day. */
  async function capDay(now: Date): Promise<DayRow> {
    if (!dayHeld || now.getTime() - dayHeld.at > DAY_CAP_TTL_MS || utcDay(new Date(dayHeld.at)) !== utcDay(now)) dayHeld = { at: now.getTime(), day: await dayCounts(now) };
    return dayHeld.day;
  }

  /**
   * The refusal of the day cap for one call, or undefined. The cap of the test Worker (MADAR_DAY_CAP) wins when it is set. Else an enterprise
   * except ENT_VADO has its share of the free limits, but only for the calls that carry work (a batch, a tool call of MCP): the sign-in steps,
   * forgot and renew pass `shared: false` and keep working (design 5.14). ENT_VADO is never refused.
   */
  async function capped(writes: boolean, shared = false): Promise<RunError | undefined> {
    if (cap) return capRefusal(await capDay(clock.now()), cap, writes);
    const ent = facts.id();
    if (!shared || ent === undefined || ent === ENT_VADO) return undefined;
    share ??= shareCapOf(planFrom(o.read));
    return capRefusal(await capDay(clock.now()), share, writes, COMPANY_BUSY);
  }

  /**
   * One step of an import (exit wave 4, server/office/import.ts): begin takes the hold of an import (every call waits), each part
   * and the finish check it, and the finish or an abort ends it. After the finish every socket closes, so each open screen
   * reloads the new office.
   */
  async function importStep(step: ImportStep, now: Date, name: string | null) {
    if (step.step === 'begin') {
      if (step.mode === 'replace' && !tools) throw new ApiError('forbidden', 'The replace mode is a test tool, and it is off on this copy.');
      const id = hold.begin('import', now);
      try {
        await importBegin(db, step.mode);
        // An object that was never made gets its identity row from the first import into an enterprise id. A rehearsal name and the old
        // name "office" make no row, so those objects answer not_found on every other call.
        if (!(await gate.load()) && isEnterpriseId(name)) {
          await gate.create({ id: name, state: 'active', limits: { people: null, storageBytes: null }, now });
          facts.forget();
        }
      } catch (error) {
        hold.end(id);
        throw error;
      }
      return { id, schema: LITE_SCHEMA_VERSION, day: await dayCounts(now) };
    }
    hold.check(step.id, now);
    if (step.step === 'abort') {
      hold.end(step.id);
      return { ok: true };
    }
    if (step.step === 'part') return importPart(db, step.table, step.rows);
    const out = await importFinish(db, step.server, step.signin, now, (q) => meter.flush(q, now));
    hold.end(step.id);
    for (const socket of o.sockets.list('office')) {
      try {
        socket.close(1012, 'The office data changed.');
      } catch {
        // The socket is closed already.
      }
    }
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
    gate,
    facts,
    depsFor,
    async batch(input, net) {
      const refused = await guard(input.ent);
      if (refused) return { ok: false, error: refused };
      meter.request({ calls: input.calls.length, worker: input.worker });
      // An export refuses a batch with a write and serves a read batch; an import refuses every batch.
      const held = hold.refusal({ now: clock.now(), writes: writesIn(input.calls) }) ?? await capped(writesIn(input.calls), true);
      if (held) return { ok: false, error: held };
      const deps = depsFor(net);
      const out = await runOfficeBatch(deps, input, { run, data: data(deps), principal: o.principal, ledger: ledgers.get(deps)! });
      if (!out.ok) return out;
      if (out.officeChanged) closeOff(o.sockets, await office());
      return { ok: true, body: out.body, later: out.later };
    },
    async runEffects(input, net) {
      const refused = await guard(input.ent);
      if (refused) throw refusalError(refused);
      meter.request({ worker: input.worker });
      // An import writes every table: the outbox rows wait for the Cron. An export lets them run (outbox and mail are drift tables).
      if (hold.active(clock.now())?.kind === 'import') return { done: 0, failed: 0 };
      const result = await processOutbox(depsFor(net), input.ids);
      return { done: result.done.length, failed: result.failed.length };
    },
    async cron(input, net) {
      const refused = await guard(input.ent);
      if (refused) throw refusalError(refused);
      meter.request({ worker: input.worker });
      const at = new Date(input.at);
      if (hold.active(at)) {
        log.info('The office jobs wait: an export or an import holds the office.', { at: input.at });
        const closed = sweep(o.sockets, clock.now(), staleMs);
        return { ok: true, at: input.at, steps: [], closed, day: null, status: await enterpriseStatusOf(db, gate.id(), await office(), await dayCounts(at), at) };
      }
      // One Deps, so the whole run shares one network budget: one Cron run is one Worker invocation (50 subrequests on Free).
      const deps = depsFor(net);
      const report = await runOfficeJobs(deps, at);
      await db.tx('write', (q) => meter.flush(q, at));
      const closed = sweep(o.sockets, clock.now(), staleMs);
      const [day] = await db.statement<DayRow>('read', DAY_ROW_LITE, [utcDay(at)]);
      return { ...report, closed, day: day ?? null, status: await enterpriseStatusOf(db, gate.id(), await office(), await dayCounts(at), at) };
    },
    async signin(body) {
      // A paused object lets the sign-in steps through to the step: plan C decides each step of a paused object (design 5.8).
      const refused = await guard(body.ent, { allow: 'paused' });
      if (refused) return { ok: false, error: refused };
      // A paused enterprise (design 5.8): only the password step runs its checks, and it ends with the paused answer after a right password
      // (server/auth/own/ops.ts). Every other step answers like a session that ended, so no token, link or consent opens a paused object.
      if (facts.state() === 'paused' && body.signin !== 'auth.password') return { ok: false, error: runErrorOf(sessionEnded()) };
      meter.request();
      // An export lets the sign-in steps run (their rows are drift tables of server/office/ops.ts); an import refuses them. The
      // day cap counts a sign-in step as a read: it stops only over the rows read or the requests.
      const held = hold.refusal({ now: clock.now(), writes: false }) ?? await capped(false);
      if (held) return { ok: false, error: held };
      let keys: SigningKeys;
      try {
        keys = await keysOf();
      } catch (error) {
        log.error('The sign-in keys of the office object did not load.', { error: error instanceof Error ? error.message : String(error) });
        return { ok: false, error: runErrorOf(error) };
      }
      // runSigninOp answers a name that is not in SIGNIN_STEPS with not_found, so the cast gives no step that does not exist.
      return runSigninOp({ db, clock, log, config: values.config, keys, ent: gate.id() }, body.signin as SigninOpName, body.input as OpInput<SigninOpName>);
    },
    async mailRoute(input, net) {
      const refused = await guard(input.ent, { allow: 'paused' });
      if (refused) return mailRefusal(refused);
      meter.request();
      // The limits and the links of forgot and renew are drift tables: an export lets them run, an import refuses them.
      const held = hold.refusal({ now: clock.now(), writes: false }) ?? await capped(false);
      if (held) return mailRefusal(held);
      const answer = await runMailRoute(depsFor(net), input);
      // A paused enterprise gets the usual answer and sends no mail: the value of the work is dropped, so the Worker makes no second call.
      if (facts.state() === 'paused') {
        const { work: _work, ...usual } = answer;
        return usual;
      }
      return answer;
    },
    async mailWork(input, net) {
      const refused = await guard(input.ent, { allow: 'paused' });
      if (refused) throw refusalError(refused);
      // A paused enterprise sends no mail. The mailRoute of a paused object keeps no work, so this is the second guard.
      if (facts.state() === 'paused') return;
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
      const refused = await guard(input.ent);
      if (refused) return mcpRefusal(statusOf(refused), refused.message, refused.details?.reason as string | undefined);
      meter.request({ calls: toolCallsIn(input.body), worker: input.worker });
      // An export lets the OAuth routes under /mcp run (their rows are drift tables); a request of /mcp itself may write, so it waits.
      const path = new URL(input.url).pathname;
      const writes = isMcpToolPath(path);
      // Only a tool call of MCP (the path /mcp) carries work and counts against the share; the OAuth routes under /mcp do not.
      const held = hold.refusal({ now: clock.now(), writes }) ?? await capped(writes, writes);
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
      // The address of this request (Madar enterprises): the config copy, the keys, the metadata, the challenge and the audience all use it.
      // The Worker builds it from its own MCP_URL; the object refuses one that is not under its own, so an address never comes from a
      // header of the browser.
      const base = values.config.mcpUrl.replace(/\/+$/, '');
      const mcpUrl = input.mcpUrl.replace(/\/+$/, '');
      if (mcpUrl !== base && !mcpUrl.startsWith(`${base}/`)) return mcpRefusal(401, 'Sign in to continue.');
      const issuer = ownIssuer(mcpUrl);
      const addressKeys: SigningKeys = { ...keys, issuer, mcpUrl: issuer };
      const plain = depsFor(net);
      const deps: Deps = { ...plain, config: { ...plain.config, mcpUrl } };
      ledgers.set(deps, ledgers.get(plain)!);
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
      const checkAgent = agentTokenChecker({ issuer, audience: mcpUrl, jwks: ownKeySet(secret), requireEnt: true });
      const app = mcpApp(deps, {
        issuer,
        checkToken: async (header) => {
          const token = await checkAgent(header);
          // A good signature is not enough: the claim must name this enterprise (design 5.2).
          if (token.ent !== gate.id()) throw signInAgain();
          return token;
        },
        agentOf: liteAgentOf,
        runCall: toolRun,
        readOffice: () => office(),
        stateKey: await stateKeyOf(),
        fetch: NO_HOP,
        oauth: (routes) => mountOAuth(routes, localSigninOffice({ db, clock, log, config: deps.config, keys: addressKeys, ent: gate.id() }), { mcpUrl, jwks: ownPublicJwks(secret) }),
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
      // An object that was never made, and a paused object, take no socket: the same refusal as a ticket that does not open.
      const row = await gate.load();
      await factsReady();
      if (!row || row.state === 'paused') return errorResponse(TICKET_REFUSED);
      meter.request();
      return acceptLive({ sockets: o.sockets, tickets, office, now: () => clock.now(), ent: () => gate.id() }, request);
    },
    message(socket, message) {
      // The runtime answers "ping" itself (setWebSocketAutoResponse). This covers a ping that reaches the object while it is awake.
      if (message === LIVE_PING) {
        socket.send(LIVE_PONG);
        return;
      }
      // The state of the device (chat presence design). Any other text is ignored.
      stateMessage(o.sockets, socket, message);
    },
    closed(socket, code) {
      // The person may have left (their last socket), so the office hears of it before the socket closes.
      socketClosed(o.sockets, socket);
      try {
        socket.close(RESERVED_CLOSE.has(code) ? 1000 : code, 'Closed.');
      } catch {
        // The socket is closed already.
      }
    },
    async status(input) {
      const refused = await guard(input.ent, { allow: 'paused' });
      if (refused) throw refusalError(refused);
      meter.request();
      const now = clock.now();
      return enterpriseStatusOf(db, gate.id(), await office(), await dayCounts(now), now);
    },
    async init(input, net) {
      // An object with a row refuses another id and a paused state. An object with no row takes the id only when its own name agrees
      // (the Worker made it with idFromName), so a wrong name never makes an enterprise.
      if (await gate.load()) {
        const refused = await guard(input.ent);
        if (refused) return { ok: false, error: refused };
      } else {
        const name = o.name?.();
        if (!isEnterpriseId(input.ent) || (name !== undefined && name !== input.ent)) {
          return { ok: false, error: runErrorOf(new ApiError('unauthenticated', 'Sign in to continue.')) };
        }
      }
      meter.request();
      try {
        const out = await initEnterprise({ db, clock, gate, facts, depsFor: () => depsFor(net) }, input);
        return { ok: true, value: out };
      } catch (error) {
        log.error('The first start of an enterprise failed.', { ent: input.ent, error: error instanceof Error ? error.message : String(error) });
        return { ok: false, error: runErrorOf(error) };
      }
    },
    async setState(input) {
      const refused = await guard(input.ent, { allow: 'paused' });
      if (refused) throw refusalError(refused);
      meter.request();
      await writeState({ db, gate, facts }, input.state);
      // A paused enterprise has no live screen: every socket closes, and a person who comes back meets the paused answer.
      if (input.state === 'paused') {
        for (const socket of o.sockets.list('office')) {
          try {
            socket.close(1012, 'Paused.');
          } catch {
            // The socket is closed already.
          }
        }
      }
    },
    async setLimits(input) {
      const refused = await guard(input.ent);
      if (refused) throw refusalError(refused);
      meter.request();
      await writeLimits({ db, gate, facts }, input.limits);
    },
    async setIdentity(input) {
      const refused = await guard(input.ent);
      if (refused) throw refusalError(refused);
      meter.request();
      await writeIdentity(db, {
        ...(input.name !== undefined ? { name: input.name } : {}), ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
        ...(input.logo !== undefined ? { logo: input.logo } : {}),
      });
    },
    async setPlatformOwners(input) {
      const refused = await guard(input.ent);
      if (refused) throw refusalError(refused);
      meter.request();
      await writePlatformOwners({ db, facts }, input.userIds);
    },
    async person(input) {
      const refused = await guard(input.ent);
      if (refused) throw refusalError(refused);
      meter.request();
      try {
        const principal = o.principal({ kind: 'browser', authUserId: input.authUserId }, await office());
        return { userId: principal.userId };
      } catch {
        return null;
      }
    },
    async brand(input) {
      const refused = await guard(input.ent);
      if (refused) throw refusalError(refused);
      meter.request();
      const { name, nameAr, logo } = brandOfSettings((await office()).lists.settings);
      return { name, nameAr, logo };
    },
    async reinvite(input, net) {
      const refused = await guard(input.ent);
      if (refused) return { ok: false, error: refused };
      meter.request();
      try {
        return { ok: true, value: await reinviteAdmin({ db, clock, depsFor: () => depsFor(net) }) };
      } catch (error) {
        if (!(error instanceof ApiError)) log.error('The invitation of the first Admin did not go out.', { error: error instanceof Error ? error.message : String(error) });
        return { ok: false, error: runErrorOf(error) };
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
        if (path === '/office/import') return Response.json(await importStep(importStepOf(await bodyOf(request)), now, request.headers.get(OFFICE_NAME_HEADER)));
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
    dayCounts,
  };
}
