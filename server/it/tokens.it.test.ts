import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { decodeJwt } from 'jose';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import { verifyBrowserToken } from '../auth/verify';
import { setEnvSource } from '../env';

/**
 * Task P1 on the local stack (plan 5.1; proof.md, section P1): an invitation works with open sign-up off, the tokens of
 * Supabase Auth pass verifyBrowserToken (ES256, the JWKS, the issuer, both forms of aud), and the link type that works for a
 * second invitation. It needs the local stack (`supabase start`) and the Docker lock. It talks only to 127.0.0.1, and it
 * removes the Auth users it made.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const PASSWORD = 'Madar-local-test-pass-1';

type Stack = { apiUrl: string; publishableKey: string; secretKey: string; legacyKeys: string[] };

function localStack(): Stack {
  const out = execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const values = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string | undefined>;
  const apiUrl = values.API_URL ?? 'http://127.0.0.1:54321';
  const host = new URL(apiUrl).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`This proof runs only on the local stack, not on ${host}.`);
  return {
    apiUrl,
    publishableKey: values.PUBLISHABLE_KEY ?? values.ANON_KEY ?? '',
    // The sb_secret_ key, as the Auth admin port of track P2 uses it.
    secretKey: values.SECRET_KEY ?? values.SERVICE_ROLE_KEY ?? '',
    legacyKeys: [values.ANON_KEY, values.SERVICE_ROLE_KEY].filter((k): k is string => typeof k === 'string' && k.startsWith('ey')),
  };
}

const stack = localStack();
const made = new Set<string>();

type Answer = { status: number; body: Record<string, unknown> };

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

const email = (label: string) => `p1-${label}-${randomUUID().slice(0, 8)}@madar.test`;

/** An Auth admin link, as the auth.invite effect and users.resendInvite of P2 make it. */
async function link(type: 'invite' | 'recovery', to: string): Promise<Answer & { userId: string; tokenHash: string }> {
  const answer = await auth('POST', '/admin/generate_link', { admin: true, body: { type, email: to } });
  const userId = String(answer.body.id ?? '');
  if (userId) made.add(userId);
  return { ...answer, userId, tokenHash: String(answer.body.hashed_token ?? '') };
}

/** The Welcome and Reset screens: verifyOtp with the token hash of the link. */
async function useLink(type: 'invite' | 'recovery', tokenHash: string): Promise<Answer> {
  return auth('POST', '/verify', { body: { type, token_hash: tokenHash } });
}

async function setPassword(accessToken: string, password = PASSWORD): Promise<number> {
  return (await auth('PUT', '/user', { bearer: accessToken, body: { password } })).status;
}

async function signIn(to: string): Promise<Answer> {
  return auth('POST', '/token?grant_type=password', { body: { email: to, password: PASSWORD } });
}

const tokenOf = (answer: Answer) => String(answer.body.access_token ?? '');
const codeOf = (answer: Answer) => answer.body.error_code ?? answer.body.code;

async function refusal(work: Promise<unknown>): Promise<ApiError> {
  const error = await work.then(() => null, (e: unknown) => e);
  if (!(error instanceof ApiError)) throw new Error(`It did not refuse with an ApiError: ${String(error)}`);
  return error;
}

afterEach(() => setEnvSource(undefined));

afterAll(async () => {
  for (const id of made) await auth('DELETE', `/admin/users/${id}`, { admin: true });
});

describe('P1 on the local stack: sign-in tokens and invitations', () => {
  it('refuses open sign-up (enable_signup = false)', async () => {
    const answer = await auth('POST', '/signup', { body: { email: email('signup'), password: PASSWORD } });
    expect([answer.status, codeOf(answer)]).toEqual([422, 'signup_disabled']);
  });

  it('lets an invitation through with sign-up off, and every token of the person passes verifyBrowserToken', async () => {
    setEnvSource({ SUPABASE_URL: stack.apiUrl });
    const to = email('invite');
    const invite = await link('invite', to);
    expect(invite.status).toBe(200);
    expect(invite.tokenHash).not.toBe('');

    // Welcome: the link gives a session, and the session sets the first password.
    const welcome = await useLink('invite', invite.tokenHash);
    expect(welcome.status).toBe(200);
    expect(decodeJwt(tokenOf(welcome)).amr).toEqual([expect.objectContaining({ method: 'otp' })]);
    expect(await setPassword(tokenOf(welcome))).toBe(200);
    await expect(verifyBrowserToken(`Bearer ${tokenOf(welcome)}`)).resolves.toEqual({ authUserId: invite.userId });

    // Sign-in, then a refresh: the server must accept aud as an array and as a string, whichever form Auth gives.
    const signedIn = await signIn(to);
    expect(signedIn.status).toBe(200);
    const claims = decodeJwt(tokenOf(signedIn));
    expect(claims).toMatchObject({ sub: invite.userId, role: 'authenticated', iss: `${stack.apiUrl}/auth/v1` });
    expect(claims.client_id).toBeUndefined();
    await expect(verifyBrowserToken(`Bearer ${tokenOf(signedIn)}`)).resolves.toEqual({ authUserId: invite.userId });
    const refreshed = await auth('POST', '/token?grant_type=refresh_token', { body: { refresh_token: signedIn.body.refresh_token } });
    expect(refreshed.status).toBe(200);
    await expect(verifyBrowserToken(`Bearer ${tokenOf(refreshed)}`)).resolves.toEqual({ authUserId: invite.userId });
    for (const token of [tokenOf(signedIn), tokenOf(refreshed)]) {
      const aud = decodeJwt(token).aud;
      expect(aud === 'authenticated' || (Array.isArray(aud) && aud.length === 1 && aud[0] === 'authenticated')).toBe(true);
    }
  });

  it('refuses the keys of the stack as sign-ins: the legacy HS256 keys and the publishable key', async () => {
    setEnvSource({ SUPABASE_URL: stack.apiUrl });
    expect(stack.legacyKeys.length).toBeGreaterThan(0);
    for (const key of [...stack.legacyKeys, stack.publishableKey]) {
      expect((await refusal(verifyBrowserToken(`Bearer ${key}`))).code).toBe('unauthenticated');
    }
  });

  it('second invitation before the person accepts: invite again works and kills the first link', async () => {
    const to = email('again');
    const first = await link('invite', to);
    const second = await link('invite', to);
    expect([first.status, second.status, second.userId]).toEqual([200, 200, first.userId]);
    const old = await useLink('invite', first.tokenHash);
    expect([old.status, codeOf(old)]).toEqual([403, 'otp_expired']);
    const fresh = await useLink('invite', second.tokenHash);
    expect(fresh.status).toBe(200);
  });

  it('second invitation after the person accepted: invite refuses with email_exists, recovery works', async () => {
    const to = email('accepted');
    const invite = await link('invite', to);
    const welcome = await useLink('invite', invite.tokenHash);
    expect(await setPassword(tokenOf(welcome))).toBe(200);

    const again = await link('invite', to);
    expect([again.status, codeOf(again)]).toEqual([422, 'email_exists']);
    const recovery = await link('recovery', to);
    expect([recovery.status, recovery.userId]).toEqual([200, invite.userId]);
    const reset = await useLink('recovery', recovery.tokenHash);
    expect(reset.status).toBe(200);
    expect(decodeJwt(tokenOf(reset)).amr).toEqual([expect.objectContaining({ method: 'otp' })]);
    // Auth refuses the same password again (422 same_password), so the reset sets a new one.
    const same = await auth('PUT', '/user', { bearer: tokenOf(reset), body: { password: PASSWORD } });
    expect([same.status, codeOf(same)]).toEqual([422, 'same_password']);
    expect(await setPassword(tokenOf(reset), `${PASSWORD}-new`)).toBe(200);
  });

  it('recovery works before the person accepts too, and confirms the email; the first link used kills the other', async () => {
    const to = email('recovery');
    const invite = await link('invite', to);
    const recovery = await link('recovery', to);
    expect(recovery.userId).toBe(invite.userId);
    const reset = await useLink('recovery', recovery.tokenHash);
    expect(reset.status).toBe(200);
    expect((reset.body.user as Record<string, unknown>).email_confirmed_at).toEqual(expect.any(String));
    expect(await setPassword(tokenOf(reset))).toBe(200);
    expect((await signIn(to)).status).toBe(200);
    const old = await useLink('invite', invite.tokenHash);
    expect([old.status, codeOf(old)]).toEqual([403, 'otp_expired']);
  });

  it('a recovery link made after an invite link leaves the invite link good until one of them is used', async () => {
    const to = email('both');
    const invite = await link('invite', to);
    const recovery = await link('recovery', to);
    expect((await useLink('invite', invite.tokenHash)).status).toBe(200);
    const late = await useLink('recovery', recovery.tokenHash);
    expect([late.status, codeOf(late)]).toEqual([403, 'otp_expired']);
  });

  it('refuses a used link', async () => {
    const invite = await link('invite', email('twice'));
    expect((await useLink('invite', invite.tokenHash)).status).toBe(200);
    const twice = await useLink('invite', invite.tokenHash);
    expect([twice.status, codeOf(twice)]).toEqual([403, 'otp_expired']);
  });
});
