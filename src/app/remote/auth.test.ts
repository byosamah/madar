import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthFailure } from '../../features/auth/authFailure';
import { createSupabaseAuth } from './auth';

type Listener = (event: string, session: { access_token: string } | null) => void;

/** A Supabase client with only the auth parts that the port uses. Each method answers what the test gives it. */
function stubClient(o: { session?: { access_token: string } | null; results?: Record<string, { error: unknown } | (() => { error: unknown })> } = {}) {
  let session = o.session ?? null;
  let listener: Listener = () => undefined;
  const steps: string[] = [];
  const answer = (name: string) => {
    const result = o.results?.[name];
    return (typeof result === 'function' ? result() : result) ?? { error: null };
  };
  const auth = {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn((callback: Listener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: () => undefined } } };
    }),
    signInWithPassword: vi.fn(async (input: { email: string; password: string }) => {
      steps.push(`signIn:${input.email}`);
      const result = answer('signIn');
      if (!result.error) {
        session = { access_token: 'token-2' };
        listener('SIGNED_IN', session);
      }
      return { data: {}, ...result };
    }),
    signOut: vi.fn(async (input?: { scope?: string }) => {
      steps.push(`signOut:${input?.scope}`);
      if (input?.scope !== 'others') {
        session = null;
        listener('SIGNED_OUT', null);
      }
      return answer('signOut');
    }),
    verifyOtp: vi.fn(async (input: { token_hash: string; type: string }) => {
      steps.push(`verifyOtp:${input.type}:${input.token_hash}`);
      return { data: {}, ...answer('verifyOtp') };
    }),
    updateUser: vi.fn(async () => {
      steps.push('updateUser');
      return { data: {}, ...answer('updateUser') };
    }),
  };
  const client = {
    auth,
    removeAllChannels: vi.fn(async () => {
      steps.push('removeAllChannels');
      return [];
    }),
  } as unknown as SupabaseClient;
  return { client, steps, fire: (event: string, next: { access_token: string } | null) => { session = next; listener(event, next); } };
}

const apiError = (code: string, status = 400) => Object.assign(new Error(code), { name: 'AuthApiError', code, status, __isAuthError: true });

describe('the Supabase sign-in port (plan 5.1, client map 7.2)', () => {
  it('starts with the kept session and follows each change of it', async () => {
    const stub = stubClient({ session: { access_token: 'token-1' } });
    const auth = await createSupabaseAuth(stub.client, { apiUrl: 'https://api.test/functions/v1/api' });
    expect(auth.status()).toBe('signed_in');
    expect(await auth.accessToken()).toBe('token-1');
    const seen: string[] = [];
    const stop = auth.subscribe((status) => seen.push(status));
    stub.fire('TOKEN_REFRESHED', { access_token: 'token-3' });
    stub.fire('SIGNED_OUT', null);
    stop();
    stub.fire('SIGNED_IN', { access_token: 'token-4' });
    expect(seen).toEqual(['signed_out']);
    expect(auth.status()).toBe('signed_in');
  });

  it('signs in, and turns a wrong email or password into one reason', async () => {
    const stub = stubClient({ results: { signIn: { error: apiError('invalid_credentials') } } });
    const auth = await createSupabaseAuth(stub.client, { apiUrl: 'https://api.test' });
    expect(auth.status()).toBe('signed_out');
    await expect(auth.signIn('a@b.test', 'x')).rejects.toMatchObject({ reason: 'wrong_credentials' });
    const good = stubClient();
    const port = await createSupabaseAuth(good.client, { apiUrl: 'https://api.test' });
    await port.signIn('a@b.test', 'right-pass');
    expect(port.status()).toBe('signed_in');
  });

  it('names each Supabase refusal in words the screens have', async () => {
    const cases: [unknown, string][] = [
      [apiError('user_banned'), 'account_off'],
      [apiError('over_request_rate_limit', 429), 'too_many'],
      [Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError', status: 0 }), 'offline'],
      [apiError('unexpected_failure', 500), 'failed'],
    ];
    for (const [error, reason] of cases) {
      const auth = await createSupabaseAuth(stubClient({ results: { signIn: { error } } }).client, { apiUrl: 'https://api.test' });
      await expect(auth.signIn('a@b.test', 'x')).rejects.toMatchObject({ reason });
    }
  });

  it('signs out on this device only, then closes the Realtime channels', async () => {
    const stub = stubClient({ session: { access_token: 'token-1' } });
    const auth = await createSupabaseAuth(stub.client, { apiUrl: 'https://api.test' });
    await auth.signOut();
    expect(stub.steps).toEqual(['signOut:local', 'removeAllChannels']);
    expect(auth.status()).toBe('signed_out');
  });

  it('signs out the other devices after a reset and keeps this one', async () => {
    const stub = stubClient({ session: { access_token: 'token-1' } });
    const auth = await createSupabaseAuth(stub.client, { apiUrl: 'https://api.test' });
    await auth.signOut({ scope: 'others' });
    expect(stub.steps).toEqual(['signOut:others']);
    expect(auth.status()).toBe('signed_in');
  });

  it('uses a link token once and says the link has ended for any refusal of it', async () => {
    const stub = stubClient();
    const auth = await createSupabaseAuth(stub.client, { apiUrl: 'https://api.test' });
    await auth.verifyLink('hash-1', 'invite');
    expect(stub.steps).toEqual(['verifyOtp:invite:hash-1']);
    for (const code of ['otp_expired', 'flow_state_expired', 'validation_failed']) {
      const ended = await createSupabaseAuth(stubClient({ results: { verifyOtp: { error: apiError(code, 403) } } }).client, { apiUrl: 'https://api.test' });
      await expect(ended.verifyLink('hash-1', 'recovery')).rejects.toMatchObject({ reason: 'link_ended' });
    }
  });

  it('sets a password and names a weak or an unchanged one', async () => {
    const auth = await createSupabaseAuth(stubClient().client, { apiUrl: 'https://api.test' });
    await expect(auth.setPassword('green-field-77')).resolves.toBeUndefined();
    for (const [code, reason] of [['weak_password', 'weak'], ['same_password', 'same']]) {
      const port = await createSupabaseAuth(stubClient({ results: { updateUser: { error: apiError(code, 422) } } }).client, { apiUrl: 'https://api.test' });
      await expect(port.setPassword('x')).rejects.toBeInstanceOf(AuthFailure);
      await expect(port.setPassword('x')).rejects.toMatchObject({ reason });
    }
  });

  it('asks the Madar server for a reset link in Frankfurt and never says whether the email exists', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const auth = await createSupabaseAuth(stubClient().client, { apiUrl: 'https://api.test/functions/v1/api/', fetch });
    await auth.requestReset('hala.nasser@madar.test');
    expect(fetch).toHaveBeenCalledWith('https://api.test/functions/v1/api/auth/forgot?forceFunctionRegion=eu-central-1', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'hala.nasser@madar.test' }),
    });
  });

  it('names a refused or a lost reset request', async () => {
    const cases: [() => Promise<Response>, string][] = [
      [async () => new Response('', { status: 429 }), 'too_many'],
      [async () => new Response('', { status: 500 }), 'failed'],
      [async () => { throw new TypeError('Failed to fetch'); }, 'offline'],
    ];
    for (const [answer, reason] of cases) {
      const auth = await createSupabaseAuth(stubClient().client, { apiUrl: 'https://api.test', fetch: vi.fn(answer) });
      await expect(auth.requestReset('a@b.test')).rejects.toMatchObject({ reason });
    }
  });
});
