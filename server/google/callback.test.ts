import { describe, expect, it } from 'vitest';
import type { Db } from '../core/ports';
import { fakeDeps } from '../test/fakes/deps';
import { GOOGLE_CALLBACK_PATH, GOOGLE_CALLBACK_ROUTE, googleCallback } from './callback';
import { googleKeysOf } from './keys';
import { signState, STATE_LIFE_MS } from './state';

/** The callback route of Google (fbk_022): it checks the signed state and hands the code to the Settings screen in the fragment. */

const KEY = Buffer.alloc(32, 11).toString('base64');
const GOOGLE = { clientId: 'id-made-up.apps.googleusercontent.com', clientSecret: 'cs-SECRET', key: KEY };
const NOW = new Date('2026-10-21T06:00:00Z');

/** A Db that throws on any statement: the route must read nothing. */
const throwingDb: Db = {
  async tx() { throw new Error('The callback route must not open a transaction.'); },
  async savepoint() { throw new Error('The callback route must not open a savepoint.'); },
  async statement() { throw new Error('The callback route must not run a statement.'); },
};

function setup(o: { google?: boolean } = {}) {
  const deps = fakeDeps({ db: throwingDb, config: { appUrl: 'https://madar.example/', ...(o.google === false ? {} : { google: GOOGLE }) } });
  deps.clock.set(NOW);
  const call = (query: string) => googleCallback(new Request(`https://madar.example/api/google/callback${query}`), deps);
  return { deps, call };
}
const goodState = async (at = NOW) => (await signState(await googleKeysOf(KEY), 'usr_003', at)).state;

describe('the callback route', () => {
  it('is a GET at /google/callback', () => {
    expect(GOOGLE_CALLBACK_PATH).toBe('/google/callback');
    expect([GOOGLE_CALLBACK_ROUTE.method, GOOGLE_CALLBACK_ROUTE.path]).toEqual(['GET', '/google/callback']);
  });

  it('answers 302 to the Settings screen with the word failed when the code or the state is missing', async () => {
    const { call } = setup();
    for (const query of ['', '?code=abc', `?state=${await goodState()}`, '?code=&state=']) {
      const answer = await call(query);
      expect([answer.status, answer.headers.get('location')], query).toEqual([302, 'https://madar.example/settings#google=failed']);
    }
  });

  it('gives denied for an error in the query, also with a code', async () => {
    const { call } = setup();
    expect((await call('?error=access_denied&state=x')).headers.get('location')).toBe('https://madar.example/settings#google=denied');
    expect((await call(`?error=access_denied&code=abc&state=${await goodState()}`)).headers.get('location')).toBe('https://madar.example/settings#google=denied');
  });

  it('gives not_ready when the copy has no Google values', async () => {
    const { call } = setup({ google: false });
    expect((await call(`?code=abc&state=${await goodState()}`)).headers.get('location')).toBe('https://madar.example/settings#google=not_ready');
  });

  it('gives failed for a state that is not true, and old for a true state past 10 minutes', async () => {
    const { call, deps } = setup();
    const state = await goodState();
    expect((await call(`?code=abc&state=${state}x`)).headers.get('location')).toBe('https://madar.example/settings#google=failed');
    expect((await call('?code=abc&state=plain-text')).headers.get('location')).toBe('https://madar.example/settings#google=failed');
    deps.clock.advance(STATE_LIFE_MS + 1_000);
    expect((await call(`?code=abc&state=${state}`)).headers.get('location')).toBe('https://madar.example/settings#google=old');
  });

  it('gives finish with the code and the state, URL encoded, only after the hash, for a true state', async () => {
    const { call } = setup();
    const state = await goodState();
    const answer = await call(`?code=4%2F0AbC%2Bd&state=${state}`);
    const location = answer.headers.get('location')!;
    expect(location).toBe(`https://madar.example/settings#google=finish&code=${encodeURIComponent('4/0AbC+d')}&state=${encodeURIComponent(state)}`);
    expect(location.split('#')[0]).toBe('https://madar.example/settings');
    expect(location.split('#')[0]).not.toContain('code');
  });

  it('refuses a code or a state longer than google.connect takes', async () => {
    const { call } = setup();
    expect((await call(`?code=${'a'.repeat(513)}&state=${await goodState()}`)).headers.get('location')).toBe('https://madar.example/settings#google=failed');
    expect((await call(`?code=abc&state=${'a'.repeat(1025)}`)).headers.get('location')).toBe('https://madar.example/settings#google=failed');
  });

  it('sends no-store and no-referrer with every answer, and no body', async () => {
    const { call } = setup();
    for (const query of ['', `?code=abc&state=${await goodState()}`, '?error=access_denied']) {
      const answer = await call(query);
      expect(answer.headers.get('cache-control')).toBe('no-store');
      expect(answer.headers.get('referrer-policy')).toBe('no-referrer');
      expect(await answer.text()).toBe('');
    }
  });

  it('logs the word only: no line holds the code, the state or the query', async () => {
    const { call, deps } = setup();
    const state = await goodState();
    await call(`?code=code-SECRET&state=${state}`);
    await call('?error=access_denied&code=code-SECRET');
    await call('?code=code-SECRET&state=bad');
    expect(deps.logs).toHaveLength(3);
    expect(deps.logs.map((line) => line.fields)).toEqual([{ word: 'finish' }, { word: 'denied' }, { word: 'failed' }]);
    const text = JSON.stringify(deps.logs);
    for (const secret of ['code-SECRET', state, 'cs-SECRET', KEY]) expect(text).not.toContain(secret);
  });

  it('reads nothing and writes nothing: a Db that throws on any statement is never touched', async () => {
    const { call } = setup();
    await expect(call(`?code=abc&state=${await goodState()}`)).resolves.toMatchObject({ status: 302 });
  });
});
