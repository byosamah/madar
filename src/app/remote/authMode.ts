/**
 * The sign-in of the remote build (Supabase exit, wave 2): VITE_MADAR_AUTH of config/remote.<env>.env. Unset is supabase, and both
 * copies keep it until the switch: wave 5 sets madar for the test copy, wave 6 for production. madar needs VITE_API_URL (the
 * page's own /api of the Worker).
 */
export type AuthMode = 'supabase' | 'madar';

export function authModeOf(env: { VITE_MADAR_AUTH?: string }): AuthMode {
  const value = env.VITE_MADAR_AUTH?.trim() || 'supabase';
  if (value !== 'supabase' && value !== 'madar') throw new Error(`VITE_MADAR_AUTH must be supabase or madar, not "${value}".`);
  return value;
}

/**
 * The localStorage key of the kept session of each sign-in: the storageKey of the Supabase client (supabase.ts) and the session of
 * the Madar port (madarAuth.ts). This file has no imports, so the entry of the build (main.tsx) reads it at no cost.
 */
export const SESSION_KEYS: Readonly<Record<AuthMode, string>> = { supabase: 'madar.auth', madar: 'madar.session' };

/**
 * The stored Supabase session, read with no network (performance audit 2026-10-21, GP-1): the auth user id, when the stored value
 * holds a refresh token and a user id. The access token lives 15 minutes, but the refresh token lives on, so this means "signed in,
 * and the token still has to renew". Null for no value, a value of another shape, or storage that throws (Safari can refuse it):
 * the caller then waits for Supabase, as before. This function never returns a token.
 */
export function storedSupabaseUser(storage: () => Pick<Storage, 'getItem'>): string | null {
  try {
    const raw = storage().getItem(SESSION_KEYS.supabase);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const session = value as { refresh_token?: unknown; user?: { id?: unknown } | null };
    if (typeof session.refresh_token !== 'string' || session.refresh_token === '') return null;
    const id = session.user?.id;
    return typeof id === 'string' && id !== '' ? id : null;
  } catch {
    return null;
  }
}

/** True when this browser keeps a session of the sign-in of the build. Blocked storage, or a bad VITE_MADAR_AUTH, keeps none. */
export function hasStoredSession(env: { VITE_MADAR_AUTH?: string }, storage: () => Pick<Storage, 'getItem'>): boolean {
  try {
    return storage().getItem(SESSION_KEYS[authModeOf(env)]) !== null;
  } catch {
    return false;
  }
}
