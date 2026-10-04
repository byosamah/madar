import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { PASSWORD_SET_MARK } from '../../src/api/contract/server';
import { authAdminPort, type AuthAdmin } from '../auth/admin';

/**
 * Supabase Auth of the local stack for the it suites of track P (server/it/auth.it.test.ts, invites.it.test.ts, and
 * scripts/first-admin.test.ts). It talks only to 127.0.0.1. Every email it makes starts with a prefix, so cleanup() removes
 * exactly the Auth users of one run.
 */

const ROOT = join(import.meta.dirname, '..', '..');
export const PASSWORD = 'Madar-local-test-pass-1';

export type Stack = { apiUrl: string; publishableKey: string; secretKey: string };
export type Answer = { status: number; body: Record<string, unknown> };

export function localStack(): Stack {
  const out = execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const values = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string | undefined>;
  const apiUrl = values.API_URL ?? 'http://127.0.0.1:54321';
  const host = new URL(apiUrl).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`These tests run only on the local stack, not on ${host}.`);
  return { apiUrl, publishableKey: values.PUBLISHABLE_KEY ?? values.ANON_KEY ?? '', secretKey: values.SECRET_KEY ?? values.SERVICE_ROLE_KEY ?? '' };
}

export function authOf(stack: Stack, prefix: string) {
  const run = `${prefix}-${randomUUID().slice(0, 8)}`;

  async function auth(method: string, path: string, o: { body?: unknown; admin?: boolean; bearer?: string } = {}): Promise<Answer> {
    const key = o.admin ? stack.secretKey : stack.publishableKey;
    const response = await fetch(`${stack.apiUrl}/auth/v1${path}`, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${o.bearer ?? key}`, 'Content-Type': 'application/json' },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
  }

  const admin: AuthAdmin = authAdminPort({ supabaseUrl: stack.apiUrl, secretKey: stack.secretKey });

  return {
    admin,
    auth,
    /** A new email of this run. */
    email: (label: string) => `${run}-${label}@madar.test`,
    /** The Welcome and Reset screens: verifyOtp with the token hash of a link. */
    useLink: (type: string, tokenHash: string) => auth('POST', '/verify', { body: { type, token_hash: tokenHash } }),
    /** The Welcome and Reset screens: the password and its mark in one request, as src/app/remote/auth.ts sends them. */
    setPassword: async (accessToken: string, password = PASSWORD) =>
      (await auth('PUT', '/user', { bearer: accessToken, body: { password, data: { [PASSWORD_SET_MARK]: true } } })).status,
    signIn: (email: string, password = PASSWORD) => auth('POST', '/token?grant_type=password', { body: { email, password } }),
    tokenOf: (answer: Answer) => String(answer.body.access_token ?? ''),
    codeOf: (answer: Answer) => answer.body.error_code ?? answer.body.code,
    /** Removes every Auth user of this run. */
    async cleanup() {
      for (const user of await admin.listUsers()) {
        if (user.email?.startsWith(`${run}-`)) await auth('DELETE', `/admin/users/${user.authUserId}`, { admin: true });
      }
    },
  };
}

/** The link in a mail text: the first https or http address. */
export function linkIn(text: string): URL {
  const found = /https?:\/\/\S+/.exec(text)?.[0];
  if (!found) throw new Error('The mail has no link.');
  return new URL(found);
}
