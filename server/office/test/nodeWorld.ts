import { DatabaseSync } from 'node:sqlite';
import { ApiError } from '../../../src/api/errors';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { importSigninRows, type SigninExportRow } from '../../auth/own/import';
import { testPrivateJwk } from '../../auth/own/testKeys';
import { OWN_AUTH_SECRET, ownIssuer, ownKeySet, ownPublicJwks } from '../../auth/ownKeys';
import { browserTokenChecker, type TokenChecker } from '../../auth/verify';
import type { Deps, Logger } from '../../core/ports';
import { nodeHost } from '../../data/lite/host';
import { applyLiteSchema } from '../../data/lite/schema';
import { liteWriteState } from '../../data/lite/whole';
import { ENT_VADO, normalizeEmail, type EnterpriseId } from '../../enterprise/ids';
import { platformParts, type PlatformParts } from '../../enterprise/platform/parts';
import { applyPlatformSchema } from '../../enterprise/platform/schema';
import type { EnterpriseRow } from '../../enterprise/types';
import { officeSigninRoutes } from '../../entries/officeSignin';
import { officeRoutes, type OfficeRoute, type OfficeStub } from '../../entries/officeWorker';
import { fixedClock } from '../../test/fakes/clock';
import { officeParts, type OfficeParts } from '../parts';
import { refusingDb } from '../refusingDb';
import { principalOfWho } from '../who';
import { fakeSockets, recordingNet } from './fakes';

/**
 * The office path of Madar enterprises on node:sqlite for the node tests: one platform object and one office object for each
 * enterprise id, with route(), which sends one request through the real Worker routes (server/entries/officeWorker.ts, with the own
 * sign-in routes of server/entries/officeSignin.ts). route wires them as server/entries/officeEntry.ts does. stubFor is a spy: created
 * lists every object name that the router asked for, so a test can show that a bad id never made an object. The parts tests of the rows
 * run on workerd: totals stays 0 on node:sqlite (the host counts no rows).
 */

/** The values of a Worker on the office path for the node tests: none of them is a secret, and mail goes into mail_outbox. */
export const NODE_OFFICE_ENV: Readonly<Record<string, string>> = {
  APP_URL: 'https://madar.test', ALLOWED_ORIGINS: 'https://madar.test', MCP_URL: 'https://madar.test/mcp', API_URL: 'https://madar.test/api',
  MAIL_FROM: 'Madar <notices@madar.test>', MAIL_DRIVER: 'outbox', SUPABASE_URL: 'http://127.0.0.1:54321',
  MADAR_SECRET_KEY: 'sb_secret_test_not_a_key', MADAR_FILE_STORE: 'r2', R2_ACCOUNT_ID: '0'.repeat(32), R2_ACCESS_KEY_ID: 'test-not-a-key',
  R2_SECRET_ACCESS_KEY: 'test-not-a-key', R2_BUCKET: 'madar-files-test', WORKER_REGION: 'workers-test',
};
export const NODE_TODAY = '2026-10-04';
export const NODE_NOW = '2026-10-04T06:00:00.000Z';

/** One request of a test, as plain data: the shape that the tasks of wave 4 send. worker is the count of a Worker; route ignores it. */
export type OfficeHttpRequest = { method: string; url: string; headers: [string, string][]; body: string; worker?: number };
/** The answer of route: the status, the headers and the text of the body. */
export type OfficeHttpAnswer = { status: number; headers: [string, string][]; body: string };

/** A log that keeps each line as text (the message and its fields), so a test can check that no line holds a value. */
function keptLog(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const keep = (level: string) => (message: string, fields?: Record<string, unknown>) => void lines.push(`${level} ${message}${fields ? ` ${JSON.stringify(fields)}` : ''}`);
  return { lines, info: keep('info'), warn: keep('warn'), error: keep('error') };
}

/** An empty value counts as missing, as in server/env.ts. */
const present = (value: string | undefined): string | undefined => (value === undefined || value === '' ? undefined : value);

/** The stub of the office object over the parts: the methods of server/office/office.ts, with the parts in place of the RPC call. */
export function stubOf(parts: OfficeParts): OfficeStub {
  return {
    batch: (input, net) => parts.batch(input, net),
    runEffects: (input, net) => parts.runEffects(input, net),
    cron: (input, net) => parts.cron(input, net),
    signin: (body) => parts.signin(body),
    mailRoute: (input, net) => parts.mailRoute(input, net),
    mailWork: (input, net) => parts.mailWork(input, net),
    mcp: (input, net) => parts.mcp(input, net),
    health: () => parts.health(),
    status: (input) => parts.status(input),
    init: (input, net) => parts.init(input, net),
    setState: (input) => parts.setState(input),
    setLimits: (input) => parts.setLimits(input),
    setIdentity: (input) => parts.setIdentity(input),
    setPlatformOwners: (input) => parts.setPlatformOwners(input),
    person: (input) => parts.person(input),
    reinvite: (input, net) => parts.reinvite(input, net),
    // As Office.fetch: the office ops of exit wave 4 under /office/, else the socket. The drop of a spare object is workerd only.
    fetch: (request) => (new URL(request.url).pathname.startsWith('/office/') ? parts.ops(request) : parts.socket(request)),
  };
}

/** The platform row of a test enterprise: VADO is vados, ent_002 is globex, any other id gets the address ent-NNN. */
export function enterpriseRowOf(ent: EnterpriseId, now: string): EnterpriseRow {
  const address = ent === ENT_VADO ? 'vados' : ent === 'ent_002' ? 'globex' : ent.replace('_', '-');
  return {
    id: ent, address, name: ent === ENT_VADO ? "VADOs' Companies" : `Test ${ent}`, nameAr: ent === ENT_VADO ? 'شركات فادو' : `اختبار ${ent}`, state: 'active',
    limits: { people: null, storageBytes: null }, createdAt: now, firstAdmin: { name: 'First Admin', email: `first-admin@${address}.test` },
  };
}

export type NodeEnterprise = { raw: DatabaseSync; host: ReturnType<typeof nodeHost> & { totals: { rowsRead: number; rowsWritten: number } }; parts: OfficeParts; sockets: ReturnType<typeof fakeSockets>; stub: OfficeStub };

export type NodeWorldOptions = {
  at?: string;
  env?: Record<string, string>;
  /** The enterprises that the world makes, each with its object and its row in the platform list. Default: ENT_VADO. */
  ents?: EnterpriseId[];
  /** The office of each enterprise: a State, or false for an empty one. ENT_VADO and any id with no entry get the sample office. */
  seeds?: Partial<Record<EnterpriseId, State | false>>;
  /** false: the first object is made without its identity row (an object that was never made). */
  row?: false;
  /** The minimum answer time of the forgot and renew routes, in ms. Default: the real values. */
  minMs?: { forgot?: number; renew?: number };
  /** The sleep of the minimum answer time. Default: a real timer. A test that compares the waits records them here. */
  sleep?: (ms: number) => Promise<void>;
};

export async function nodeWorld(o: NodeWorldOptions = {}) {
  const ids = o.ents ?? [ENT_VADO];
  const jwk = await testPrivateJwk();
  const env: Record<string, string> = { ...NODE_OFFICE_ENV, MADAR_AUTH_PRIVATE_JWK: jwk, ...o.env };
  const read = (name: string) => present(env[name]);
  const at = o.at ?? NODE_NOW;
  const clock = fixedClock(at);
  const log = keptLog();
  const net = recordingNet();
  const ents = new Map<EnterpriseId, NodeEnterprise>();

  async function make(ent: EnterpriseId, made: { seed: State | false; row: boolean }): Promise<NodeEnterprise> {
    const raw = new DatabaseSync(':memory:');
    const host = Object.assign(nodeHost(raw), { totals: { rowsRead: 0, rowsWritten: 0 } });
    await applyLiteSchema(host);
    const sockets = fakeSockets();
    // The object knows its own name, as ctx.id.name does on workerd (spike S3).
    const parts = officeParts({ host, read, sockets, clock, log, principal: principalOfWho, name: () => ent });
    if (made.seed !== false) await parts.db.tx('write', (q) => liteWriteState(q, made.seed as State));
    if (made.row) await parts.gate.create({ id: ent, state: 'active', limits: { people: null, storageBytes: null }, now: new Date(NODE_NOW) });
    const one = { raw, host, parts, sockets, stub: stubOf(parts) };
    ents.set(ent, one);
    return one;
  }

  // The platform object: the list of the enterprises of this world.
  const platformRaw = new DatabaseSync(':memory:');
  const platformHost = nodeHost(platformRaw);
  await applyPlatformSchema(platformHost);
  const platform: PlatformParts = platformParts({ host: platformHost, read, clock, log });

  const sample = async () => buildSeed(NODE_TODAY, async () => undefined);
  for (const [index, ent] of ids.entries()) {
    const seed = o.seeds && ent in o.seeds ? (o.seeds[ent] as State | false) : await sample();
    await make(ent, { seed, row: !(index === 0 && o.row === false) });
    await platform.register({ row: enterpriseRowOf(ent, at), emails: [] });
  }

  // The names that stubFor got. A test reads it to show that a bad id made no object. An id the world does not hold gets an object
  // that was never made (no row), as a real name that nobody made would.
  const created: string[] = [];
  const stubFor = (_env: unknown, ent: string): OfficeStub => {
    created.push(ent);
    const held = ents.get(ent);
    if (held) return held.stub;
    throw new Error(`The node world holds no object ${ent}: a test that wants one lists it in ents.`);
  };

  // The Worker side, as server/entries/officeEntry.ts builds it. Its deps come from the first object, with no enterprise: the Worker
  // serves all of them, and its database refuses every statement, as on the real office path.
  const first = ents.get(ids[0])!;
  const { ent: _ent, ...config } = first.parts.depsFor(net).config;
  const workerDeps: Deps = { ...first.parts.depsFor(net), config, db: refusingDb };
  const secret = read(OWN_AUTH_SECRET);
  let own: OfficeRoute[] | undefined;
  let verifyToken: TokenChecker = () => Promise.reject(new ApiError('unauthenticated', 'Sign in again.'));
  if (secret !== undefined) {
    try {
      own = officeSigninRoutes({ jwks: ownPublicJwks(secret), deps: workerDeps, ...(o.minMs ? { minMs: o.minMs } : {}), ...(o.sleep ? { sleep: o.sleep } : {}) });
      verifyToken = browserTokenChecker({ issuer: ownIssuer(workerDeps.config.mcpUrl), jwks: ownKeySet(secret), requireEnt: true });
    } catch (error) {
      log.error('The own sign-in routes are off: the key did not load.', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  const routes = officeRoutes({
    deps: workerDeps,
    verifyToken,
    stubFor,
    platform: () => platform,
    net: () => net,
    jobsSecret: () => read('MADAR_JOBS_SECRET'),
    exportSecret: () => read('MADAR_EXPORT_SECRET'),
    opsSecret: () => read('MADAR_OPS_SECRET'),
    ...(o.sleep ? { sleep: o.sleep } : {}),
    ...(own ? { routes: own } : {}),
  });

  /** One request through the Worker routes into the object. With no ctx, the work after the answer runs before route returns. */
  async function route(input: OfficeHttpRequest): Promise<OfficeHttpAnswer> {
    const bodyless = input.method === 'GET' || input.method === 'HEAD';
    const request = new Request(input.url, { method: input.method, headers: input.headers, ...(bodyless ? {} : { body: input.body }) });
    // The Worker bindings: the vars of this world (a route reads MADAR_ENTERPRISE_CREATE and the test tools from them).
    const response = await routes.fetch(request, { ...env });
    // A socket upgrade answer (status 101) carries the client socket and no body.
    if (response.status === 101) return { status: 101, headers: [], body: '' };
    return { status: response.status, headers: [...response.headers], body: await response.text() };
  }

  /** Sign-in rows of an enterprise: into its object, and their emails into the directory of the platform. */
  async function signins(rows: readonly SigninExportRow[], ent: EnterpriseId = ids[0]): Promise<void> {
    const one = ents.get(ent)!;
    await one.parts.db.tx('write', (q) => importSigninRows(q, rows, clock.now()));
    for (const row of rows) await platform.reserveEmail({ ent, email: normalizeEmail(row.email) });
  }

  return { ents, platform, platformRaw, created, clock, env, jwk, net, route, signins, lines: log.lines, stubFor: (ent: EnterpriseId) => stubFor(undefined, ent), make };
}

/** One request to the routes of the office path, as a browser or an agent sends it through the Pages Function. */
export function httpOf(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): OfficeHttpRequest {
  return {
    method,
    url: `https://madar.test${path}`,
    headers: Object.entries({ 'content-type': 'application/json', 'x-madar-client-address': '203.0.113.7', ...headers }),
    body: body === undefined ? '' : JSON.stringify(body),
    worker: 1,
  };
}
