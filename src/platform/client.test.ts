import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { createPlatformSite, createSessionStore, PLATFORM_SESSION_KEY, PlatformSignInFailure } from './client';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const ACCOUNT = { id: 'pla_001', name: 'Osama', email: 'osama@example.test' };
const tokens = (n: number) => ({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 900, account: ACCOUNT });
const entry = (output: unknown) => json({ v: 1, serverTime: 'x', results: [{ i: 0, ok: true, output }] });
const refused = (status: number, reason?: string) => json({ error: { code: 'unauthenticated', message: 'x', ...(reason ? { details: { reason } } : {}) } }, status);

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };
function make(handler: (call: Call) => Response | Promise<Response>, o: { start?: number } = {}) {
  const calls: Call[] = [];
  let at = o.start ?? 1_000_000;
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {}, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof globalThis.fetch;
  const store = createSessionStore(window.localStorage);
  const site = createPlatformSite({ base: '/api', build: '2026.11.8', fetch, store, now: () => at, withLock: async (run) => run() });
  return { calls, site, store, fetch, tick: (ms: number) => { at += ms; } };
}

describe('the session store', () => {
  it('keeps the session under madar.platform.session and gives it back', () => {
    const store = createSessionStore(window.localStorage);
    expect(store.read()).toBeNull();
    store.write({ access: 'a', refresh: 'r', expiresAt: 5, account: ACCOUNT });
    expect(JSON.parse(window.localStorage.getItem(PLATFORM_SESSION_KEY)!)).toMatchObject({ access: 'a', refresh: 'r' });
    expect(createSessionStore(window.localStorage).read()).toMatchObject({ access: 'a', account: ACCOUNT });
    store.write(null);
    expect(window.localStorage.getItem(PLATFORM_SESSION_KEY)).toBeNull();
  });

  it('reads a broken record as no session', () => {
    window.localStorage.setItem(PLATFORM_SESSION_KEY, '{"access":1}');
    expect(createSessionStore(window.localStorage).read()).toBeNull();
    window.localStorage.setItem(PLATFORM_SESSION_KEY, 'not json');
    expect(createSessionStore(window.localStorage).read()).toBeNull();
  });

  it('works in memory when the storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    const store = createSessionStore(blocked);
    store.write({ access: 'a', refresh: 'r', expiresAt: 5, account: ACCOUNT });
    expect(store.read()).toMatchObject({ access: 'a' });
  });

  it('keeps the memory copy when only the write is refused', () => {
    const half = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => undefined } as unknown as Storage;
    const store = createSessionStore(half);
    store.write({ access: 'a', refresh: 'r', expiresAt: 5, account: ACCOUNT });
    expect(store.read()).toMatchObject({ access: 'a' });
  });

  it('gives the same object for the same stored text', () => {
    const store = createSessionStore(window.localStorage);
    store.write({ access: 'a', refresh: 'r', expiresAt: 5, account: ACCOUNT });
    expect(store.read()).toBe(store.read());
  });

  it('tells a listener about a change', () => {
    const store = createSessionStore(window.localStorage);
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    store.write({ access: 'a', refresh: 'r', expiresAt: 5, account: ACCOUNT });
    store.write(null);
    stop();
    store.write(null);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('sign in', () => {
  it('posts the password grant to /api/platform/auth/token and keeps the session', async () => {
    const t = make(() => json(tokens(1)));
    const account = await t.site.signIn(' osama@example.test ', 'a long password');
    expect(account).toEqual(ACCOUNT);
    expect(t.calls[0].url).toBe('/api/platform/auth/token');
    expect(t.calls[0].init.method).toBe('POST');
    expect(t.calls[0].body).toEqual({ grant_type: 'password', email: 'osama@example.test', password: 'a long password' });
    expect(t.site.session()).toMatchObject({ access: 'access-1', refresh: 'refresh-1', expiresAt: 1_000_000 + 900_000, account: ACCOUNT });
  });

  it('gives wrong_credentials for invalid_credentials and for account_off, the same for both', async () => {
    for (const reason of ['invalid_credentials', 'account_off']) {
      const t = make(() => refused(401, reason));
      const failure = await t.site.signIn('a@b.test', 'x').catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(PlatformSignInFailure);
      expect(failure).toMatchObject({ reason: 'wrong_credentials' });
      expect(t.site.session()).toBeNull();
    }
  });

  it('gives too_many for 429, offline for a network failure and failed for anything else', async () => {
    expect(await make(() => json({ error: { code: 'failed', message: 'x' } }, 429, { 'Retry-After': '60' })).site.signIn('a@b.test', 'x').catch((e: unknown) => e)).toMatchObject({ reason: 'too_many' });
    expect(await make(() => { throw new TypeError('offline'); }).site.signIn('a@b.test', 'x').catch((e: unknown) => e)).toMatchObject({ reason: 'offline' });
    expect(await make(() => json({}, 500)).site.signIn('a@b.test', 'x').catch((e: unknown) => e)).toMatchObject({ reason: 'failed' });
    expect(await make(() => json({ nothing: true })).site.signIn('a@b.test', 'x').catch((e: unknown) => e)).toMatchObject({ reason: 'failed' });
  });
});

describe('the platform calls', () => {
  const signedIn = async (handler: (call: Call) => Response | Promise<Response>) => {
    let first = true;
    const t = make((call) => {
      if (call.url.endsWith('/auth/token') && first) { first = false; return json(tokens(1)); }
      return handler(call);
    });
    await t.site.signIn('osama@example.test', 'a long password');
    t.calls.length = 0;
    return t;
  };

  it('sends one wire call to /api/platform with the bearer token and the build, and gives the output', async () => {
    const t = await signedIn(() => entry({ createOpen: false }));
    expect(await t.site.api['platform.me']({})).toEqual({ createOpen: false });
    expect(t.calls[0].url).toBe('/api/platform');
    expect(t.calls[0].init.headers).toMatchObject({ Authorization: 'Bearer access-1', 'X-Madar-Build': '2026.11.8' });
    expect(t.calls[0].body).toEqual({ v: 1, calls: [{ i: 0, name: 'platform.me', input: {} }] });
  });

  it('maps a failed entry with its reason to an ApiError', async () => {
    const t = await signedIn(() => json({ v: 1, serverTime: 'x', results: [{ i: 0, ok: false, error: { code: 'invalid_input', message: 'x', details: { fields: ['address'], reason: 'address_taken' } } }] }));
    const error = await t.site.api['platform.enterprises.resume']({ id: 'ent_002' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'invalid_input', details: { reason: 'address_taken' } });
  });

  it('gives unauthenticated with no session, and sends nothing', async () => {
    const t = make(() => entry({}));
    await expect(t.site.api['platform.me']({})).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(t.calls).toEqual([]);
  });

  it('gives failed with the cause network when the network fails, and keeps the session', async () => {
    const t = await signedIn(() => { throw new TypeError('offline'); });
    await expect(t.site.api['platform.me']({})).rejects.toMatchObject({ code: 'failed', details: { cause: 'network' } });
    expect(t.site.session()).not.toBeNull();
  });

  it('refreshes before a call when the access token is about to end, with the refresh token, and keeps the new pair', async () => {
    const t = await signedIn((call) => (call.url.endsWith('/auth/token') ? json(tokens(2)) : entry({ ok: 1 })));
    t.tick(900_000 - 10_000);
    await t.site.api['platform.me']({});
    expect(t.calls.map((c) => c.url)).toEqual(['/api/platform/auth/token', '/api/platform']);
    expect(t.calls[0].body).toEqual({ grant_type: 'refresh_token', refresh_token: 'refresh-1' });
    expect(t.calls[1].init.headers).toMatchObject({ Authorization: 'Bearer access-2' });
    expect(t.site.session()).toMatchObject({ access: 'access-2', refresh: 'refresh-2' });
  });

  it('shares one refresh between calls at the same time (a reused refresh token ends the session)', async () => {
    const t = await signedIn((call) => (call.url.endsWith('/auth/token') ? json(tokens(2)) : entry({ ok: 1 })));
    t.tick(900_000 - 10_000);
    await Promise.all([t.site.api['platform.me']({}), t.site.api['platform.meter.get']({}), t.site.api['platform.enterprises.list']({})]);
    expect(t.calls.filter((c) => c.url.endsWith('/auth/token'))).toHaveLength(1);
    expect(t.calls.filter((c) => c.url === '/api/platform')).toHaveLength(3);
  });

  it('refreshes once after a 401, then sends the call again with the new token', async () => {
    let platformTries = 0;
    const t = await signedIn((call) => {
      if (call.url.endsWith('/auth/token')) return json(tokens(2));
      platformTries += 1;
      return platformTries === 1 ? refused(401) : entry({ again: true });
    });
    expect(await t.site.api['platform.me']({})).toEqual({ again: true });
    expect(t.calls.map((c) => [c.url, (c.init.headers as Record<string, string> | undefined)?.Authorization ?? ''])).toEqual([
      ['/api/platform', 'Bearer access-1'], ['/api/platform/auth/token', ''], ['/api/platform', 'Bearer access-2'],
    ]);
  });

  it('ends the session when the refresh is refused with session_ended, and tells the screen', async () => {
    const t = await signedIn((call) => (call.url.endsWith('/auth/token') ? refused(401, 'session_ended') : refused(401)));
    const heard = vi.fn();
    t.site.subscribe(heard);
    await expect(t.site.api['platform.me']({})).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(t.site.session()).toBeNull();
    expect(t.site.notice()).toBe('ended');
    expect(heard).toHaveBeenCalled();
  });

  it('ends the session at once for a turned-off account (401 account_off), with no refresh', async () => {
    const t = await signedIn(() => refused(401, 'account_off'));
    await expect(t.site.api['platform.me']({})).rejects.toMatchObject({ code: 'unauthenticated', details: { reason: 'account_off' } });
    expect(t.calls.some((c) => c.url.endsWith('/auth/token'))).toBe(false);
    expect(t.site.session()).toBeNull();
    expect(t.site.notice()).toBe('off');
  });

  it('keeps the session when a refresh fails only because the network is down', async () => {
    const t = await signedIn((call) => { if (call.url.endsWith('/auth/token')) throw new TypeError('offline'); return refused(401); });
    await expect(t.site.api['platform.me']({})).rejects.toMatchObject({ code: 'failed' });
    expect(t.site.session()).not.toBeNull();
  });

  it('stops after one resend: a second 401 ends the session', async () => {
    const t = await signedIn((call) => (call.url.endsWith('/auth/token') ? json(tokens(2)) : refused(401)));
    await expect(t.site.api['platform.me']({})).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(t.calls.filter((c) => c.url.endsWith('/auth/token'))).toHaveLength(1);
    expect(t.site.session()).toBeNull();
  });
});

describe('sign out', () => {
  it('posts /api/platform/auth/logout with the bearer token, then clears the session whatever the answer', async () => {
    const t = make((call) => (call.url.endsWith('/logout') ? new Response(null, { status: 500 }) : json(tokens(1))));
    await t.site.signIn('a@b.test', 'x');
    await t.site.signOut();
    const logout = t.calls.find((c) => c.url.endsWith('/logout'))!;
    expect(logout.init.method).toBe('POST');
    expect(logout.init.headers).toMatchObject({ Authorization: 'Bearer access-1' });
    expect(t.site.session()).toBeNull();
    expect(t.site.notice()).toBeNull();
  });

  it('clears the session when the network is down', async () => {
    const t = make((call) => { if (call.url.endsWith('/logout')) throw new TypeError('offline'); return json(tokens(1)); });
    await t.site.signIn('a@b.test', 'x');
    await t.site.signOut();
    expect(t.site.session()).toBeNull();
  });
});
