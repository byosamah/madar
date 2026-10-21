import { describe, expect, it, vi } from 'vitest';

// The remote build gives these three packages an empty stand-in (performance audit 2026-10-21, FL-5). This test does the same
// for the test run, and checks that the client still builds and still offers the two parts that the screens use.
vi.mock('@supabase/storage-js', async () => await import('../../stubs/unusedClients'));
vi.mock('@supabase/postgrest-js', async () => await import('../../stubs/unusedClients'));
vi.mock('@supabase/functions-js', async () => await import('../../stubs/unusedClients'));

describe('the Supabase client with the unused clients stubbed (FL-5)', () => {
  it('builds, and offers the sign-in and Realtime parts that the screens use', async () => {
    const { createSupabase } = await import('./supabase');
    const client = createSupabase({ url: 'https://ref.supabase.co', publishableKey: 'sb_publishable_test' });
    expect(typeof client.auth.getSession).toBe('function');
    expect(typeof client.auth.signInWithPassword).toBe('function');
    expect(typeof client.auth.onAuthStateChange).toBe('function');
    expect(typeof client.channel).toBe('function');
    expect(typeof client.removeChannel).toBe('function');
    expect(typeof client.realtime.setAuth).toBe('function');
    const channel = client.channel('office');
    expect(typeof channel.on).toBe('function');
    expect(typeof channel.subscribe).toBe('function');
    await client.removeChannel(channel);
  });
});
