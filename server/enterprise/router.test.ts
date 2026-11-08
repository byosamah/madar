import { describe, expect, it } from 'vitest';
import type { OfficeStub } from '../entries/officeWorker';
import { entRouter, LISTED_MISS_MS, LISTED_TTL_MS, mcpAddressOf } from './router';

function setup(o: { ids?: string[]; addresses?: Record<string, string> } = {}) {
  const state = { ids: o.ids ?? ['ent_001', 'ent_002'], addresses: o.addresses ?? { globex: 'ent_002' }, clock: 1_000_000 };
  const seen = { stubFor: [] as string[], listed: 0, resolved: [] as string[] };
  const router = entRouter({
    stubFor: (ent) => (seen.stubFor.push(ent), { ent } as unknown as OfficeStub),
    platform: {
      listed: async () => (seen.listed += 1, [...state.ids]),
      resolveAddress: async ({ address }) => (seen.resolved.push(address), state.addresses[address] ? { ent: state.addresses[address] } : null),
    },
    now: () => state.clock,
  });
  return { state, seen, router };
}

describe('the enterprise router', () => {
  it('stubFor is never called for an id that the platform does not list', async () => {
    const { router, seen } = setup();
    expect(await router.listedStub('ent_009')).toBeNull();
    expect(seen.stubFor).toEqual([]);
    expect(await router.listedStub('ent_002')).toMatchObject({ ent: 'ent_002' });
    expect(seen.stubFor).toEqual(['ent_002']);
  });

  it('a malformed id never reaches the platform', async () => {
    const { router, seen } = setup();
    for (const bad of ['ENT_001', 'ent_01', 'ent_001.x', 5, null, undefined, '', 'a'.repeat(5000)]) expect(await router.listedStub(bad)).toBeNull();
    expect(seen.listed).toBe(0);
    expect(seen.stubFor).toEqual([]);
  });

  it('stub gives the object of a verified id with no platform read', () => {
    const { router, seen } = setup();
    router.stub('ent_005');
    expect(seen.stubFor).toEqual(['ent_005']);
    expect(seen.listed).toBe(0);
  });

  it('keeps the list for 60 s and reads it once', async () => {
    const { router, seen, state } = setup();
    await router.listedStub('ent_001');
    state.clock += 10_000;
    await router.listedStub('ent_002');
    await router.listedStub('ent_001');
    expect(seen.listed).toBe(1);
    state.clock += LISTED_TTL_MS;
    await router.listedStub('ent_001');
    expect(seen.listed).toBe(2);
  });

  it('a miss reads the list again when the list is 5 s old, and does not when it is 1 s old', async () => {
    const { router, seen, state } = setup();
    await router.listedStub('ent_001');
    state.ids.push('ent_003');
    state.clock += 1_000;
    expect(await router.listedStub('ent_003')).toBeNull();
    expect(seen.listed).toBe(1);
    state.clock += LISTED_MISS_MS;
    expect(await router.listedStub('ent_003')).toMatchObject({ ent: 'ent_003' });
    expect(seen.listed).toBe(2);
  });

  it('a flood of bad ids reads the list at most once in 5 s', async () => {
    const { router, seen } = setup();
    for (let i = 0; i < 30; i += 1) await router.listedStub(`ent_9${String(i).padStart(2, '0')}`);
    expect(seen.listed).toBe(1);
  });

  it('an address resolves through the platform and is kept for 60 s; a reserved or malformed address never reaches the platform', async () => {
    const { router, seen, state } = setup();
    expect(await router.addressStub('globex')).toMatchObject({ ent: 'ent_002' });
    expect(await router.addressStub('globex')).toMatchObject({ ent: 'ent_002' });
    expect(seen.resolved).toEqual(['globex']);
    state.clock += LISTED_TTL_MS;
    await router.addressStub('globex');
    expect(seen.resolved).toEqual(['globex', 'globex']);
    for (const bad of ['oauth', 'Globex', 'a', '-ab', 'mcp', 5, null, undefined, 'x'.repeat(40)]) expect(await router.addressStub(bad)).toBeNull();
    expect(seen.resolved).toHaveLength(2);
  });

  it('an unknown address gives null, makes no stub, and asks the platform again only after 5 s', async () => {
    const { router, seen, state } = setup();
    expect(await router.addressStub('nope')).toBeNull();
    expect(await router.addressStub('nope')).toBeNull();
    expect(seen.resolved).toEqual(['nope']);
    state.clock += LISTED_MISS_MS;
    expect(await router.addressStub('nope')).toBeNull();
    expect(seen.resolved).toEqual(['nope', 'nope']);
    expect(seen.stubFor).toEqual([]);
  });
});

describe('mcpAddressOf', () => {
  it('gives no address for /mcp and for the path words of the VADO address', () => {
    expect(mcpAddressOf('/mcp')).toEqual({ address: null, rest: '/mcp' });
    expect(mcpAddressOf('/mcp/')).toEqual({ address: null, rest: '/mcp' });
    expect(mcpAddressOf('/mcp/oauth/token')).toEqual({ address: null, rest: '/mcp/oauth/token' });
    expect(mcpAddressOf('/mcp/oauth')).toEqual({ address: null, rest: '/mcp/oauth' });
    expect(mcpAddressOf('/mcp/.well-known/oauth-authorization-server')).toEqual({ address: null, rest: '/mcp/.well-known/oauth-authorization-server' });
    expect(mcpAddressOf('/mcp/oauth-protected-resource')).toEqual({ address: null, rest: '/mcp/oauth-protected-resource' });
    expect(mcpAddressOf('/mcp/globex/oauth-protected-resource')).toEqual({ address: 'globex', rest: '/mcp/oauth-protected-resource' });
  });

  it('takes the address out of the path and keeps the rest', () => {
    expect(mcpAddressOf('/mcp/globex')).toEqual({ address: 'globex', rest: '/mcp' });
    expect(mcpAddressOf('/mcp/globex/')).toEqual({ address: 'globex', rest: '/mcp/' });
    expect(mcpAddressOf('/mcp/globex/oauth/token')).toEqual({ address: 'globex', rest: '/mcp/oauth/token' });
    expect(mcpAddressOf('/mcp/globex/.well-known/openid-configuration')).toEqual({ address: 'globex', rest: '/mcp/.well-known/openid-configuration' });
    expect(mcpAddressOf('/mcp/vados')).toEqual({ address: 'vados', rest: '/mcp' });
  });

  it('gives bad for a capital, one letter, an encoded letter, a reserved word, a path outside /mcp and a very long name', () => {
    for (const path of ['/mcp/Globex', '/mcp/a', '/mcp/g%6Cobex', '/mcp/mcp', '/mcp/api/x', '/mcp/-ab', '/mcp/ab-', '/other', '/mcpx', '', '/mcp/' + 'a'.repeat(5000)]) {
      expect(mcpAddressOf(path), path).toBe('bad');
    }
  });
});
