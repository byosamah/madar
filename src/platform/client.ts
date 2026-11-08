import type { PlatformApi } from '../api/contract/platform';
import { ApiError } from '../api/errors';
import { fromEntry, fromStatus, noAnswer } from '../api/remote/errors';

/**
 * The client of the site Madar enterprises (design 12, D8 and D10). It signs in with the platform routes of the Worker, keeps the session in the
 * own localStorage key of this site, and sends the platform calls with the platform token. It knows no company route and no company token.
 *
 * - POST <base>/platform/auth/token with { grant_type: 'password', email, password } or { grant_type: 'refresh_token', refresh_token }.
 * - POST <base>/platform/auth/logout with the bearer token.
 * - POST <base>/platform with one wire call (the same form as one entry of the batch) and the bearer token.
 *
 * A refresh token turns once: the server ends the session when an old one comes back. So one refresh runs at a time, in this tab (one shared
 * promise) and in all tabs of the browser (a Web Lock), and a tab that waited for the lock uses the pair that another tab stored.
 */

/** The key of the session in localStorage. Only this site writes it (check-bundles refuses the text in the companies' bundles). */
export const PLATFORM_SESSION_KEY = 'madar.platform.session';

export type PlatformAccount = { id: string; name: string; email: string };
export type PlatformSession = { access: string; refresh: string; expiresAt: number; account: PlatformAccount };

export type SessionStore = {
  read(): PlatformSession | null;
  write(session: PlatformSession | null): void;
  /** Tells the listener after each change, also a change that another tab made. Returns the stop. */
  subscribe(listener: () => void): () => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

function sessionOf(value: unknown): PlatformSession | null {
  if (!isRecord(value) || !isText(value.access) || !isText(value.refresh) || typeof value.expiresAt !== 'number' || !isRecord(value.account)) return null;
  const { id, name, email } = value.account;
  if (!isText(id) || typeof name !== 'string' || !isText(email)) return null;
  return { access: value.access, refresh: value.refresh, expiresAt: value.expiresAt, account: { id, name, email } };
}

/** The session in a storage (localStorage). A blocked storage keeps the session in memory, so the page still works until a reload. */
export function createSessionStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null): SessionStore {
  let memory: PlatformSession | null = null;
  // The last text that was parsed and its result. A read of the same text gives the same object, so a screen that reads the session as an
  // external store (useSyncExternalStore) sees no change when nothing changed.
  let lastText: string | null = null;
  let lastSession: PlatformSession | null = null;
  // A write that the storage refused: the memory copy is the truth from then on.
  let refused = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    read() {
      if (refused) return memory;
      try {
        const text = storage?.getItem(PLATFORM_SESSION_KEY) ?? null;
        if (text === null) return storage ? null : memory;
        if (text !== lastText) {
          lastText = text;
          try {
            lastSession = sessionOf(JSON.parse(text) as unknown);
          } catch {
            lastSession = null;
          }
        }
        return lastSession;
      } catch {
        return memory;
      }
    },
    write(session) {
      memory = session;
      try {
        if (session) storage?.setItem(PLATFORM_SESSION_KEY, JSON.stringify(session));
        else storage?.removeItem(PLATFORM_SESSION_KEY);
      } catch {
        refused = true;
      }
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === PLATFORM_SESSION_KEY) listener();
      };
      if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(listener);
        if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      };
    },
  };
}

/** Why a sign-in failed. A wrong email, a wrong password and a turned-off account give the same reason, so no one learns which emails exist. */
export type SignInReason = 'wrong_credentials' | 'too_many' | 'offline' | 'failed';
export class PlatformSignInFailure extends Error {
  readonly reason: SignInReason;
  constructor(reason: SignInReason) {
    super(reason);
    this.name = 'PlatformSignInFailure';
    this.reason = reason;
  }
}

/** Why the site shows the sign-in screen with a line: the session ended, or the account was turned off. */
export type SiteNotice = 'ended' | 'off' | null;

export type PlatformSite = {
  session(): PlatformSession | null;
  notice(): SiteNotice;
  subscribe(listener: () => void): () => void;
  signIn(email: string, password: string): Promise<PlatformAccount>;
  signOut(): Promise<void>;
  api: PlatformApi;
};

export type SiteOptions = {
  /** The own /api of the page. */
  base: string;
  build: string;
  fetch?: typeof fetch;
  store: SessionStore;
  now?: () => number;
  /** Runs a refresh alone across all tabs. The default uses Web Locks, else runs at once. */
  withLock?: <T>(run: () => Promise<T>) => Promise<T>;
};

const TIMEOUT_MS = 20_000;
/** A token with less life than this is renewed before a call. */
const RENEW_BEFORE_MS = 60_000;
const LOCK_NAME = 'madar.platform.refresh';

const defaultLock = <T,>(run: () => Promise<T>): Promise<T> => {
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { locks?: LockManager }).locks;
  return locks ? locks.request(LOCK_NAME, run) : run();
};

type Answer = { v?: unknown; error?: unknown; results?: { ok?: boolean; output?: unknown; error?: Parameters<typeof fromEntry>[0] }[] };

function reasonOf(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body.error)) return undefined;
  const reason = body.error.reason ?? (isRecord(body.error.details) ? body.error.details.reason : undefined);
  return typeof reason === 'string' ? reason : undefined;
}

async function bodyOf(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return {};
  }
}

export function createPlatformSite(o: SiteOptions): PlatformSite {
  const { store } = o;
  const now = o.now ?? Date.now;
  const lock = o.withLock ?? defaultLock;
  const doFetch = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const base = o.base.replace(/\/+$/, '');
  let notice: SiteNotice = null;
  let refreshing: Promise<PlatformSession> | null = null;
  const listeners = new Set<() => void>();
  // The store tells its listeners when a tab changes the session; a notice change tells them too.
  store.subscribe(() => listeners.forEach((listener) => listener()));

  const end = (why: Exclude<SiteNotice, null>) => {
    notice = why;
    store.write(null);
  };

  async function post(path: string, body: unknown, token?: string): Promise<Response> {
    return doFetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Madar-Build': o.build, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  function keep(body: unknown): PlatformSession | null {
    if (!isRecord(body) || !isText(body.access_token) || !isText(body.refresh_token) || typeof body.expires_in !== 'number' || !isRecord(body.account)) return null;
    const { id, name, email } = body.account;
    if (!isText(id) || typeof name !== 'string' || !isText(email)) return null;
    const session = { access: body.access_token, refresh: body.refresh_token, expiresAt: now() + body.expires_in * 1000, account: { id, name, email } };
    notice = null;
    store.write(session);
    return session;
  }

  /**
   * Turns the refresh token. `usedAccess` is the access token that the caller found old: if the stored pair is another one, a tab has refreshed
   * already and its pair stands. A refusal ends the session. A network failure keeps it, so the next call tries again.
   */
  function refresh(usedAccess: string | null): Promise<PlatformSession> {
    refreshing ??= lock(async () => {
      const current = store.read();
      if (!current) throw new ApiError('unauthenticated', 'Sign in to continue.');
      if (usedAccess !== null ? current.access !== usedAccess : current.expiresAt - now() > RENEW_BEFORE_MS) return current;
      let response: Response;
      try {
        response = await post('/platform/auth/token', { grant_type: 'refresh_token', refresh_token: current.refresh });
      } catch (error) {
        throw noAnswer((error as { name?: string } | null)?.name === 'TimeoutError' ? 'timeout' : 'network');
      }
      const body = await bodyOf(response);
      if (response.ok) {
        const session = keep(body);
        if (session) return session;
        throw new ApiError('failed', 'The call failed. Try again.');
      }
      if (response.status === 401 || response.status === 403) {
        end(reasonOf(body) === 'account_off' ? 'off' : 'ended');
        throw new ApiError('unauthenticated', 'Sign in to continue.', { reason: reasonOf(body) ?? 'session_ended' });
      }
      throw fromStatus(response.status, body, response.headers.get('Retry-After'));
    }).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function token(): Promise<string> {
    const session = store.read();
    if (!session) throw new ApiError('unauthenticated', 'Sign in to continue.');
    if (session.expiresAt - now() > RENEW_BEFORE_MS) return session.access;
    return (await refresh(null)).access;
  }

  async function send(name: string, input: unknown, access: string): Promise<{ status: number; body: Answer; retryAfter: string | null }> {
    let response: Response;
    try {
      response = await post('/platform', { v: 1, calls: [{ i: 0, name, input }] }, access);
    } catch (error) {
      throw noAnswer((error as { name?: string } | null)?.name === 'TimeoutError' ? 'timeout' : 'network');
    }
    return { status: response.status, body: (await bodyOf(response)) as Answer, retryAfter: response.headers.get('Retry-After') };
  }

  async function call(name: string, input: unknown): Promise<unknown> {
    let access = await token();
    let answer = await send(name, input, access);
    if (answer.status === 401) {
      if (reasonOf(answer.body) === 'account_off') {
        end('off');
        throw new ApiError('unauthenticated', 'Your account is turned off.', { reason: 'account_off' });
      }
      // The token ended early (or another tab turned it): one refresh, one resend. A second 401 ends the session.
      access = (await refresh(access)).access;
      answer = await send(name, input, access);
      if (answer.status === 401) {
        end(reasonOf(answer.body) === 'account_off' ? 'off' : 'ended');
        throw new ApiError('unauthenticated', 'Sign in to continue.', { reason: reasonOf(answer.body) ?? 'session_ended' });
      }
    }
    const refusal = answer.body.error;
    if (answer.status < 200 || answer.status > 299) {
      throw isRecord(refusal) && typeof refusal.code === 'string' ? fromEntry(refusal as Parameters<typeof fromEntry>[0]) : fromStatus(answer.status, answer.body, answer.retryAfter);
    }
    const entry = answer.body.results?.[0];
    if (!entry) throw new ApiError('failed', 'The call failed. Try again.');
    if (entry.ok !== true) throw fromEntry(entry.error ?? { code: 'failed', message: 'The call failed. Try again.' });
    return entry.output;
  }

  // The contract names are not imported as values: this keeps the zod schemas of the contract out of the site (check-bundles).
  const api = new Proxy({} as PlatformApi, {
    get: (_target, name) => (typeof name === 'string' && name.startsWith('platform.') ? (input: unknown) => call(name, input) : undefined),
  });

  return {
    api,
    session: () => store.read(),
    notice: () => notice,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signIn(email, password) {
      let response: Response;
      try {
        response = await post('/platform/auth/token', { grant_type: 'password', email: email.trim(), password });
      } catch {
        throw new PlatformSignInFailure('offline');
      }
      const body = await bodyOf(response);
      if (response.ok) {
        const session = keep(body);
        if (session) return session.account;
        throw new PlatformSignInFailure('failed');
      }
      if (response.status === 429) throw new PlatformSignInFailure('too_many');
      if (response.status === 401 || response.status === 403) throw new PlatformSignInFailure('wrong_credentials');
      throw new PlatformSignInFailure('failed');
    },
    async signOut() {
      const session = store.read();
      notice = null;
      store.write(null);
      if (!session) return;
      // The server ends the session on its side. A failure changes nothing here: the local copy is gone already.
      await post('/platform/auth/logout', undefined, session.access).catch(() => undefined);
    },
  };
}
