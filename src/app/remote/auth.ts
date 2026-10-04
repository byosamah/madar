import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { AuthFailure, type AuthFailureReason } from '../../features/auth/authFailure';
import { clearLeaving, leftOnPurpose, markLeaving, type SessionChange, type SessionListener } from '../../features/auth/sessionEnd';
import type { AuthPort, AuthStatus } from '../auth';

/**
 * The sign-in port of the real screens, over Supabase Auth (plan 5.1, client map 7.2). Only the remote build imports this file:
 * src/app/remote/bootstrap.ts (track R2) makes it with the client of supabase.ts and puts it in the runtime as `auth`.
 */
// The storage key of the kept session (supabase.ts) and of the PKCE code that goes with it.
const SESSION_KEYS = ['madar.auth', 'madar.auth-code-verifier'];

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

// Auth refuses a password change with no current password, or a wrong one, with these codes (supabase/auth, user.go).
const CURRENT_PASSWORD_CODES = new Set(['current_password_invalid', 'current_password_required']);

function fail(error: unknown, link = false): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new AuthFailure(reasonFor(error, link), message);
}

export async function createSupabaseAuth(supabase: SupabaseClient, o: { apiUrl: string; fetch?: typeof fetch }): Promise<AuthPort> {
  const send = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const forgotUrl = `${o.apiUrl.replace(/\/+$/, '')}/auth/forgot?forceFunctionRegion=eu-central-1`;
  const listeners = new Set<SessionListener>();
  const { data } = await supabase.auth.getSession();
  let status: AuthStatus = data.session ? 'signed_in' : 'signed_out';
  // The person of the last session. It stays after a sign-out, so a sign-in of someone else in any tab counts as a change.
  let userId: string | null = data.session?.user?.id ?? null;
  const tell = (next: AuthStatus, change?: SessionChange) => {
    status = next;
    for (const listener of [...listeners]) listener(next, change);
  };

  // Supabase tells each change: sign-in, refresh, sign-out, and the end of a session whose refresh failed. It also tells the
  // changes of the other tabs of this browser. The callback must not call Supabase again (supabase-js holds a lock while it runs),
  // so it only notes the status and why it changed.
  supabase.auth.onAuthStateChange((_event: string, session: Session | null) => {
    const next: AuthStatus = session ? 'signed_in' : 'signed_out';
    const id = session?.user?.id ?? null;
    const otherPerson = id !== null && userId !== null && id !== userId;
    if (id !== null) userId = id;
    if (otherPerson) tell(next, 'person');
    else if (next !== status) tell(next, next === 'signed_out' && leftOnPurpose() ? 'left' : undefined);
  });

  return {
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signIn(email, password) {
      clearLeaving();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) fail(error);
    },
    async signOut(options) {
      if (options?.scope === 'others') {
        const { error } = await supabase.auth.signOut({ scope: 'others' });
        if (error) fail(error);
        return;
      }
      // This device only: a person who signs out on the office computer stays signed in on their phone. The mark first, so the
      // other tabs read this sign-out as one on purpose when Supabase tells them.
      markLeaving();
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) {
        // Supabase keeps the session when it cannot refresh an ended token (offline), so the kept session goes here. Else the
        // next person at this computer opens the account of this one when the network comes back.
        for (const key of SESSION_KEYS) {
          try { window.localStorage.removeItem(key); } catch { /* blocked storage */ }
        }
        if (status !== 'signed_out') tell('signed_out', 'left');
      }
      await supabase.removeAllChannels();
    },
    async accessToken() {
      // getSession refreshes an access token that has ended, with the kept refresh token.
      const { data: current } = await supabase.auth.getSession();
      return current.session?.access_token ?? null;
    },
    async verifyLink(tokenHash, type) {
      clearLeaving();
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) fail(error, true);
    },
    async setPassword(password) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) fail(error);
    },
    async changePassword(current, next) {
      // A sign-in checks the current password first. Auth checks current_password only with "require current password" on,
      // and never in a recovery session (supabase/auth, user.go). That setting is off on madar-test today (proof.md Z0a,
      // item 2), and then any text in Current password would set a new password. The sign-in starts a session beside the
      // one of this device; the sign-out of the other devices after the change ends it.
      const { data: kept } = await supabase.auth.getSession();
      const email = kept.session?.user?.email;
      if (!email) throw new AuthFailure('failed', 'The session names no email.');
      const check = await supabase.auth.signInWithPassword({ email, password: current });
      if (check.error) fail(check.error);
      // With the setting on, Auth refuses a new password without the current one, so the update carries it too.
      const { error } = await supabase.auth.updateUser({ password: next, current_password: current });
      if (!error) return;
      const code = (error as { code?: string }).code ?? '';
      if (CURRENT_PASSWORD_CODES.has(code)) throw new AuthFailure('wrong_credentials', error.message);
      fail(error);
    },
    async requestReset(email) {
      let response: Response;
      try {
        response = await send(forgotUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      } catch (error) {
        throw new AuthFailure('offline', error instanceof Error ? error.message : 'The request did not reach Madar.');
      }
      if (response.status === 429) {
        // The limit of one email (server/auth/forgot.ts) has its own words: reset mails already went to it.
        const body = (await response.json().catch(() => null)) as { error?: { details?: { reason?: unknown } } } | null;
        throw new AuthFailure(body?.error?.details?.reason === 'too_many_resets_email' ? 'too_many_resets' : 'too_many');
      }
      if (!response.ok) throw new AuthFailure('failed', `The reset request failed with ${response.status}.`);
    },
  };
}
