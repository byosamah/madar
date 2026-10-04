import type { AuthAdminPort } from '../core/ports';

/**
 * AuthAdminPort over the GoTrue admin REST API with the secret key (plan 5.1; task P2). It only runs on the server: the key
 * never leaves this module, and no error holds it.
 *
 * - generateLink: POST /auth/v1/admin/generate_link. It makes the Auth user when the email is new (open sign-up is off, but the
 *   admin API ignores that), so the server calls it only for an email that a users row holds (proof.md, section P1).
 *   An "invite" for a person who already accepted answers 422 email_exists: the caller then sends a "recovery" link.
 * - createUser: a confirmed user with a password (the first Admin, P3).
 * - setBanned: a ban of 100 years, or "none". A banned person cannot sign in or refresh; principalOf refuses the person anyway.
 * - updateEmail: the new email, confirmed at once, so Auth sends no mail of its own.
 * - listUsers: every Auth user and whether the email is confirmed (users.invites).
 * - getUser: one Auth user, or null (the auth.email effect: did the email change, and did the person accept yet).
 *   listUsers and getUser are not in AuthAdminPort yet: the merge lead patch of P2 adds them there and to the fake.
 */

export type AuthUserInfo = { authUserId: string; email: string | null; confirmed: boolean };
export type AuthAdmin = AuthAdminPort & { listUsers(): Promise<AuthUserInfo[]>; getUser(authUserId: string): Promise<AuthUserInfo | null> };

/** A refusal of the Auth admin API: the HTTP status and Auth's error code (for example email_exists). */
export class AuthAdminError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'AuthAdminError';
  }
}

export function isEmailExists(error: unknown): boolean {
  return error instanceof AuthAdminError && error.status === 422 && (error.code === 'email_exists' || error.code === 'user_already_exists');
}

const BAN_FOREVER = '876000h';
const PAGE = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Rec = Record<string, unknown>;
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

function idPath(authUserId: string): string {
  if (!UUID.test(authUserId)) throw new Error(`"${authUserId.slice(0, 40)}" is not an Auth user id.`);
  return encodeURIComponent(authUserId);
}

export function authAdminPort(o: { supabaseUrl: string; secretKey: string; fetch?: typeof fetch; timeoutMs?: number }): AuthAdmin {
  const base = `${o.supabaseUrl.replace(/\/+$/, '')}/auth/v1/admin`;
  const send = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const timeoutMs = o.timeoutMs ?? 10_000;

  async function call(method: 'GET' | 'POST' | 'PUT', path: string, body?: Rec): Promise<Rec> {
    let response: Response;
    try {
      response = await send(`${base}${path}`, {
        method,
        headers: { apikey: o.secretKey, Authorization: `Bearer ${o.secretKey}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error(`The Auth admin API did not answer ${method} ${path.split('?')[0]}: ${error instanceof Error ? error.name : 'error'}.`);
    }
    const raw = await response.text();
    let parsed: Rec = {};
    try {
      parsed = raw ? (JSON.parse(raw) as Rec) : {};
    } catch {
      parsed = {};
    }
    if (!response.ok) {
      const code = text(parsed.error_code) ?? text(parsed.code) ?? text(parsed.error) ?? `http_${response.status}`;
      const message = text(parsed.msg) ?? text(parsed.message) ?? text(parsed.error_description) ?? '';
      throw new AuthAdminError(response.status, code, `The Auth admin API refused ${method} ${path.split('?')[0]} with ${response.status} ${code}${message ? `: ${message.slice(0, 200)}` : ''}.`);
    }
    return parsed;
  }

  function infoOf(user: Rec): AuthUserInfo | undefined {
    const id = text(user.id);
    return id ? { authUserId: id, email: text(user.email) ?? null, confirmed: Boolean(user.email_confirmed_at ?? user.confirmed_at) } : undefined;
  }

  function userIdOf(body: Rec): string {
    const id = text(body.id) ?? text((body.user as Rec | undefined)?.id);
    if (!id) throw new Error('The Auth admin API gave no user id.');
    return id;
  }

  return {
    async generateLink(type, email) {
      const body = await call('POST', '/generate_link', { type, email: email.toLowerCase() });
      const tokenHash = text(body.hashed_token) ?? text((body.properties as Rec | undefined)?.hashed_token);
      if (!tokenHash) throw new Error('The Auth admin API gave no token hash.');
      return { authUserId: userIdOf(body), tokenHash };
    },
    async createUser(email, password) {
      return { authUserId: userIdOf(await call('POST', '/users', { email: email.toLowerCase(), password, email_confirm: true })) };
    },
    async setBanned(authUserId, banned) {
      await call('PUT', `/users/${idPath(authUserId)}`, { ban_duration: banned ? BAN_FOREVER : 'none' });
    },
    async updateEmail(authUserId, email) {
      await call('PUT', `/users/${idPath(authUserId)}`, { email: email.toLowerCase(), email_confirm: true });
    },
    async getUser(authUserId) {
      try {
        return infoOf(await call('GET', `/users/${idPath(authUserId)}`)) ?? null;
      } catch (error) {
        if (error instanceof AuthAdminError && error.status === 404) return null;
        throw error;
      }
    },
    async listUsers() {
      const all: AuthUserInfo[] = [];
      for (let page = 1; ; page += 1) {
        const body = await call('GET', `/users?page=${page}&per_page=${PAGE}`);
        const users = Array.isArray(body.users) ? (body.users as Rec[]) : [];
        for (const user of users) {
          const info = infoOf(user);
          if (info) all.push(info);
        }
        if (users.length < PAGE) return all;
      }
    },
  };
}

/**
 * The port with listUsers and getUser. The real port has both; a port without them (the T0 fake, until the merge lead patch of
 * P2) refuses with a plain error, so the call or the effect fails and the job tries the effect again.
 */
export function authAdminOf(port: AuthAdminPort): AuthAdmin {
  const maybe = port as Partial<AuthAdmin>;
  if (typeof maybe.listUsers !== 'function' || typeof maybe.getUser !== 'function') throw new Error('The Auth admin port cannot read Auth users.');
  return port as AuthAdmin;
}
