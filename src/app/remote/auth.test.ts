import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthFailure } from '../../features/auth/authFailure';
import { createSupabaseAuth } from './auth';

type StubSession = { access_token: string; user?: { id: string; email?: string } };
type Listener = (event: string, session: StubSession | null) => void;

/** A Supabase client with only the auth parts that the port uses. Each method answers what the test gives it. */
function stubClient(o: { session?: StubSession | null; results?: Record<string, { error: unknown } | (() => { error: unknown })> } = {}) {
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
        session = { access_token: 'token-2', user: { id: o.session?.user?.id ?? 'usr_001', email: input.email } };
        listener('SIGNED_IN', session);
      }
      return { data: {}, ...result };
    }),
    signOut: vi.fn(async (input?: { scope?: string }) => {
      steps.push(`signOut:${input?.scope}`);
      steps.push(`leaving:${window.localStorage.getItem('madar.auth.leaving')}`);
      const result = answer('signOut');
      // As auth-js 2.117.2: a session it cannot refresh gives an error, and then it keeps the session.
      if (result.error) return result;
      if (input?.scope !== 'others') {
        session = null;
        listener('SIGNED_OUT', null);
      }
      return result;
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
  return { client, steps, fire: (event: string, next: StubSession | null) => { session = next; listener(event, next); } };
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
    expect(stub.steps).toEqual(['signOut:local', 'leaving:1', 'removeAllChannels']);
    expect(auth.status()).toBe('signed_out');
  });

  it('removes the kept session itself when Supabase cannot end it, so the next person cannot open the account', async () => {
    const stub = stubClient({
      session: { access_token: 'token-1', user: { id: 'usr_001' } },
      results: { signOut: { error: Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError', status: 0 }) } },
    });
    const auth = await createSupabaseAuth(stub.client, { apiUrl: 'https://api.test' });
    window.localStorage.setItem('madar.auth', '{"refresh_token":"kept"}');
    window.localStorage.setItem('madar.auth-code-verifier', 'kept');
    const seen: string[] = [];
    auth.subscribe((status) => seen.push(status));
    await expect(auth.signOut()).resolves.toBeUndefined();
    expect(window.localStorage.getItem('madar.auth')).toBeNull();
    expect(window.localStorage.getItem('madar.auth-code-verifier')).toBeNull();
    expect(auth.status()).toBe('signed_out');
    expect(seen).toEqual(['signed_out']);
    expect(stub.steps).toContain('removeAllChannels');
  });

  it('tells a sign-out on purpose in another tab apart from an ended session, and names a change of person', async () => {
    const stub = stubClient({ session: { access_token: 'token-1', user: { id: 'usr_001' } } });
    const auth = await createSupabaseAuth(stub.client, { apiUrl: 'https://api.test' });
    const seen: string[] = [];
    auth.subscribe((status, change?: string) => seen.push(`${status}:${change ?? '-'}`));
    // The session ends with no sign-out: the refresh token is gone.
    stub.fire('SIGNED_OUT', null);
    // The same person signs in again (the session sheet), then another tab signs out on purpose.
    stub.fire('SIGNED_IN', { access_token: 'token-2', user: { id: 'usr_001' } });
    window.localStorage.setItem('madar.auth.leaving', '1');
    stub.fire('SIGNED_OUT', null);
    // Another tab signs in as another person.
    window.localStorage.removeItem('madar.auth.leaving');
    stub.fire('SIGNED_IN', { access_token: 'token-3', user: { id: 'usr_002' } });
    // While signed in, a third person signs in from another tab: the status stays, the person changes.
    stub.fire('SIGNED_IN', { access_token: 'token-4', user: { id: 'usr_003' } });
    // A refresh or a new sign-in of the same person says nothing.
    stub.fire('TOKEN_REFRESHED', { access_token: 'token-5', user: { id: 'usr_003' } });
    stub.fire('SIGNED_IN', { access_token: 'token-6', user: { id: 'usr_003' } });
    expect(seen).toEqual(['signed_out:-', 'signed_in:-', 'signed_out:left', 'signed_in:person', 'signed_in:person']);
  });

  it('forgets the mark of a sign-out on purpose at the next sign-in or link', async () => {
    const stub = stubClient();
    const auth = await createSupabaseAuth(stub.client, { apiUrl: 'https://api.test' });
    window.localStorage.setItem('madar.auth.leaving', '1');
    await auth.signIn('a@b.test', 'right-pass');
    expect(window.localStorage.getItem('madar.auth.leaving')).toBeNull();
    window.localStorage.setItem('madar.auth.leaving', '1');
    await auth.verifyLink('hash-1', 'invite');
    expect(window.localStorage.getItem('madar.auth.leaving')).toBeNull();
  });

  it('signs out the other devices after a reset and keeps this one', async () => {
    const stub = stubClient({ session: { access_token: 'token-1' } });
    const auth = await createSupabaseAuth(stub.client, { apiUrl: 'https://api.test' });
    await auth.signOut({ scope: 'others' });
    expect(stub.steps).toEqual(['signOut:others', 'leaving:null']);
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

  const hala = { access_token: 'token-1', user: { id: 'usr_001', email: 'hala@office.test' } };

  it('checks the current password with a sign-in, then sends it with the new one (proof.md Z0a, item 2)', async () => {
    const stub = stubClient({ session: hala });
    const auth = await createSupabaseAuth(stub.client, { apiUrl: 'https://api.test' });
    const seen: string[] = [];
    auth.subscribe((status: string, change?: string) => {
      seen.push(`${status}:${change}`);
    });
    await auth.changePassword('old-pass-11', 'green-field-77');
    expect(stub.client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'hala@office.test', password: 'old-pass-11' });
    // With "require current password" on, Auth refuses a new password without the current one, so the update carries it too.
    expect(stub.client.auth.updateUser).toHaveBeenCalledWith({ password: 'green-field-77', current_password: 'old-pass-11' });
    expect(stub.steps).toEqual(['signIn:hala@office.test', 'updateUser']);
    // The check signs in the same person again: the screens see no change of session.
    expect(seen).toEqual([]);
    expect(auth.status()).toBe('signed_in');
  });

  it('refuses a wrong current password also when Auth does not check it (the setting off, or a recovery session)', async () => {
    // As Auth with "require current password" off: the update ignores current_password and would set any new password.
    const stub = stubClient({ session: hala, results: { signIn: { error: apiError('invalid_credentials') } } });
    const auth = await createSupabaseAuth(stub.client, { apiUrl: 'https://api.test' });
    await expect(auth.changePassword('not-the-password', 'green-field-77')).rejects.toMatchObject({ reason: 'wrong_credentials' });
    expect(stub.client.auth.updateUser).not.toHaveBeenCalled();
  });

  it('changes no password when the session names no email', async () => {
    const stub = stubClient({ session: { access_token: 'token-1', user: { id: 'usr_001' } } });
    const auth = await createSupabaseAuth(stub.client, { apiUrl: 'https://api.test' });
    await expect(auth.changePassword('old-pass-11', 'green-field-77')).rejects.toMatchObject({ reason: 'failed' });
    expect(stub.steps).toEqual([]);
  });

  it('names a wrong current password as a wrong password, and keeps the other refusals', async () => {
    const cases: [string, unknown, string][] = [
      ['signIn', apiError('invalid_credentials'), 'wrong_credentials'],
      ['signIn', apiError('over_request_rate_limit', 429), 'too_many'],
      ['updateUser', apiError('current_password_invalid'), 'wrong_credentials'],
      ['updateUser', apiError('current_password_required'), 'wrong_credentials'],
      ['updateUser', apiError('weak_password', 422), 'weak'],
      ['updateUser', apiError('same_password', 422), 'same'],
      ['updateUser', apiError('over_request_rate_limit', 429), 'too_many'],
    ];
    for (const [step, error, reason] of cases) {
      const auth = await createSupabaseAuth(stubClient({ session: hala, results: { [step]: { error } } }).client, { apiUrl: 'https://api.test' });
      await expect(auth.changePassword('old-pass-11', 'green-field-77')).rejects.toMatchObject({ reason });
    }
    // The Welcome and Reset screens set a password from a link session, with no current one: the same codes never mean a wrong password there.
    const port = await createSupabaseAuth(stubClient({ results: { updateUser: { error: apiError('current_password_required') } } }).client, { apiUrl: 'https://api.test' });
    await expect(port.setPassword('green-field-77')).rejects.toMatchObject({ reason: 'failed' });
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
