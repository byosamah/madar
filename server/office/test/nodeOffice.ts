import { DatabaseSync } from 'node:sqlite';
import { ApiError } from '../../../src/api/errors';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { testPrivateJwk } from '../../auth/own/testKeys';
import { OWN_AUTH_SECRET, ownIssuer, ownKeySet, ownPublicJwks } from '../../auth/ownKeys';
import { browserTokenChecker, type TokenChecker } from '../../auth/verify';
import type { Deps, Logger } from '../../core/ports';
import { nodeHost } from '../../data/lite/host';
import { applyLiteSchema } from '../../data/lite/schema';
import { liteWriteState } from '../../data/lite/whole';
import { officeSigninRoutes } from '../../entries/officeSignin';
import { officeRoutes, type OfficeRoute, type OfficeStub } from '../../entries/officeWorker';
import { fixedClock } from '../../test/fakes/clock';
import { officeParts, type OfficeParts } from '../parts';
import { refusingDb } from '../refusingDb';
import { principalOfWho } from '../who';
import { fakeSockets, recordingNet } from './fakes';

/**
 * The office path on node:sqlite for the node tests (exit wave 4): the office parts with a new own sign-in key, the sample office,
 * and route, which sends one request through the real Worker routes (server/entries/officeWorker.ts, with the own sign-in routes of
 * server/entries/officeSignin.ts) into the methods of the object. route wires them as server/entries/officeEntry.ts and
 * server/office/office.ts do, so a test of route checks the Worker side and the object side together. The parts tests of the
 * rows run on workerd: totals stays 0 on node:sqlite (the host counts no rows).
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
function stubOf(parts: OfficeParts): OfficeStub {
  return {
    batch: (input, net) => parts.batch(input, net),
    runEffects: (input, net) => parts.runEffects(input, net),
    cron: (input, net) => parts.cron(input, net),
    signin: (body) => parts.signin(body),
    mailRoute: (input, net) => parts.mailRoute(input, net),
    mailWork: (input, net) => parts.mailWork(input, net),
    mcp: (input, net) => parts.mcp(input, net),
    health: () => parts.health(),
    // As Office.fetch: the office ops of exit wave 4 under /office/, else the socket. The drop of a spare object is workerd only.
    fetch: (request) => (new URL(request.url).pathname.startsWith('/office/') ? parts.ops(request) : parts.socket(request)),
  };
}

/**
 * The office parts on node:sqlite with a new own sign-in key, and the sample office unless seed is false. The Worker side of route
 * has the deps of the Worker: its database refuses every statement, as on the real office path.
 */
export async function nodeOffice(o: { at?: string; env?: Record<string, string>; seed?: State | false } = {}) {
  const raw = new DatabaseSync(':memory:');
  const host = Object.assign(nodeHost(raw), { totals: { rowsRead: 0, rowsWritten: 0 } });
  await applyLiteSchema(host);
  const jwk = await testPrivateJwk();
  const env: Record<string, string> = { ...NODE_OFFICE_ENV, MADAR_AUTH_PRIVATE_JWK: jwk, ...o.env };
  const read = (name: string) => present(env[name]);
  const clock = fixedClock(o.at ?? NODE_NOW);
  const log = keptLog();
  const sockets = fakeSockets();
  const parts = officeParts({ host, read, sockets, clock, log, principal: principalOfWho });
  if (o.seed !== false) {
    const seed = o.seed ?? (await buildSeed(NODE_TODAY, async () => undefined));
    await parts.db.tx('write', (q) => liteWriteState(q, seed));
  }
  const net = recordingNet();

  // The Worker side, as server/entries/officeEntry.ts builds it: the own sign-in routes only with the key, and the own token check.
  const workerDeps: Deps = { ...parts.depsFor(net), db: refusingDb };
  const secret = read(OWN_AUTH_SECRET);
  let own: OfficeRoute[] | undefined;
  let verifyToken: TokenChecker = () => Promise.reject(new ApiError('unauthenticated', 'Sign in again.'));
  if (secret !== undefined) {
    try {
      own = officeSigninRoutes({ jwks: ownPublicJwks(secret), deps: workerDeps });
      verifyToken = browserTokenChecker({ issuer: ownIssuer(workerDeps.config.mcpUrl), jwks: ownKeySet(secret) });
    } catch (error) {
      log.error('The own sign-in routes are off: the key did not load.', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  const stub = stubOf(parts);
  const routes = officeRoutes({
    deps: workerDeps,
    verifyToken,
    stub: () => stub,
    net: () => net,
    jobsSecret: () => read('MADAR_JOBS_SECRET'),
    ...(own ? { routes: own } : {}),
  });

  /** One request through the Worker routes into the object. With no ctx, the work after the answer runs before route returns. */
  async function route(input: OfficeHttpRequest): Promise<OfficeHttpAnswer> {
    const bodyless = input.method === 'GET' || input.method === 'HEAD';
    const request = new Request(input.url, { method: input.method, headers: input.headers, ...(bodyless ? {} : { body: input.body }) });
    const response = await routes.fetch(request, {});
    return { status: response.status, headers: [...response.headers], body: await response.text() };
  }

  return { raw, host, parts, sockets, clock, env, jwk, net, stub, route, lines: log.lines };
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
