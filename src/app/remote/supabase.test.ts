import { beforeEach, describe, expect, it, vi } from 'vitest';

const connect = vi.fn();
const createClient = vi.fn((..._args: unknown[]) => ({ auth: {}, realtime: { connect } }));
vi.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => createClient(...args) }));

type Options = { auth: unknown; realtime: { heartbeatCallback: (status: string, latency?: number) => void } };
const optionsOf = (): Options => createClient.mock.calls.at(-1)![2] as Options;

beforeEach(() => {
  connect.mockReset();
  createClient.mockClear();
});

describe('the Supabase client of the real screens', () => {
  it('uses PKCE, reads the link tokens itself, keeps and refreshes the session under madar.auth (client map 7.2)', async () => {
    const { createSupabase } = await import('./supabase');
    createSupabase({ url: 'https://ref.supabase.co', publishableKey: 'sb_publishable_x' });
    expect(createClient).toHaveBeenCalledWith('https://ref.supabase.co', 'sb_publishable_x', {
      auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true, storageKey: 'madar.auth' },
      realtime: { heartbeatCallback: expect.any(Function) },
    });
  });

  // BG-4, step 1 (performance audit 2026-10-21): a hidden tab throttles the heartbeat timer, so the server may drop the socket. Realtime
  // then waits for its own slow timer to join again. The callback asks for the connection at once. No worker option, no CSP change.
  it('connects the Realtime socket again when a heartbeat times out or the socket is gone', async () => {
    const { createSupabase } = await import('./supabase');
    createSupabase({ url: 'https://ref.supabase.co', publishableKey: 'sb_publishable_x' });
    const { heartbeatCallback } = optionsOf().realtime;
    for (const status of ['sent', 'ok', 'error']) heartbeatCallback(status, 12);
    expect(connect).not.toHaveBeenCalled();
    heartbeatCallback('timeout');
    heartbeatCallback('disconnected');
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('ignores an error of connect, because the next heartbeat tries again', async () => {
    const { createSupabase } = await import('./supabase');
    createSupabase({ url: 'https://ref.supabase.co', publishableKey: 'sb_publishable_x' });
    connect.mockImplementation(() => {
      throw new Error('WebSocket not available');
    });
    expect(() => optionsOf().realtime.heartbeatCallback('timeout')).not.toThrow();
  });
});
