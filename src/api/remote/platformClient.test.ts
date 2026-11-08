import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors';
import { createPlatformClient } from './platformClient';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const make = (fetchImpl: typeof fetch, token: string | null = 'tok') => createPlatformClient({ url: 'https://madar.test/api/', build: '2026.11.8', token: async () => token, fetch: fetchImpl });

describe('the platform client', () => {
  it('sends one wire call with the bearer token and the build, and gives the output', async () => {
    const send = vi.fn(async () => reply({ v: 1, serverTime: 'x', results: [{ i: 0, ok: true, output: { owner: true, ent: 'ent_001', createOpen: false } }] }));
    const out = await make(send as unknown as typeof fetch)['platform.me']({});
    expect(out).toEqual({ owner: true, ent: 'ent_001', createOpen: false });
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://madar.test/api/platform');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'X-Madar-Build': '2026.11.8' });
    expect(JSON.parse(init.body as string)).toEqual({ v: 1, calls: [{ i: 0, name: 'platform.me', input: {} }] });
  });

  it('maps a not_found refusal of the route (a person who is no owner) to an ApiError', async () => {
    const api = make((async () => reply({ v: 1, error: { code: 'not_found', message: 'This address does not exist.' } }, 404)) as typeof fetch);
    const error = await api['platform.me']({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'not_found' });
  });

  it('maps a failed entry with its reason to an ApiError', async () => {
    const api = make((async () => reply({ v: 1, serverTime: 'x', results: [{ i: 0, ok: false, error: { code: 'invalid_input', message: 'x', details: { fields: ['address'], reason: 'address_taken' } } }] })) as typeof fetch);
    const error = await api['platform.enterprises.resume']({ id: 'ent_002' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'invalid_input', details: { reason: 'address_taken' } });
  });

  it('gives unauthenticated with no token, and failed when the network fails', async () => {
    await expect(make((async () => reply({})) as typeof fetch, null)['platform.me']({})).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(make((async () => { throw new TypeError('offline'); }) as typeof fetch)['platform.me']({})).rejects.toMatchObject({ code: 'failed', details: { cause: 'network' } });
  });

  it('has a method for each of the 8 calls', () => {
    expect(Object.keys(make((async () => reply({})) as typeof fetch))).toHaveLength(8);
  });
});
