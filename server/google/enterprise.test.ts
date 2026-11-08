import { describe, expect, it, vi } from 'vitest';
import { base64url } from '../push/vapid';
import { fakeDeps } from '../test/fakes/deps';
import { googleCallback } from './callback';
import { GOOGLE_KEY_CACHE_MAX, SealBroken, googleKeyCacheSize, googleKeysOf, openToken, sealToken } from './keys';
import * as keysModule from './keys';
import { GOOGLE_KEY, googleOffice } from './testOffice';
import { entOfState, readState, signState } from './state';

/**
 * Madar enterprises, plan D task 4 (design 5.17): the Google keys, the sealed tokens and the connect state belong to one enterprise.
 * One MADAR_GOOGLE_KEY serves all of them, so the enterprise id sits in the HKDF info text and in the state.
 */

const KEY = Buffer.alloc(32, 21).toString('base64');
const NOW = new Date('2026-11-08T06:00:00Z');
const GOOGLE = { clientId: 'id-made-up.apps.googleusercontent.com', clientSecret: 'cs-SECRET', key: KEY };
/** A token sealed for usr_003 by the code of the base commit (before this task), with this KEY. ENT_VADO must still open it. */
const FIXTURE = 'v1.b7a5MzOxmSIB_dly.QJDMe4N5Sx3FxYRO4NwGvLtmqG-CFJOgOhCcMg5W0DKi';

describe('the Google keys of an enterprise', () => {
  it('opens a token of ent_002 with the keys of ent_002 only, not with the keys of ent_001 or ENT_VADO', async () => {
    const two = await googleKeysOf(KEY, 'ent_002');
    const sealed = await sealToken(two, 'usr_003', 'rt-SECRET');
    expect(await openToken(two, 'usr_003', sealed)).toBe('rt-SECRET');
    await expect(openToken(await googleKeysOf(KEY, 'ent_001'), 'usr_003', sealed)).rejects.toBeInstanceOf(SealBroken);
    await expect(openToken(await googleKeysOf(KEY), 'usr_003', sealed)).rejects.toBeInstanceOf(SealBroken);
    await expect(openToken(await googleKeysOf(KEY, 'ent_003'), 'usr_003', sealed)).rejects.toBeInstanceOf(SealBroken);
  });

  it('keeps the old derivation for ENT_VADO: a token sealed by the base commit still opens', async () => {
    expect(await openToken(await googleKeysOf(KEY), 'usr_003', FIXTURE)).toBe('rt-FIXTURE-SECRET');
    expect(await openToken(await googleKeysOf(KEY, 'ent_001'), 'usr_003', FIXTURE)).toBe('rt-FIXTURE-SECRET');
    await expect(openToken(await googleKeysOf(KEY, 'ent_002'), 'usr_003', FIXTURE)).rejects.toBeInstanceOf(SealBroken);
  });

  it('refuses an id that is not an enterprise id', async () => {
    for (const bad of ['ENT_002', 'ent-002', 'ent_2', '', 'ent_002:x']) await expect(googleKeysOf(KEY, bad)).rejects.toThrow(/not valid/);
  });

  it('never holds more than 64 key pairs', async () => {
    const other = Buffer.alloc(32, 22).toString('base64');
    for (let n = 1; n <= GOOGLE_KEY_CACHE_MAX + 20; n += 1) await googleKeysOf(other, `ent_${String(n).padStart(3, '0')}`);
    expect(googleKeyCacheSize()).toBeLessThanOrEqual(GOOGLE_KEY_CACHE_MAX);
    // A key pair that fell out of the cache is made again and still opens what it sealed.
    const keys = await googleKeysOf(other, 'ent_005');
    expect(await openToken(keys, 'usr_001', await sealToken(keys, 'usr_001', 'x'))).toBe('x');
  });
});

describe('the connect state of an enterprise', () => {
  it('gives back the ent that signState put in', async () => {
    const keys = await googleKeysOf(KEY, 'ent_002');
    const { state } = await signState(keys, 'usr_003', NOW, 'ent_002');
    expect(await readState(keys, state, NOW)).toMatchObject({ ok: true, userId: 'usr_003', ent: 'ent_002' });
    expect(entOfState(state)).toBe('ent_002');
  });

  it('reads a state signed for ent_002 as bad under the keys of ent_001', async () => {
    const { state } = await signState(await googleKeysOf(KEY, 'ent_002'), 'usr_003', NOW, 'ent_002');
    expect(await readState(await googleKeysOf(KEY, 'ent_001'), state, NOW)).toEqual({ ok: false, why: 'bad' });
    expect(await readState(await googleKeysOf(KEY), state, NOW)).toEqual({ ok: false, why: 'bad' });
  });

  it('reads a state with no ent claim, or a claim that is no id, as bad, although the signature is right', async () => {
    const keys = await googleKeysOf(KEY);
    const signed = async (claims: object) => {
      const payload = base64url(new TextEncoder().encode(JSON.stringify(claims)));
      const mac = new Uint8Array(await crypto.subtle.sign('HMAC', keys.sign, new TextEncoder().encode(`state:${payload}`)));
      return `${payload}.${base64url(mac)}`;
    };
    const base = { u: 'usr_003', n: 'abc', e: Math.floor(NOW.getTime() / 1000) + 600 };
    expect(await readState(keys, await signed(base), NOW)).toEqual({ ok: false, why: 'bad' });
    expect(await readState(keys, await signed({ ...base, ent: 'ENT_001' }), NOW)).toEqual({ ok: false, why: 'bad' });
    expect(await readState(keys, await signed({ ...base, ent: 7 }), NOW)).toEqual({ ok: false, why: 'bad' });
    expect(entOfState(await signed(base))).toBeNull();
    expect(entOfState(await signed({ ...base, ent: 'x' }))).toBeNull();
  });

  it('reads the ent claim of a text that is no state as null', () => {
    for (const text of ['', 'plain', 'a.b', 'a.b.c', '.', 'e30.AAAA', 'eyJhbGciOiJFUzI1NiJ9.e30.AAAA']) expect(entOfState(text)).toBeNull();
  });
});

describe('the callback of an enterprise', () => {
  const setup = (listed?: (ent: string) => Promise<boolean>) => {
    const deps = fakeDeps({ config: { appUrl: 'https://madar.example', google: GOOGLE } });
    deps.clock.set(NOW);
    const call = async (state: string) => {
      const answer = await googleCallback(new Request(`https://madar.example/api/google/callback?code=code-1&state=${encodeURIComponent(state)}`), deps, listed ? { listed } : {});
      return answer.headers.get('location');
    };
    return { deps, call };
  };
  const stateOf = async (ent: string) => (await signState(await googleKeysOf(KEY, ent), 'usr_003', NOW, ent)).state;

  it('finishes a state of a listed enterprise', async () => {
    const { call } = setup(async (ent) => ent === 'ent_002');
    const state = await stateOf('ent_002');
    expect(await call(state)).toBe(`https://madar.example/settings#google=finish&code=code-1&state=${encodeURIComponent(state)}`);
  });

  it('answers failed for an unlisted ent and derives no key for it', async () => {
    const spy = vi.spyOn(keysModule, 'googleKeysOf');
    try {
      const { call } = setup(async (ent) => ent === 'ent_001');
      const state = await stateOf('ent_009');
      spy.mockClear();
      expect(await call(state)).toBe('https://madar.example/settings#google=failed');
      expect(spy).not.toHaveBeenCalled();
      // The control: a listed enterprise does derive its keys, so the spy sees the call (the check above is not empty).
      const listed = setup(async () => true);
      await listed.call(state);
      expect(spy).toHaveBeenCalledWith(KEY, 'ent_009');
    } finally {
      spy.mockRestore();
    }
  });

  it('answers failed for an ent text that is not an enterprise id, for a state with no ent, and for a state of another enterprise, with the same word', async () => {
    const { call } = setup(async () => true);
    const failed = 'https://madar.example/settings#google=failed';
    const keys = await googleKeysOf(KEY);
    const signed = async (claims: object) => {
      const payload = base64url(new TextEncoder().encode(JSON.stringify(claims)));
      const mac = new Uint8Array(await crypto.subtle.sign('HMAC', keys.sign, new TextEncoder().encode(`state:${payload}`)));
      return `${payload}.${base64url(mac)}`;
    };
    const base = { u: 'usr_003', n: 'abc', e: Math.floor(NOW.getTime() / 1000) + 600 };
    expect(await call(await signed({ ...base, ent: 'ENT_001' }))).toBe(failed);
    expect(await call(await signed(base))).toBe(failed);
    // The claim says ent_002, but the signature is the one of ent_001: the keys of ent_002 do not verify it.
    expect(await call(await signed({ ...base, ent: 'ent_002' }))).toBe(failed);
    expect(await call('plain-text-not-a-state')).toBe(failed);
  });

  it('without a list, still checks the signature with the keys of the named enterprise', async () => {
    const { call } = setup();
    const state = await stateOf('ent_004');
    expect(await call(state)).toContain('google=finish');
  });
});

describe('google.connect in an enterprise', () => {
  it('signs the state with the keys of its enterprise, and seals the token with them', async () => {
    const t = await googleOffice({ ent: 'ent_002' });
    const start = await t.call('usr_003', 'google.connectStart', {});
    if (!start.ok) throw new Error('connectStart failed');
    const state = new URL((start.output as { url: string }).url).searchParams.get('state')!;
    expect(entOfState(state)).toBe('ent_002');
    expect(await readState(await googleKeysOf(GOOGLE_KEY, 'ent_002'), state, t.deps.clock.now())).toMatchObject({ ok: true, ent: 'ent_002' });
    expect(await readState(await googleKeysOf(GOOGLE_KEY), state, t.deps.clock.now())).toEqual({ ok: false, why: 'bad' });
    expect((await t.connect('usr_003')).ok).toBe(true);
    const [row] = (await t.db.statement('read', 'select sealed_token from google_connections')) as { sealed_token: string }[];
    expect(await openToken(await googleKeysOf(GOOGLE_KEY, 'ent_002'), 'usr_003', row.sealed_token)).toBeTruthy();
    await expect(openToken(await googleKeysOf(GOOGLE_KEY), 'usr_003', row.sealed_token)).rejects.toBeInstanceOf(SealBroken);
  });

  it('refuses a state whose ent differs from the ent of the deps, with the word of an old state (google_link_old)', async () => {
    const t = await googleOffice();
    // The signature is right for ent_001, but the claim names ent_002.
    const { state } = await signState(await googleKeysOf(GOOGLE_KEY), 'usr_003', t.deps.clock.now(), 'ent_002');
    expect(await t.call('usr_003', 'google.connect', { code: 'code-SECRET', state })).toMatchObject({ ok: false, error: { code: 'invalid_input', details: { reason: 'google_link_old' } } });
    expect(t.google.requests).toEqual([]);
    // A state signed under the keys of ent_002 fails the signature of ent_001: the same word.
    const other = await signState(await googleKeysOf(GOOGLE_KEY, 'ent_002'), 'usr_003', t.deps.clock.now(), 'ent_002');
    expect(await t.call('usr_003', 'google.connect', { code: 'code-SECRET', state: other.state })).toMatchObject({ ok: false, error: { details: { reason: 'google_link_old' } } });
  });
});
