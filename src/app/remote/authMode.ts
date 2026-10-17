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
