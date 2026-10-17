import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { authModeOf } from './authMode';
import { bootstrapRemote, remoteConfig } from './bootstrap';
import { SESSION_KEY } from './madarAuth';

describe('the sign-in of the remote build (src/app/remote/authMode.ts)', () => {
  it('is supabase unless the build says madar, and refuses another value', () => {
    expect(authModeOf({})).toBe('supabase');
    expect(authModeOf({ VITE_MADAR_AUTH: 'madar' })).toBe('madar');
    expect(() => authModeOf({ VITE_MADAR_AUTH: 'auth0' })).toThrow('VITE_MADAR_AUTH must be supabase or madar');
  });

  it('keeps the Supabase port on both copies until the switch: no copy sets VITE_MADAR_AUTH', () => {
    for (const copy of ['test', 'production']) expect(readFileSync(`config/remote.${copy}.env`, 'utf8')).not.toContain('VITE_MADAR_AUTH');
  });

  it('needs the page api and no Supabase value for the madar build', () => {
    expect(remoteConfig({ VITE_MADAR_AUTH: 'madar', VITE_API_URL: '/api/' })).toEqual({ supabaseUrl: '', publishableKey: '', apiUrl: '/api', build: '0', auth: 'madar' });
    expect(() => remoteConfig({ VITE_MADAR_AUTH: 'madar' })).toThrow('VITE_API_URL');
    expect(remoteConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }).auth).toBe('supabase');
  });

  it('builds the Madar port and no Supabase client for the madar build', async () => {
    window.localStorage.clear();
    const runtime = await bootstrapRemote({ config: remoteConfig({ VITE_MADAR_AUTH: 'madar', VITE_API_URL: '/api' }), fetch: async () => Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 900, user: { id: 'auth-1' } }) });
    await runtime.auth.signIn('hala@madar.test', 'a good password');
    expect(JSON.parse(window.localStorage.getItem(SESSION_KEY)!).userId).toBe('auth-1');
    expect(runtime.changes.status()).toBe('closed');
  });
});
