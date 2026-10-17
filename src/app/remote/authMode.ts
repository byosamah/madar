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

/** True when this browser keeps a session of the sign-in of the build. Blocked storage, or a bad VITE_MADAR_AUTH, keeps none. */
export function hasStoredSession(env: { VITE_MADAR_AUTH?: string }, storage: () => Pick<Storage, 'getItem'>): boolean {
  try {
    return storage().getItem(SESSION_KEYS[authModeOf(env)]) !== null;
  } catch {
    return false;
  }
}
