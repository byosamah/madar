import { createTestHarness } from 'wrangler';
import type { RunError } from '../../../core/types';
import type { WireResponse } from '../../../../src/api/remote/wire';
import type { State } from '../../../../src/api/store';
import { testPrivateJwk } from '../../../auth/own/testKeys';
import { makeVapidKeys } from '../../../push/vapid';

export type SocketClient = { ws: WebSocket; got: string[]; opened: Promise<void>; closed: Promise<{ code: number; reason: string }> };
export type NetSeen = { files: { op: string; key: string }[]; mails: { to: string; tag: string; idempotencyKey: string }[]; pushes: { endpoint: string; headers: Record<string, string> }[] };
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
 */
export async function startLive() {
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
    rows: async <R,>(text: string, values: unknown[] = []) => read<R[]>(await post('/test/rows', { text, values })),
    exec: async (text: string, values: unknown[] = []) => read<{ ok: true }>(await post('/test/exec', { text, values })),
    readBack: async () => read<State>(await worker().fetch('/test/readBack')),
    net: async () => read<NetSeen>(await worker().fetch('/test/net')),
    batch: async (userId: string, calls: BatchCall[]) => {
      const response = await post('/api/batch', { v: 1, calls: calls.map((c, i) => ({ i, ...c })) }, { authorization: `Bearer ${userId}` });
      return { status: response.status, body: (await response.json()) as WireResponse & { error?: RunError } };
    },
    agent: async (ownerId: string) => read<{ authId: string; clientId: string; sessionId: string }>(await post('/test/agent', { ownerId })),
    /** One 2025-era MCP request with an agent token (or none), and its JSON answer (one SSE event or plain JSON). */
    mcp: async (token: string | null, method: string, params: Record<string, unknown> = {}) => {
      const response = await post('/mcp', { jsonrpc: '2.0', id: 1, method, params }, {
        accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...(token ? { authorization: `Bearer ${token}` } : {}),
      });
      const text = await response.text();
      const json = text.startsWith('event:') ? text.split('\n').find((line) => line.startsWith('data: '))!.slice(6) : text;
      return { status: response.status, body: (json ? JSON.parse(json) : {}) as { result?: Record<string, any>; error?: { message: string } } };
    },
    open: (ticket: string) => openSocket(`${url.href.replace(/^http/, 'ws')}api/live?ticket=${ticket}`),
    evict: () => worker().evictDurableObject('OFFICE', { name: 'office', webSockets: 'hibernate' }),
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
