import { beforeEach, describe, expect, it } from 'vitest';
import { AuthFailure } from '../../features/auth/authFailure';
import type { AuthStatus } from '../auth';
import { createMadarAuth, SESSION_KEY } from './madarAuth';

/** A listener that also reads the change; AuthPort types it with the status alone, as personChangeSource casts it. */
const withChange = (fn: (status: AuthStatus, change?: string) => void) => fn as (status: AuthStatus) => void;

type Call = { path: string; body: Record<string, unknown>; token: string | null };

function fakeServer() {
  const calls: Call[] = [];
  let n = 0;
  const tokens = (userId = 'auth-1') => ({ access_token: `access-${++n}`, refresh_token: `refresh-${n}`, expires_in: 900, token_type: 'bearer', user: { id: userId } });
  const routes: Record<string, (body: Record<string, unknown>) => Response> = {
    '/api/auth/token': (body) => body.grant_type === 'refresh_token' && body.refresh_token === 'refused'
      ? Response.json({ v: 1, error: { code: 'unauthenticated', message: 'This sign-in ended. Sign in again.', details: { reason: 'session_ended' } } }, { status: 401 })
      : body.password === 'wrong'
        ? Response.json({ v: 1, error: { code: 'unauthenticated', message: 'no', details: { reason: 'invalid_credentials' } } }, { status: 401 })
        : Response.json(tokens(String(body.email ?? 'x').startsWith('other') ? 'auth-2' : 'auth-1')),
    '/api/auth/verify': (body) => body.token_hash === 'used'
      ? Response.json({ v: 1, error: { code: 'unauthenticated', message: 'This link ended. Ask for a new one.', details: { reason: 'link_ended' } } }, { status: 401 })
      : Response.json(tokens()),
    '/api/auth/password': (body) => body.current === 'wrong'
      ? Response.json({ v: 1, error: { code: 'unauthenticated', message: 'no', details: { reason: 'invalid_credentials' } } }, { status: 401 })
      : Response.json({ ok: true }),
    '/api/auth/logout': () => Response.json({ ok: true }),
  };
  const fetch = async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'https://madar.test').pathname;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ path, body, token: new Headers(init?.headers).get('Authorization') });
    return routes[path]?.(body) ?? new Response('not found', { status: 404 });
  };
  return { calls, fetch };
}

function fakeLocks() {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    request<T>(_name: string, work: () => Promise<T>): Promise<T> {
      const run = chain.then(work);
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}

const events = new EventTarget();
let clock = 1_000_000;
const make = (server: ReturnType<typeof fakeServer>, locks = fakeLocks()) =>
  createMadarAuth({ apiUrl: '/api', fetch: server.fetch, storage: window.localStorage, locks, now: () => clock, events: events as unknown as Window });

beforeEach(() => {
  window.localStorage.clear();
  clock = 1_000_000;
});

describe('the Madar sign-in port of the screens (src/app/remote/madarAuth.ts)', () => {
  it('signs in, keeps the session for every tab of the browser, and gives the token', async () => {
    const server = fakeServer();
    const auth = await make(server);
    await auth.signIn('hala@madar.test', 'a good password');
    expect(auth.status()).toBe('signed_in');
    expect(auth.userId?.()).toBe('auth-1');
    expect(await auth.accessToken()).toBe('access-1');
    expect(JSON.parse(window.localStorage.getItem(SESSION_KEY)!)).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1', userId: 'auth-1' });
    expect(server.calls[0]).toMatchObject({ path: '/api/auth/token', body: { grant_type: 'password', email: 'hala@madar.test', password: 'a good password' } });
  });

  it('turns each refusal into a reason that the screens can say', async () => {
    const auth = await make(fakeServer());
    await expect(auth.signIn('hala@madar.test', 'wrong')).rejects.toMatchObject({ reason: 'wrong_credentials' });
    const limited = await createMadarAuth({ apiUrl: '/api', fetch: async () => new Response('{}', { status: 429 }), storage: window.localStorage, locks: fakeLocks(), now: () => clock, events: events as unknown as Window });
    await expect(limited.signIn('a@madar.test', 'x')).rejects.toMatchObject({ reason: 'too_many' });
    const offline = await createMadarAuth({ apiUrl: '/api', fetch: async () => { throw new TypeError('Failed to fetch'); }, storage: window.localStorage, locks: fakeLocks(), now: () => clock, events: events as unknown as Window });
    await expect(offline.signIn('a@madar.test', 'x')).rejects.toBeInstanceOf(AuthFailure);
    await expect(offline.signIn('a@madar.test', 'x')).rejects.toMatchObject({ reason: 'offline' });
  });

  it('two tabs refresh under one lock, and the second tab uses the token of the first', async () => {
    const server = fakeServer();
    const locks = fakeLocks();
    const tabA = await make(server, locks);
    await tabA.signIn('hala@madar.test', 'a good password');
    const tabB = await make(server, locks);
    clock += 850_000;
    const [a, b] = await Promise.all([tabA.accessToken(), tabB.accessToken()]);
    expect(a).toBe('access-2');
    expect(b).toBe('access-2');
    expect(server.calls.filter((call) => call.body.grant_type === 'refresh_token')).toHaveLength(1);
  });

  it('ends the session in this browser when the server refuses the refresh', async () => {
    const server = fakeServer();
    const auth = await make(server);
    await auth.signIn('hala@madar.test', 'a good password');
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ ...JSON.parse(window.localStorage.getItem(SESSION_KEY)!), refreshToken: 'refused' }));
    const seen: string[] = [];
    auth.subscribe((status) => void seen.push(status));
    clock += 900_000;
    expect(await auth.accessToken()).toBeNull();
    expect([auth.status(), seen, window.localStorage.getItem(SESSION_KEY)]).toEqual(['signed_out', ['signed_out'], null]);
  });

  it('opens a link session for Welcome and Reset, and says link_ended for a used link', async () => {
    const auth = await make(fakeServer());
    await auth.verifyLink('fresh', 'invite');
    expect(auth.status()).toBe('signed_in');
    await expect(auth.verifyLink('used', 'recovery')).rejects.toMatchObject({ reason: 'link_ended' });
  });

  it('sets a password with the token of the session, and maps a wrong current password', async () => {
    const server = fakeServer();
    const auth = await make(server);
    await auth.signIn('hala@madar.test', 'a good password');
    await auth.setPassword('a new password');
    expect(server.calls.at(-1)).toMatchObject({ path: '/api/auth/password', body: { password: 'a new password' }, token: 'Bearer access-1' });
    await expect(auth.changePassword('wrong', 'another one')).rejects.toMatchObject({ reason: 'wrong_credentials' });
  });

  it('signs out this device with the mark of a sign-out on purpose, and signs out the others with the token', async () => {
    const server = fakeServer();
    const auth = await make(server);
    await auth.signIn('hala@madar.test', 'a good password');
    await auth.signOut({ scope: 'others' });
    expect(server.calls.at(-1)).toMatchObject({ path: '/api/auth/logout', body: { scope: 'others' }, token: 'Bearer access-1' });
    expect(auth.status()).toBe('signed_in');
    const changes: (string | undefined)[] = [];
    auth.subscribe(withChange((_status, change) => void changes.push(change)));
    await auth.signOut();
    expect([auth.status(), changes, window.localStorage.getItem(SESSION_KEY)]).toEqual(['signed_out', ['left'], null]);
  });

  it('follows a sign-in of another person in another tab', async () => {
    const server = fakeServer();
    const auth = await make(server);
    await auth.signIn('hala@madar.test', 'a good password');
    const changes: (string | undefined)[] = [];
    auth.subscribe(withChange((_status, change) => void changes.push(change)));
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: 'x', refreshToken: 'y', expiresAt: clock + 900_000, userId: 'auth-2' }));
    events.dispatchEvent(Object.assign(new Event('storage'), { key: SESSION_KEY }));
    expect(changes).toEqual(['person']);
    expect(auth.userId?.()).toBe('auth-2');
  });
});
