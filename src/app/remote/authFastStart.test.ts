import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Calls } from '../../api/calls';
import { createRemoteApi } from '../../api/remote/remoteApi';
import type { SessionListener } from '../../features/auth/sessionEnd';
import type { AuthPort } from '../auth';
import { createSupabaseAuth } from './auth';

/**
 * The fast start of the Supabase port (performance audit 2026-10-21, GP-1). The access token lives 15 minutes. A page that opens
 * after that used to wait for the renewal (one CORS preflight and one refresh POST) before the first frame. Now a stored refresh
 * token means signed in at once, and the renewal runs beside the first frame.
 */
type StubSession = { access_token: string; refresh_token?: string; user?: { id: string; email?: string } };
type Listener = (event: string, session: StubSession | null) => void;
type Answer = { data: { session: StubSession | null }; error: unknown };

const KEY = 'madar.auth';
const stored = (userId = 'auth-1') => JSON.stringify({ access_token: 'old-token', refresh_token: 'refresh-1', expires_at: 1, user: { id: userId } });
const apiUrl = 'https://api.test/functions/v1/api';

/** A client whose getSession answers only when the test says so: the renewal "on the wire". */
function heldClient() {
  let listener: Listener = () => undefined;
  const waiting: Array<(value: Answer) => void> = [];
  const auth = {
    // Before the answer a call waits. After it, a later call gets the same answer, as supabase-js gives the stored result.
    getSession: vi.fn(() => (last ? Promise.resolve(last) : new Promise<Answer>((resolve) => { waiting.push(resolve); }))),
    onAuthStateChange: vi.fn((callback: Listener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: () => undefined } } };
    }),
  };
  const client = { auth, removeAllChannels: vi.fn(async () => []) } as unknown as SupabaseClient;
  let last: Answer | null = null;
  const answerAll = (value: Answer) => {
    last = value;
    for (const resolve of waiting.splice(0)) resolve(value);
  };
  return {
    client,
    auth,
    asked: () => auth.getSession.mock.calls.length,
    /** The renewal answers with a new session. */
    renew: (session: StubSession) => answerAll({ data: { session }, error: null }),
    /** The renewal answers with no session: a dead refresh token (Auth answers 400 and Supabase removes the session) or no network. */
    fail: (error: unknown = { name: 'AuthApiError', code: 'refresh_token_not_found', status: 400 }) => answerAll({ data: { session: null }, error }),
    fire: (event: string, session: StubSession | null) => listener(event, session),
  };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

/** The status changes that the port tells, each with its reason. */
function watch(auth: AuthPort): Array<[string, string | undefined]> {
  const seen: Array<[string, string | undefined]> = [];
  (auth.subscribe as (listener: SessionListener) => () => void)((status, change) => { seen.push([status, change]); });
  return seen;
}

/** True when the promise settles within a short wait. */
const settled = (promise: Promise<unknown>) => Promise.race([promise.then(() => true, () => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 40))]);
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

describe('the fast start of the Supabase port (GP-1)', () => {
  it('is signed in before the renewal answers, with the auth user of the stored session', async () => {
    window.localStorage.setItem(KEY, stored('auth-7'));
    const held = heldClient();
    const port = createSupabaseAuth(held.client, { apiUrl });
    expect(await settled(port)).toBe(true);
    const auth = await port;
    expect(auth.status()).toBe('signed_in');
    expect(auth.userId?.()).toBe('auth-7');
    // The renewal is asked, and nothing waits for it.
    expect(held.asked()).toBe(1);
  });

  it('keeps the old wait when no session is stored, and then follows the answer', async () => {
    const held = heldClient();
    const port = createSupabaseAuth(held.client, { apiUrl });
    expect(await settled(port)).toBe(false);
    held.renew({ access_token: 'token-1', user: { id: 'auth-1' } });
    expect((await port).status()).toBe('signed_in');
  });

  it('gives a person with no stored session the signed out status, as before', async () => {
    const held = heldClient();
    const port = createSupabaseAuth(held.client, { apiUrl });
    held.renew(null as unknown as StubSession);
    const auth = await port;
    expect(auth.status()).toBe('signed_out');
    expect(auth.userId?.()).toBeNull();
  });

  it('takes the old path for a stored value that holds no refresh token, no user, or no JSON', async () => {
    for (const value of ['not json', '{}', '{"access_token":"a","user":{"id":"x"}}', '{"refresh_token":"r"}', '{"refresh_token":"","user":{"id":"x"}}', 'null', '[]']) {
      window.localStorage.setItem(KEY, value);
      const held = heldClient();
      const port = createSupabaseAuth(held.client, { apiUrl });
      expect(await settled(port), value).toBe(false);
      held.renew(null as unknown as StubSession);
      await port;
    }
  });

  it('takes the old path when storage throws (Safari can refuse it)', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const held = heldClient();
    const port = createSupabaseAuth(held.client, { apiUrl });
    expect(await settled(port)).toBe(false);
    held.renew({ access_token: 'token-1', user: { id: 'auth-1' } });
    expect((await port).status()).toBe('signed_in');
    spy.mockRestore();
  });

  it('gives the new token to the first batch: accessToken waits for the renewal', async () => {
    window.localStorage.setItem(KEY, stored());
    const held = heldClient();
    const auth = await createSupabaseAuth(held.client, { apiUrl });
    const token = auth.accessToken();
    expect(await settled(token)).toBe(false);
    held.renew({ access_token: 'new-token', user: { id: 'auth-1' } });
    expect(await token).toBe('new-token');
    expect(auth.status()).toBe('signed_in');
  });

  it('sends nothing with a dead token: after a failed renewal accessToken gives null', async () => {
    window.localStorage.setItem(KEY, stored());
    const held = heldClient();
    const auth = await createSupabaseAuth(held.client, { apiUrl });
    const token = auth.accessToken();
    held.fail();
    expect(await token).toBeNull();
  });

  it('the first batch of the API carries the new token, and a dead token sends no request', async () => {
    const sent: string[] = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push(String((init?.headers as Record<string, string>).Authorization));
      const body = JSON.parse(String(init?.body)) as { calls: Array<{ i: number }> };
      return new Response(JSON.stringify({ v: 1, serverTime: '2026-10-03T09:00:00.000+03:00', results: body.calls.map((call) => ({ i: call.i, ok: true, output: {} })) }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const apiFor = async (held: ReturnType<typeof heldClient>) => {
      const auth = await createSupabaseAuth(held.client, { apiUrl });
      return createRemoteApi<Calls>({ url: apiUrl, build: 'test', token: () => auth.accessToken(), fetch });
    };

    window.localStorage.setItem(KEY, stored());
    const alive = heldClient();
    const call = (await apiFor(alive)).call('session.get', {});
    await tick();
    expect(sent).toEqual([]);
    alive.renew({ access_token: 'new-token', user: { id: 'auth-1' } });
    await call;
    expect(sent).toEqual(['Bearer new-token']);

    sent.length = 0;
    const dead = heldClient();
    const refused = (await apiFor(dead)).call('session.get', {});
    dead.fail();
    await expect(refused).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(sent).toEqual([]);
  });

  it('a dead refresh token (the session is removed) tells signed out once, as an unrenewed start', async () => {
    window.localStorage.setItem(KEY, stored());
    const held = heldClient();
    const auth = await createSupabaseAuth(held.client, { apiUrl });
    const seen = watch(auth);
    // auth-js removes the session, tells SIGNED_OUT, and getSession answers with no session.
    held.fire('SIGNED_OUT', null);
    held.fail();
    await tick();
    expect(auth.status()).toBe('signed_out');
    expect(auth.userId?.()).toBeNull();
    expect(seen).toEqual([['signed_out', 'unrenewed']]);
  });

  it('a renewal that fails without an event (no network) also tells signed out, as before the change', async () => {
    window.localStorage.setItem(KEY, stored());
    const held = heldClient();
    const auth = await createSupabaseAuth(held.client, { apiUrl });
    const seen = watch(auth);
    held.fail({ name: 'AuthRetryableFetchError', status: 0 });
    await tick();
    expect(auth.status()).toBe('signed_out');
    expect(seen).toEqual([['signed_out', 'unrenewed']]);
  });

  it('a renewal that works tells nothing, and a later end of the session is a plain end', async () => {
    window.localStorage.setItem(KEY, stored());
    const held = heldClient();
    const auth = await createSupabaseAuth(held.client, { apiUrl });
    const seen = watch(auth);
    held.renew({ access_token: 'new-token', user: { id: 'auth-1' } });
    await tick();
    expect(seen).toEqual([]);
    held.fire('SIGNED_OUT', null);
    expect(seen).toEqual([['signed_out', undefined]]);
  });

  it('a sign-out on purpose in another tab during the renewal is still a sign-out on purpose', async () => {
    window.localStorage.setItem(KEY, stored());
    window.localStorage.setItem('madar.auth.leaving', '1');
    const held = heldClient();
    const auth = await createSupabaseAuth(held.client, { apiUrl });
    const seen = watch(auth);
    held.fire('SIGNED_OUT', null);
    expect(seen).toEqual([['signed_out', 'left']]);
  });
});
