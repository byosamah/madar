import { regionUrl } from '../../api/remote/region';
import { AuthFailure, type AuthFailureReason } from '../../features/auth/authFailure';
import { clearLeaving, leftOnPurpose, markLeaving, type SessionChange, type SessionListener } from '../../features/auth/sessionEnd';
import type { AuthPort, AuthStatus } from '../auth';
import { renewInviteAt, requestResetAt } from './authMail';

/**
 * The sign-in port of the real screens over the own sign-in of Madar (Supabase exit, wave 2), the twin of the Supabase port of
 * auth.ts. The build picks one (authMode.ts, VITE_MADAR_AUTH); both copies keep the Supabase port until the switch.
 * - The session (the tokens and the person) lives in localStorage under madar.session: every tab of the browser shares it, and a
 *   storage event tells the other tabs of a sign-in, a refresh or a sign-out.
 * - A refresh runs under one Web Lock for the whole browser (navigator.locks) and reads the stored session again inside it: a tab
 *   that waited uses the tokens of the tab that refreshed, so two tabs never send one refresh token (the server keeps a 10 s
 *   reuse window for a lost answer too).
 * - A token is refreshed 60 s before its end, when a call asks for it. A refused refresh ends the session in this browser.
 */

export const SESSION_KEY = 'madar.session';
const EARLY_MS = 60_000;

type Kept = { accessToken: string; refreshToken: string; expiresAt: number; userId: string };
type Locks = { request<T>(name: string, work: () => Promise<T>): Promise<T> };
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const REASONS: Readonly<Record<string, AuthFailureReason>> = {
  invalid_credentials: 'wrong_credentials', current_password_required: 'wrong_credentials', account_off: 'account_off',
  link_ended: 'link_ended', weak: 'weak', same: 'same', too_many: 'too_many',
};

export async function createMadarAuth(o: {
  apiUrl: string; fetch?: Fetch; storage?: Storage; locks?: Locks; now?: () => number; events?: Pick<Window, 'addEventListener'>;
}): Promise<AuthPort> {
  const send: Fetch = o.fetch ?? ((input, init) => fetch(input, init));
  const storage = o.storage ?? window.localStorage;
  const locks: Locks = o.locks ?? (navigator as Navigator & { locks?: Locks }).locks ?? { request: (_name, work) => work() };
  const now = o.now ?? (() => Date.now());
  const base = o.apiUrl.replace(/\/+$/, '');
  const url = (path: string) => regionUrl(`${base}${path}`);
  const listeners = new Set<SessionListener>();

  const read = (): Kept | null => {
    try {
      const text = storage.getItem(SESSION_KEY);
      return text ? (JSON.parse(text) as Kept) : null;
    } catch {
      return null;
    }
  };
  const write = (kept: Kept | null) => {
    try {
      if (kept) storage.setItem(SESSION_KEY, JSON.stringify(kept));
      else storage.removeItem(SESSION_KEY);
    } catch {
      // Blocked storage: the session lives in this tab only.
    }
  };

  let status: AuthStatus = read() ? 'signed_in' : 'signed_out';
  let userId: string | null = read()?.userId ?? null;
  const tell = (next: AuthStatus, change?: SessionChange) => {
    status = next;
    for (const listener of [...listeners]) listener(next, change);
  };
  const follow = (kept: Kept | null, change?: SessionChange) => {
    const next: AuthStatus = kept ? 'signed_in' : 'signed_out';
    const otherPerson = kept !== null && userId !== null && kept.userId !== userId;
    if (kept) userId = kept.userId;
    if (otherPerson) tell(next, 'person');
    else if (next !== status) tell(next, change ?? (next === 'signed_out' && leftOnPurpose() ? 'left' : undefined));
  };
  (o.events ?? window).addEventListener('storage', (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === SESSION_KEY || key === null) follow(read());
  });

  async function post(path: string, body: unknown, token?: string): Promise<Response> {
    try {
      return await send(url(path), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    } catch (error) {
      throw new AuthFailure('offline', error instanceof Error ? error.message : 'The request did not reach Madar.');
    }
  }

  async function failure(response: Response): Promise<AuthFailure> {
    if (response.status === 429) return new AuthFailure('too_many');
    const body = (await response.json().catch(() => null)) as { error?: { message?: string; details?: { reason?: unknown } } } | null;
    const reason = typeof body?.error?.details?.reason === 'string' ? REASONS[body.error.details.reason] : undefined;
    return new AuthFailure(reason ?? 'failed', body?.error?.message ?? `Madar answered ${response.status}.`);
  }

  async function keep(response: Response): Promise<Kept> {
    if (!response.ok) throw await failure(response);
    const body = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number; user: { id: string } };
    const kept: Kept = { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: now() + body.expires_in * 1000, userId: body.user.id };
    write(kept);
    return kept;
  }

  function refresh(): Promise<Kept | null> {
    return locks.request(SESSION_KEY, async () => {
      const kept = read();
      if (!kept) return null;
      // Another tab refreshed while this one waited for the lock.
      if (kept.expiresAt - now() > EARLY_MS) return kept;
      const response = await post('/auth/token', { grant_type: 'refresh_token', refresh_token: kept.refreshToken });
      if (response.ok) return keep(response);
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        write(null);
        follow(null);
        return null;
      }
      throw await failure(response);
    });
  }

  async function accessToken(): Promise<string | null> {
    const kept = read();
    if (!kept) return null;
    if (kept.expiresAt - now() > EARLY_MS) return kept.accessToken;
    return (await refresh())?.accessToken ?? null;
  }

  async function withToken(path: string, body: unknown): Promise<void> {
    const token = await accessToken();
    if (!token) throw new AuthFailure('failed', 'No session.');
    const response = await post(path, body, token);
    if (!response.ok) throw await failure(response);
  }

  return {
    status: () => status,
    userId: () => (status === 'signed_in' ? userId : null),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signIn(email, password) {
      clearLeaving();
      follow(await keep(await post('/auth/token', { grant_type: 'password', email, password })));
    },
    async signOut(options) {
      if (options?.scope === 'others') {
        await withToken('/auth/logout', { scope: 'others' });
        return;
      }
      // This device only. The mark first, so the other tabs read this sign-out as one on purpose.
      markLeaving();
      const token = await accessToken().catch(() => null);
      if (token) await post('/auth/logout', { scope: 'local' }, token).catch(() => undefined);
      write(null);
      follow(null, 'left');
    },
    accessToken,
    async refresh() {
      await refresh();
    },
    async verifyLink(tokenHash, type) {
      clearLeaving();
      follow(await keep(await post('/auth/verify', { token_hash: tokenHash, type })));
    },
    setPassword: (password) => withToken('/auth/password', { password }),
    changePassword: (current, next) => withToken('/auth/password', { password: next, current }),
    requestReset: (email) => requestResetAt(send, url('/auth/forgot'), email),
    renewInvite: (key) => renewInviteAt(send, url('/auth/renew-invite'), key),
  };
}
