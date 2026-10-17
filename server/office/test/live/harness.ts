import { createTestHarness } from 'wrangler';
import type { RunError } from '../../../core/types';
import type { WireResponse } from '../../../../src/api/remote/wire';
import type { State } from '../../../../src/api/store';
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
  const server = createTestHarness({
    workers: [{
      configPath: new URL('./wrangler.toml', import.meta.url),
      secrets: {
        RESEND_API_KEY: 're_test_not_a_key', MADAR_SECRET_KEY: 'sb_secret_test_not_a_key', R2_ACCOUNT_ID: '0'.repeat(32),
        R2_ACCESS_KEY_ID: 'test-not-a-key', R2_SECRET_ACCESS_KEY: 'test-not-a-key',
        VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:madar@vado.sa',
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
    open: (ticket: string) => openSocket(`${url.href.replace(/^http/, 'ws')}api/live?ticket=${ticket}`),
    evict: () => worker().evictDurableObject('OFFICE', { name: 'office', webSockets: 'hibernate' }),
  };
}
