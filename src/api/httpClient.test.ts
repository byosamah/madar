import { describe, expect, expectTypeOf, it } from 'vitest';
import { calls, type Calls, type MadarApi } from './calls';
import { createApi } from './client';
import { API_ERROR_CODES, ApiError } from './errors';
import { memoryPersister } from './persist';
import { createRemoteApi } from './remote/remoteApi';
import { Store } from './store';
import { makeWorld } from '../test/factories';

/** The client parity test of the test map (section 7): the remote API and the fake API are the same Api type to the screens. */
describe('the remote API and the fake API', () => {
  it('have the same type', () => {
    const remote = createRemoteApi<Calls>({ url: 'https://x', build: 'b', token: async () => null, fetch: (async () => new Response()) as typeof fetch });
    const fake = createApi(calls, { store: new Store(makeWorld(), memoryPersister()), latencyMs: 0 });
    expectTypeOf(remote).toEqualTypeOf<MadarApi>();
    expectTypeOf(fake).toEqualTypeOf<MadarApi>();
  });

  it('groups the calls of one moment into one batch and gives back the same error codes', async () => {
    const bodies: { calls: { name: string }[] }[] = [];
    const fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { calls: { i: number; name: string }[] };
      bodies.push(body);
      return Response.json({
        v: 1,
        serverTime: '',
        results: body.calls.map((call, n) => ({ i: call.i, ok: false, error: { code: API_ERROR_CODES[n], message: 'x', details: { reason: 'r' } } })),
      });
    }) as typeof globalThis.fetch;
    const api = createRemoteApi<Calls>({ url: 'https://x', build: 'b', token: async () => 't', fetch });
    const settled = await Promise.allSettled(API_ERROR_CODES.map(() => api.call('session.get', {})));
    expect(bodies).toHaveLength(1);
    expect(settled.map((r) => ((r as PromiseRejectedResult).reason as ApiError).code)).toEqual([...API_ERROR_CODES]);
    for (const r of settled) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ApiError);
  });
});
