import { consoleLogger, serverEnvFrom, type ReadEnv } from '../core/deps';
import { processOutbox } from '../core/effects';
import type { AuthAdminPort, Clock, Deps, Logger } from '../core/ports';
import { createRunCall } from '../core/runCall';
import type { CallEntry } from '../core/serverCallMap';
import type { OfficeSnapshot, Principal } from '../core/types';
import { liteDb, type LiteDb } from '../data/lite/db';
import type { SqlHost } from '../data/lite/host';
import { readLiteOffice } from '../data/lite/office';
import { LITE_SCHEMA_VERSION } from '../data/lite/schema';
import { outboxMailPort } from '../mail/outboxDriver';
import { JOBS_LAST_RUN_SQL } from '../usage/meters';
import { EffectLedger, officeData, runOfficeBatch, type OfficeBatchInput, type OfficeBatchOutput } from './batch';
import { LIVE_PING, LIVE_PONG, LIVE_STALE_MS, LiveTickets, acceptLive, closeOff, liveSignals, type LiveSocket, type Sockets } from './live';
import { OfficeMeter } from './meter';
import { netPorts, type NetApi } from './net';
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
  depsFor(net: NetApi): Deps;
  batch(input: OfficeBatchInput, net: NetApi): Promise<OfficeBatchOutput>;
  runEffects(input: OfficeEffectsInput, net: NetApi): Promise<OfficeEffectsReport>;
  socket(request: Request): Promise<Response>;
  message(socket: LiveSocket, message: string | ArrayBuffer): void;
  closed(socket: LiveSocket, code: number): void;
  health(): Promise<OfficeHealth>;
};

/** Supabase Auth is network work, so the office object has no Auth admin port. The sign-in rows come with wave 2. */
const NO_AUTH = (): Promise<never> => Promise.reject(new Error('Sign-in changes on the office object come with wave 2 of the exit (server/auth).'));
const SIGN_IN_LATER: AuthAdminPort = { generateLink: NO_AUTH, createUser: NO_AUTH, setBanned: NO_AUTH, updateEmail: NO_AUTH, listUsers: NO_AUTH, getUser: NO_AUTH };

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

  function depsFor(net: NetApi): Deps {
    const ports = netPorts(net, { guard: { open: () => db.isOpen(), now: () => clock.now() }, kind: values.config.fileStore, maxFileBytes: values.config.limits.maxFileBytes });
    const deps: Deps = {
      db,
      clock,
      files: ports.files,
      // MAIL_DRIVER=outbox (the test copy) writes the mail into mail_outbox of the object: no network, so no port.
      mail: values.mail.driver === 'outbox' ? outboxMailPort(db) : ports.mail,
      signal: signals,
      authAdmin: SIGN_IN_LATER,
      meter,
      config: values.config,
      log,
      pushFetch: ports.pushFetch,
      live: tickets,
    };
    ledgers.set(deps, new EffectLedger());
    return deps;
  }

  return {
    db,
    meter,
    tickets,
    depsFor,
    async batch(input, net) {
      meter.request({ calls: input.calls.length, worker: input.worker });
      const deps = depsFor(net);
      const out = await runOfficeBatch(deps, input, { run, data: data(deps), principal: o.principal, ledger: ledgers.get(deps)! });
      if (!out.ok) return out;
      if (out.officeChanged) closeOff(o.sockets, await office());
      return { ok: true, body: out.body, later: out.later };
    },
    async runEffects(input, net) {
      meter.request({ worker: input.worker });
      const result = await processOutbox(depsFor(net), input.ids);
      return { done: result.done.length, failed: result.failed.length };
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
  };
}
