import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SESSION_KEYS } from './authMode';

/**
 * The Supabase client of the real screens (client map 7.2): PKCE, Madar reads the link tokens itself, and the session is kept
 * and refreshed under one storage key. Only the remote build imports this file.
 */
export function createSupabase(o: { url: string; publishableKey: string }): SupabaseClient {
  const supabase: SupabaseClient = createClient(o.url, o.publishableKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true, storageKey: SESSION_KEYS.supabase },
    // A hidden tab throttles the timer of the heartbeat (every 25 s), and the server drops a socket that sends none for about a
    // minute. The client then waits for its own slow timer to join again. On a missed or lost heartbeat the callback asks for the
    // connection at once. connect() does nothing while the socket is connecting or connected. No worker option and no CSP change
    // (performance audit 2026-10-21, BG-4 step 1). Safari needs nothing new: this uses no API that it lacks.
    realtime: {
      heartbeatCallback: (status) => {
        if (status !== 'disconnected' && status !== 'timeout') return;
        try {
          supabase.realtime.connect();
        } catch {
          // The next heartbeat tries again.
        }
      },
    },
  });
  return supabase;
}
