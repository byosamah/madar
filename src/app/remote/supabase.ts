import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The Supabase client of the real screens (client map 7.2): PKCE, Madar reads the link tokens itself, and the session is kept
 * and refreshed under one storage key. Only the remote build imports this file.
 */
export function createSupabase(o: { url: string; publishableKey: string }): SupabaseClient {
  return createClient(o.url, o.publishableKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true, storageKey: 'madar.auth' },
  });
}
