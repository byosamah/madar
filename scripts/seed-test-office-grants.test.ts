import { describe, expect, it, vi } from 'vitest';
import { seedAuthPort } from './seed-test-office';

/**
 * The seed signs in as each of the 4 accounts and revokes the AI app grants of it (2026-10-05): a check that approved an app
 * left a grant in Auth, Settings, Agents then showed it after a seed, and the walk failed. Auth has no admin call for one
 * person's grant (proof.md H), so the account's own session revokes it, as the Remove button does.
 */
const URL_ = 'https://qdgwpnesxppnqsaabqzd.supabase.co';
type Sent = { url: string; method: string; auth: string | null };

function fakeFetch(o: { tokenStatus?: number; grants?: unknown; listStatus?: number } = {}) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    sent.push({ url: url.replace(URL_, ''), method: init?.method ?? 'GET', auth: headers.get('Authorization') });
    if (url.includes('/token?grant_type=password')) {
      const status = o.tokenStatus ?? 200;
      return new Response(JSON.stringify(status === 200 ? { access_token: 'user-token' } : { error: 'invalid_grant' }), { status });
    }
    if (url.endsWith('/user/oauth/grants')) return new Response(JSON.stringify(o.grants ?? []), { status: o.listStatus ?? 200 });
    return new Response(null, { status: 204 });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

describe('seedAuthPort.revokeGrants', () => {
  it('signs in, lists the grants, revokes each with the session of the account, then signs out', async () => {
    const { sent, fetch } = fakeFetch({ grants: [{ client: { id: 'c-1', name: 'Claude' } }, { client: { id: 'c 2' } }] });
    const n = await seedAuthPort({ supabaseUrl: URL_, secretKey: 'sb_secret_x', fetch }).revokeGrants('member@madar.test', 'Member-pass-1');
    expect(n).toBe(2);
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([
      'POST /auth/v1/token?grant_type=password',
      'GET /auth/v1/user/oauth/grants',
      'DELETE /auth/v1/user/oauth/grants?client_id=c-1',
      'DELETE /auth/v1/user/oauth/grants?client_id=c%202',
      'POST /auth/v1/logout?scope=local',
    ]);
    expect(sent.slice(1).every((s) => s.auth === 'Bearer user-token')).toBe(true);
  });

  it('revokes nothing for an account with no grants, and an Auth without the OAuth server (404) counts as none', async () => {
    for (const o of [{ grants: [] }, { listStatus: 404 }]) {
      const { sent, fetch } = fakeFetch(o);
      expect(await seedAuthPort({ supabaseUrl: URL_, secretKey: 'sb_secret_x', fetch }).revokeGrants('admin@madar.test', 'Admin-pass-1')).toBe(0);
      expect(sent.filter((s) => s.method === 'DELETE')).toHaveLength(0);
    }
  });

  it('stops with a clear message when Auth refuses the sign-in, and never shows the password', async () => {
    const { fetch } = fakeFetch({ tokenStatus: 400 });
    const error = await seedAuthPort({ supabaseUrl: URL_, secretKey: 'sb_secret_x', fetch }).revokeGrants('admin@madar.test', 'Admin-pass-1').catch((e: unknown) => e as Error);
    expect(String(error)).toMatch(/admin@madar\.test/);
    expect(String(error)).not.toContain('Admin-pass-1');
  });
});
