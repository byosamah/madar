import { describe, expect, it, vi } from 'vitest';
import { PushConfigError, makeVapidKeys, type VapidConfig } from './vapid';
import { PUSH_TTL_SECONDS, PushSendError, sendPush } from './send';

/** The push sender (owner, 2026-10-08). Every test hands it a stub fetch; the real fetch never runs. */

const NOW = new Date('2026-10-08T10:00:00Z');
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bE-secret-endpoint-token';
let config: VapidConfig;
const keys = async (): Promise<VapidConfig> => (config ??= { ...(await makeVapidKeys()), subject: 'mailto:madar@vado.sa' });

function stub(answer: () => Response | Promise<Response>) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return answer();
  }) as unknown as typeof globalThis.fetch;
  return { fetch, seen };
}
const reply = (status: number) => new Response(null, { status });

describe('sendPush', () => {
  it('posts an empty body with the VAPID header, TTL, urgency and topic to the endpoint', async () => {
    const { fetch, seen } = stub(() => reply(201));
    expect(await sendPush(await keys(), ENDPOINT, { fetch, now: () => NOW })).toBe('sent');
    expect(seen).toHaveLength(1);
    const { url, init } = seen[0];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.body === undefined || init.body === null || init.body === '').toBe(true);
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
    expect(headers.get('ttl')).toBe(String(PUSH_TTL_SECONDS));
    expect(PUSH_TTL_SECONDS).toBe(3600);
    expect(headers.get('urgency')).toBe('normal');
    expect(headers.get('topic')).toBe('madar');
    expect(headers.get('content-length')).toBe('0');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('counts 201 and 202 as sent', async () => {
    for (const status of [201, 202]) expect(await sendPush(await keys(), ENDPOINT, { fetch: stub(() => reply(status)).fetch, now: () => NOW }), String(status)).toBe('sent');
  });

  it('reports a device as gone for 404 and 410', async () => {
    for (const status of [404, 410]) expect(await sendPush(await keys(), ENDPOINT, { fetch: stub(() => reply(status)).fetch, now: () => NOW }), String(status)).toBe('gone');
  });

  it('throws a retryable error for 429, every 5xx and a network error', async () => {
    for (const status of [429, 500, 502, 503, 504]) {
      const error = await sendPush(await keys(), ENDPOINT, { fetch: stub(() => reply(status)).fetch, now: () => NOW }).catch((e: unknown) => e);
      expect(error, String(status)).toBeInstanceOf(PushSendError);
      expect(error).toMatchObject({ status, retryable: true });
    }
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof globalThis.fetch;
    const error = await sendPush(await keys(), ENDPOINT, { fetch: down, now: () => NOW }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PushSendError);
    expect(error).toMatchObject({ status: null, retryable: true });
  });

  it('throws a retryable error when the push service is too slow', async () => {
    const slow = vi.fn((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation timed out.', 'TimeoutError')));
    })) as unknown as typeof globalThis.fetch;
    const error = await sendPush(await keys(), ENDPOINT, { fetch: slow, now: () => NOW, timeoutMs: 20 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'PushSendError', status: null, retryable: true });
  });

  it('says refused, with no retry, for another answer: 400, 401, 403, 413 and a redirect', async () => {
    for (const status of [400, 401, 403, 413, 301, 307]) expect(await sendPush(await keys(), ENDPOINT, { fetch: stub(() => reply(status)).fetch, now: () => NOW }), String(status)).toBe('refused');
  });

  it('never puts the endpoint, the token or a key in an error', async () => {
    const all = await keys();
    const error = (await sendPush(all, ENDPOINT, { fetch: stub(() => reply(503)).fetch, now: () => NOW }).catch((e: unknown) => e)) as PushSendError;
    for (const secret of [ENDPOINT, 'secret-endpoint-token', all.privateKey, all.publicKey]) {
      expect(error.message).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
    expect(error.message).toContain('fcm.googleapis.com');
    const network = (await sendPush(all, ENDPOINT, { fetch: (async () => { throw new TypeError(`fetch failed ${ENDPOINT}`); }) as unknown as typeof fetch, now: () => NOW }).catch((e: unknown) => e)) as PushSendError;
    expect(network.message).not.toContain('secret-endpoint-token');
  });

  it('skips with an error that names the variable when a key is missing, and never calls the push service', async () => {
    const { fetch, seen } = stub(() => reply(201));
    await expect(sendPush(undefined, ENDPOINT, { fetch, now: () => NOW })).rejects.toThrow(/VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT/);
    await expect(sendPush(undefined, ENDPOINT, { fetch, now: () => NOW })).rejects.toBeInstanceOf(PushConfigError);
    await expect(sendPush({ ...(await keys()), privateKey: 'short' }, ENDPOINT, { fetch, now: () => NOW })).rejects.toThrow(/VAPID_PRIVATE_KEY/);
    expect(seen).toEqual([]);
  });

  it('refuses an endpoint that is not a known push service before it posts', async () => {
    const { fetch, seen } = stub(() => reply(201));
    for (const endpoint of ['https://evil.example/push', 'http://fcm.googleapis.com/x', 'https://169.254.169.254/latest']) {
      expect(await sendPush(await keys(), endpoint, { fetch, now: () => NOW }), endpoint).toBe('refused');
    }
    expect(seen).toEqual([]);
  });
});
