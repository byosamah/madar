import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { AuthFailure, type AuthFailureReason } from '../../features/auth/authFailure';
import type { AuthPort, AuthStatus } from '../auth';

/**
 * The sign-in port of the real screens, over Supabase Auth (plan 5.1, client map 7.2). Only the remote build imports this file:
 * src/app/remote/bootstrap.ts (track R2) makes it with the client of supabase.ts and puts it in the runtime as `auth`.
 */
const LINK_ENDED_CODES = new Set(['otp_expired', 'flow_state_expired', 'flow_state_not_found', 'invite_not_found', 'validation_failed', 'bad_jwt']);

/** Turns a Supabase error into a reason the screens can say. `link` is true for the token of an invitation or reset link. */
function reasonFor(error: unknown, link = false): AuthFailureReason {
  const e = (error ?? {}) as { name?: string; code?: string; status?: number };
  if (e.name === 'AuthRetryableFetchError' || error instanceof TypeError) return 'offline';
  if (e.code === 'over_request_rate_limit' || e.code === 'over_email_send_rate_limit' || e.status === 429) return 'too_many';
  if (e.code === 'invalid_credentials') return 'wrong_credentials';
  if (e.code === 'user_banned') return 'account_off';
  if (e.code === 'weak_password' || e.name === 'AuthWeakPasswordError') return 'weak';
  if (e.code === 'same_password') return 'same';
  if (link && (LINK_ENDED_CODES.has(e.code ?? '') || e.status === 403 || e.status === 404)) return 'link_ended';
  return 'failed';
}

function fail(error: unknown, link = false): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new AuthFailure(reasonFor(error, link), message);
}

export async function createSupabaseAuth(supabase: SupabaseClient, o: { apiUrl: string; fetch?: typeof fetch }): Promise<AuthPort> {
  const send = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const forgotUrl = `${o.apiUrl.replace(/\/+$/, '')}/auth/forgot?forceFunctionRegion=eu-central-1`;
  const listeners = new Set<(status: AuthStatus) => void>();
  const { data } = await supabase.auth.getSession();
  let status: AuthStatus = data.session ? 'signed_in' : 'signed_out';

  // Supabase tells each change: sign-in, refresh, sign-out, and the end of a session whose refresh failed.
  // The callback must not call Supabase again (supabase-js holds a lock while it runs), so it only notes the status.
  supabase.auth.onAuthStateChange((_event: string, session: Session | null) => {
    const next: AuthStatus = session ? 'signed_in' : 'signed_out';
    if (next === status) return;
    status = next;
    for (const listener of [...listeners]) listener(next);
  });

  return {
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) fail(error);
    },
    async signOut(options) {
      if (options?.scope === 'others') {
        const { error } = await supabase.auth.signOut({ scope: 'others' });
        if (error) fail(error);
        return;
      }
      // This device only: a person who signs out on the office computer stays signed in on their phone.
      // Supabase clears the kept session even when the server does not answer, so a sign-out never fails here.
      await supabase.auth.signOut({ scope: 'local' });
      await supabase.removeAllChannels();
    },
    async accessToken() {
      // getSession refreshes an access token that has ended, with the kept refresh token.
      const { data: current } = await supabase.auth.getSession();
      return current.session?.access_token ?? null;
    },
    async verifyLink(tokenHash, type) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) fail(error, true);
    },
    async setPassword(password) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) fail(error);
    },
    async requestReset(email) {
      let response: Response;
      try {
        response = await send(forgotUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      } catch (error) {
        throw new AuthFailure('offline', error instanceof Error ? error.message : 'The request did not reach Madar.');
      }
      if (response.status === 429) throw new AuthFailure('too_many');
      if (!response.ok) throw new AuthFailure('failed', `The reset request failed with ${response.status}.`);
    },
  };
}
