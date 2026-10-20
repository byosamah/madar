import { describe, expect, it } from 'vitest';
import { googleKeysOf } from './keys';
import { STATE_LIFE_MS, challengeOf, readState, signState } from './state';

/** The signed state of the Google connect (fbk_022): it ties the Google screen to one person, one time, and carries the PKCE verifier. */

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const NOW = new Date('2026-10-21T09:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

describe('challengeOf', () => {
  it('follows RFC 7636 appendix B: S256 of the example verifier', async () => {
    expect(await challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('signState and readState', () => {
  it('gives back the same person and a verifier whose S256 is the challenge', async () => {
    const keys = await googleKeysOf(KEY);
    const { state, challenge } = await signState(keys, 'usr_003', NOW);
    const read = await readState(keys, state, NOW);
    expect(read).toMatchObject({ ok: true, userId: 'usr_003' });
    if (!read.ok) throw new Error('unreachable');
    expect(read.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await challengeOf(read.verifier)).toBe(challenge);
  });

  it('makes a new state each time (a new nonce), with the same shape', async () => {
    const keys = await googleKeysOf(KEY);
    const a = await signState(keys, 'usr_003', NOW);
    const b = await signState(keys, 'usr_003', NOW);
    expect(a.state).not.toBe(b.state);
    expect(a.challenge).not.toBe(b.challenge);
    expect(a.state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('is valid for 10 minutes and old after 10 minutes and 1 second', async () => {
    expect(STATE_LIFE_MS).toBe(600_000);
    const keys = await googleKeysOf(KEY);
    const { state } = await signState(keys, 'usr_003', NOW);
    expect((await readState(keys, state, later(STATE_LIFE_MS))).ok).toBe(true);
    expect(await readState(keys, state, later(STATE_LIFE_MS + 1_000))).toEqual({ ok: false, why: 'old' });
  });

  it('gives bad for one changed character, in the payload or in the signature', async () => {
    const keys = await googleKeysOf(KEY);
    const { state } = await signState(keys, 'usr_003', NOW);
    const flip = (text: string, at: number) => `${text.slice(0, at)}${text[at] === 'A' ? 'B' : 'A'}${text.slice(at + 1)}`;
    expect(await readState(keys, flip(state, 3), NOW)).toEqual({ ok: false, why: 'bad' });
    expect(await readState(keys, flip(state, state.length - 3), NOW)).toEqual({ ok: false, why: 'bad' });
  });

  it('gives bad for a state of another key, and for text that is no state', async () => {
    const keys = await googleKeysOf(KEY);
    const { state } = await signState(await googleKeysOf(OTHER_KEY), 'usr_003', NOW);
    expect(await readState(keys, state, NOW)).toEqual({ ok: false, why: 'bad' });
    for (const text of ['', 'abc', 'a.b.c', '.', 'eyJ1IjoidXNyXzAwMyJ9.AAAA', '%%%.%%%']) {
      expect(await readState(keys, text, NOW), text).toEqual({ ok: false, why: 'bad' });
    }
  });

  it('gives bad (not old) for a state that is both changed and old', async () => {
    const keys = await googleKeysOf(KEY);
    const { state } = await signState(keys, 'usr_003', NOW);
    expect(await readState(keys, `${state}x`, later(STATE_LIFE_MS * 3))).toEqual({ ok: false, why: 'bad' });
  });

  it('holds no secret in the state: the payload shows the person, a nonce and an expiry only', async () => {
    const keys = await googleKeysOf(KEY);
    const { state } = await signState(keys, 'usr_003', NOW);
    const payload = JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['e', 'n', 'u']);
    expect(payload.u).toBe('usr_003');
  });
});
