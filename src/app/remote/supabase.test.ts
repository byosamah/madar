import { describe, expect, it, vi } from 'vitest';

const createClient = vi.fn((..._args: unknown[]) => ({ auth: {} }));
vi.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => createClient(...args) }));

describe('the Supabase client of the real screens', () => {
  it('uses PKCE, reads the link tokens itself, keeps and refreshes the session under madar.auth (client map 7.2)', async () => {
    const { createSupabase } = await import('./supabase');
    createSupabase({ url: 'https://ref.supabase.co', publishableKey: 'sb_publishable_x' });
    expect(createClient).toHaveBeenCalledWith('https://ref.supabase.co', 'sb_publishable_x', {
      auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true, storageKey: 'madar.auth' },
    });
  });
});
