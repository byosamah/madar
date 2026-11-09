import { createTestHarness } from 'wrangler';
import type { RunError } from '../../../core/types';
import type { WireResponse } from '../../../../src/api/remote/wire';
import type { State } from '../../../../src/api/store';
import { testPrivateJwk } from '../../../auth/own/testKeys';
import { makeVapidKeys } from '../../../push/vapid';
import { OUTSIDE_SECRETS } from './outside';

export type SocketClient = { ws: WebSocket; got: string[]; opened: Promise<void>; closed: Promise<{ code: number; reason: string }> };
export type NetSeen = { files: { op: string; key: string }[]; mails: { to: string; tag: string; idempotencyKey: string }[]; pushes: { endpoint: string; headers: Record<string, string> }[] };
export type OutsideSeen = { google: { method: string; path: string }[]; daftra: { method: string; url: string }[] };
export type BatchCall = { name: string; input: unknown; story?: { ref: string } | { id: string }; key?: string };
type Answer = { ok: boolean; url: string; status: number; text(): Promise<string>; json(): Promise<unknown> };

/** A browser socket from Node 22 (global WebSocket), with every message it got. */
export function openSocket(address: string): SocketClient {
  const ws = new WebSocket(address);
  const got: string[] = [];
  ws.onmessage = (event) => got.push(String(event.data));
  const opened = new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('The socket did not open.'));
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.onclose = (event) => resolve({ code: event.code, reason: event.reason });
  });
  return { ws, got, opened, closed };
}

/**
 * Starts the live test Worker on local workerd. Every call goes through fetch, so Node holds no stub of the office object and an
 * evict works (proof.md, "Wave 1: the rows pins"). fresh() gives each test a new office: reset() makes the storage again.
 * `outside`: the office object also gets the Google values and the Daftra pair of the fakes (outside.ts). Other suites keep their env.
 */
export async function startLive(o: { outside?: boolean } = {}) {
  const vapid = await makeVapidKeys();
  // The key of the own sign-in for this run only (the MCP suite signs its agent tokens with it). It is never a real key.
  const jwk = await testPrivateJwk();
  const server = createTestHarness({
    workers: [{
      configPath: new URL('./wrangler.toml', import.meta.url),
      secrets: {
        RESEND_API_KEY: 're_test_not_a_key', MADAR_SECRET_KEY: 'sb_secret_test_not_a_key', R2_ACCOUNT_ID: '0'.repeat(32),
        R2_ACCESS_KEY_ID: 'test-not-a-key', R2_SECRET_ACCESS_KEY: 'test-not-a-key',
        VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:madar@vado.sa',
        MADAR_AUTH_PRIVATE_JWK: jwk,
        ...(o.outside ? OUTSIDE_SECRETS : {}),
      },
    }],
  });
  let { url } = await server.listen();
  const worker = () => server.getWorker();
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    worker().fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  // The harness answers with the Response of its own fetch (undici), so read takes the fields that both Response types have.
  const read = async <T,>(response: Answer): Promise<T> => {
    if (!response.ok) throw new Error(`${response.url} answered ${response.status}: ${await response.text()}`);
    return (await response.json()) as T;
  };
  return {
    server,
    worker,
    jwk,
    url: () => url,
    fresh: async (state: State) => {
      await server.reset();
      ({ url } = await server.listen());
      await read(await post('/test/seed', state));
    },
    /** A second object (an enterprise other than ENT_VADO): its own state, its identity row, and its row in the platform list. */
    seedEnterprise: async (ent: string, state: State, address: string) => {
      await read(await post(`/test/seed?ent=${ent}`, state));
      await read(await post('/test/platform', { method: 'register', args: [{
        row: { id: ent, address, name: `Test ${ent}`, nameAr: `اختبار ${ent}`, state: 'active', limits: { people: null, storageBytes: null }, createdAt: '2026-11-08T08:00:00.000Z', firstAdmin: { name: 'First', email: `first@${address}.test` } },
        emails: [],
      }] }));
    },
    rows: async <R,>(text: string, values: unknown[] = [], o: { ent?: string } = {}) => read<R[]>(await post('/test/rows', { text, values, ...o })),
    exec: async (text: string, values: unknown[] = []) => read<{ ok: true }>(await post('/test/exec', { text, values })),
    /** One method of the platform object (TestPlatform), through the test Worker: the Worker holds the stub, not Node. */
    platform: async <T,>(method: string, ...args: unknown[]) => (await read<{ value: T }>(await post('/test/platform', { method, args }))).value,
    evictPlatform: () => worker().evictDurableObject('PLATFORM', { name: 'platform' }),
    statusRows: async () => read<{ status: Record<string, unknown>; rows: number }>(await worker().fetch('/test/statusRows')),
    named: async (name: string) => read<{ ok: boolean; code?: string | null; message?: string }>(await post('/test/named', { name })),
    readBack: async () => read<State>(await worker().fetch('/test/readBack')),
    net: async () => read<NetSeen>(await worker().fetch('/test/net')),
    /** The requests that the fake Google and the fake Daftra saw (method and address only). */
    outside: async () => read<OutsideSeen>(await worker().fetch('/test/outside')),
    batch: async (userId: string, calls: BatchCall[], o: { ent?: string } = {}) => {
      const response = await post('/api/batch', { v: 1, calls: calls.map((c, i) => ({ i, ...c })) }, { authorization: `Bearer ${o.ent ? `${o.ent}:` : ''}${userId}` });
      return { status: response.status, body: (await response.json()) as WireResponse & { error?: RunError } };
    },
    agent: async (ownerId: string, o: { ent?: string } = {}) => read<{ authId: string; clientId: string; sessionId: string }>(await post('/test/agent', { ownerId, ...o })),
    /** One 2025-era MCP request with an agent token (or none), and its JSON answer (one SSE event or plain JSON). */
    mcp: async (token: string | null, method: string, params: Record<string, unknown> = {}, o: { path?: string } = {}) => {
      const response = await post(o.path ?? '/mcp', { jsonrpc: '2.0', id: 1, method, params }, {
        accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...(token ? { authorization: `Bearer ${token}` } : {}),
      });
      const text = await response.text();
      const json = text.startsWith('event:') ? text.split('\n').find((line) => line.startsWith('data: '))!.slice(6) : text;
      return { status: response.status, headers: response.headers, body: (json ? JSON.parse(json) : {}) as { result?: Record<string, any>; error?: { message: string } } };
    },
    open: (ticket: string) => openSocket(`${url.href.replace(/^http/, 'ws')}api/live?ticket=${ticket}`),
    evict: () => worker().evictDurableObject('OFFICE', { name: 'ent_001', webSockets: 'hibernate' }),
    /** One office op through the Worker, with the secret of the test Worker (entry.ts); a status above 299 throws with it. */
    ops: async (op: string, body: unknown, o: { office?: string } = {}) => {
      const header = op === 'export' ? 'x-madar-export-secret' : 'x-madar-ops-secret';
      const secret = op === 'export' ? 'test-export-secret' : 'test-ops-secret';
      const query = o.office ? `?office=${o.office}` : '';
      const response = await worker().fetch(`/api/office/${op}${query}`, { method: 'POST', headers: { 'content-type': 'application/json', [header]: secret }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`${op} answered ${response.status}: ${await response.text()}`);
      return response.json();
    },
  };
}
