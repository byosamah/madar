import { describe, expect, it } from 'vitest';
import { AuthAdminError, authAdminPort, isEmailExists } from './admin';

type Seen = { method: string; url: string; headers: Record<string, string>; body: unknown };

/** A fetch that records each request and answers from a list, in order. */
function stubFetch(answers: { status: number; body: unknown }[]) {
  const seen: Seen[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    seen.push({ method: init?.method ?? 'GET', url: String(input), headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers.shift();
    if (!answer) throw new Error('No answer left.');
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } });
  };
  return { seen, fetch: fetch as typeof globalThis.fetch };
}

const SECRET = 'sb_secret_test_key';
const URL_ = 'http://127.0.0.1:54321/';
const ID = '0b6c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3';

describe('authAdminPort over the GoTrue admin API (plan 5.1)', () => {
  it('generateLink posts the type and the email with the secret key, and gives the Auth user id and the token hash', async () => {
    const { seen, fetch } = stubFetch([{ status: 200, body: { id: 'auth-1', email: 'a@madar.test', hashed_token: 'hash-1' } }]);
    const admin = authAdminPort({ supabaseUrl: URL_, secretKey: SECRET, fetch });
    await expect(admin.generateLink('invite', 'A@Madar.test')).resolves.toEqual({ authUserId: 'auth-1', tokenHash: 'hash-1' });
    expect(seen[0]).toMatchObject({
      method: 'POST',
      url: 'http://127.0.0.1:54321/auth/v1/admin/generate_link',
      body: { type: 'invite', email: 'a@madar.test' },
    });
    expect(seen[0].headers.apikey).toBe(SECRET);
    expect(seen[0].headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  it('reads the token hash from "properties" too, the form of newer Auth versions', async () => {
    const { fetch } = stubFetch([{ status: 200, body: { user: { id: 'auth-2' }, properties: { hashed_token: 'hash-2' } } }]);
    await expect(authAdminPort({ supabaseUrl: URL_, secretKey: SECRET, fetch }).generateLink('recovery', 'b@madar.test')).resolves.toEqual({ authUserId: 'auth-2', tokenHash: 'hash-2' });
  });

  it('gives an AuthAdminError with the status and the error code, and never the key', async () => {
    const { fetch } = stubFetch([{ status: 422, body: { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' } }]);
    const error = await authAdminPort({ supabaseUrl: URL_, secretKey: SECRET, fetch }).generateLink('invite', 'c@madar.test').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthAdminError);
    expect((error as AuthAdminError).status).toBe(422);
    expect((error as AuthAdminError).code).toBe('email_exists');
    expect(isEmailExists(error)).toBe(true);
    expect(String((error as Error).message)).not.toContain(SECRET);
  });

  it('createUser makes a confirmed user with the password and the password mark', async () => {
    const { seen, fetch } = stubFetch([{ status: 200, body: { id: 'auth-3' } }]);
    await expect(authAdminPort({ supabaseUrl: URL_, secretKey: SECRET, fetch }).createUser('d@madar.test', 'pw-12345678')).resolves.toEqual({ authUserId: 'auth-3' });
    expect(seen[0]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:54321/auth/v1/admin/users', body: { email: 'd@madar.test', password: 'pw-12345678', email_confirm: true, user_metadata: { madar_password_set: true } } });
  });

  it('setBanned bans for 100 years and unbans with "none"; updateEmail confirms the new email only when asked', async () => {
    const { seen, fetch } = stubFetch([{ status: 200, body: {} }, { status: 200, body: {} }, { status: 200, body: {} }, { status: 200, body: {} }]);
    const admin = authAdminPort({ supabaseUrl: URL_, secretKey: SECRET, fetch });
    await admin.setBanned(ID, true);
    await admin.setBanned(ID, false);
    await admin.updateEmail(ID, 'New@madar.test', { confirm: true });
    // A person who did not accept yet: the email alone, so Auth does not confirm a person who has no password.
    await admin.updateEmail(ID, 'Other@madar.test');
    expect(seen.map((s) => [s.method, s.url, s.body])).toEqual([
      ['PUT', `http://127.0.0.1:54321/auth/v1/admin/users/${ID}`, { ban_duration: '876000h' }],
      ['PUT', `http://127.0.0.1:54321/auth/v1/admin/users/${ID}`, { ban_duration: 'none' }],
      ['PUT', `http://127.0.0.1:54321/auth/v1/admin/users/${ID}`, { email: 'new@madar.test', email_confirm: true }],
      ['PUT', `http://127.0.0.1:54321/auth/v1/admin/users/${ID}`, { email: 'other@madar.test' }],
    ]);
  });

  it('listUsers reads every page and tells who confirmed the email and who saved a password', async () => {
    const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({
      id: `auth-${from + i}`, email: `p${from + i}@madar.test`, email_confirmed_at: (from + i) % 2 === 0 ? '2026-10-04T06:00:00Z' : null,
      // Only the exact true counts: a person who opened the link and left has no mark, and a text value is not the mark.
      user_metadata: from + i === 0 ? { madar_password_set: true } : from + i === 2 ? { madar_password_set: 'true' } : {},
    }));
    const { seen, fetch } = stubFetch([{ status: 200, body: { users: page(1000, 0) } }, { status: 200, body: { users: page(2, 1000) } }]);
    const users = await authAdminPort({ supabaseUrl: URL_, secretKey: SECRET, fetch }).listUsers();
    expect(users).toHaveLength(1002);
    expect(users[0]).toEqual({ authUserId: 'auth-0', email: 'p0@madar.test', confirmed: true, passwordSet: true });
    expect(users[2]).toEqual({ authUserId: 'auth-2', email: 'p2@madar.test', confirmed: true, passwordSet: false });
    expect(users[1001]).toEqual({ authUserId: 'auth-1001', email: 'p1001@madar.test', confirmed: false, passwordSet: false });
    expect(seen.map((s) => s.url)).toEqual([
      'http://127.0.0.1:54321/auth/v1/admin/users?page=1&per_page=1000',
      'http://127.0.0.1:54321/auth/v1/admin/users?page=2&per_page=1000',
    ]);
  });

  it('getUser gives the email and whether it is confirmed, or null for an unknown id', async () => {
    const { seen, fetch } = stubFetch([
      { status: 200, body: { id: ID, email: 'e@madar.test', email_confirmed_at: null } },
      { status: 404, body: { code: 404, error_code: 'user_not_found', msg: 'User not found' } },
    ]);
    const admin = authAdminPort({ supabaseUrl: URL_, secretKey: SECRET, fetch });
    await expect(admin.getUser(ID)).resolves.toEqual({ authUserId: ID, email: 'e@madar.test', confirmed: false, passwordSet: false });
    await expect(admin.getUser(ID)).resolves.toBeNull();
    expect(seen[0]).toMatchObject({ method: 'GET', url: `http://127.0.0.1:54321/auth/v1/admin/users/${ID}` });
  });

  it('refuses an id that would change the path', async () => {
    const { fetch } = stubFetch([]);
    await expect(authAdminPort({ supabaseUrl: URL_, secretKey: SECRET, fetch }).setBanned('../x', true)).rejects.toThrow(/not an Auth user id/);
  });
});
