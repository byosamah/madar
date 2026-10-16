import { describe, expect, it } from 'vitest';
import { buildId, parsePublicEnv, remotePublicEnv, remoteSteps } from './build-remote.ts';

describe('parsePublicEnv', () => {
  it('reads VITE_ values, skips comments and blank lines, and sets the remote flag', () => {
    const env = parsePublicEnv('# test deployment\n\nVITE_SUPABASE_URL=https://x.supabase.co\nVITE_API_URL="https://x.supabase.co/functions/v1/api"\n');
    expect(env).toEqual({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_API_URL: 'https://x.supabase.co/functions/v1/api',
      VITE_MADAR_API: 'remote',
    });
  });

  it('refuses a name without the VITE_ prefix, so no secret reaches the page by mistake', () => {
    expect(() => parsePublicEnv('RESEND_API_KEY=re_123')).toThrow(/RESEND_API_KEY/);
  });

  it('refuses a fake flag in a remote file', () => {
    expect(() => parsePublicEnv('VITE_MADAR_API=fake')).toThrow(/VITE_MADAR_API/);
  });
});

describe('remotePublicEnv (owner, 2026-10-16)', () => {
  const FILE = 'VITE_SUPABASE_URL=https://qdgwpnesxppnqsaabqzd.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_x\n';

  it('takes the API address from config/server-host.json: the page api on the Worker, the api function on Supabase', () => {
    expect(remotePublicEnv('test', FILE, { setting: { test: 'workers', production: 'supabase' } }).VITE_API_URL).toBe('/api');
    expect(remotePublicEnv('test', FILE, { setting: { test: 'supabase', production: 'workers' } }).VITE_API_URL).toBe('https://qdgwpnesxppnqsaabqzd.supabase.co/functions/v1/api');
    expect(remotePublicEnv('production', FILE, { setting: { test: 'supabase', production: 'workers' } }).VITE_API_URL).toBe('/api');
    expect(remotePublicEnv('production', FILE, { setting: { test: 'workers', production: 'supabase' } }).VITE_API_URL).toBe('https://oprkvdjudjxxhvodkzgs.supabase.co/functions/v1/api');
  });

  it('keeps the other public values and the remote flag', () => {
    expect(remotePublicEnv('test', FILE, { setting: { test: 'workers', production: 'workers' } })).toEqual({
      VITE_SUPABASE_URL: 'https://qdgwpnesxppnqsaabqzd.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
      VITE_MADAR_API: 'remote',
      VITE_API_URL: '/api',
    });
  });

  it('refuses a VITE_API_URL line in the public file, so the setting is the one place that decides it', () => {
    expect(() => remotePublicEnv('test', `${FILE}VITE_API_URL=https://qdgwpnesxppnqsaabqzd.supabase.co/functions/v1/api\n`)).toThrow(/VITE_API_URL.*config\/server-host\.json/);
  });

  it('gives the dev server the api function: Vite runs no Pages Function, so the page api does not exist there', () => {
    expect(remotePublicEnv('test', FILE, { dev: true, setting: { test: 'workers', production: 'workers' } }).VITE_API_URL).toBe('https://qdgwpnesxppnqsaabqzd.supabase.co/functions/v1/api');
  });
});

describe('remoteSteps', () => {
  it('runs the RTL check, both type checks, the build in the remote mode, then the bundle check', () => {
    expect(remoteSteps('test').map((step) => step.join(' '))).toEqual([
      'node scripts/check-rtl.ts',
      'npx tsc -p tsconfig.json',
      'npx tsc -p tsconfig.server.json',
      'npx vite build --mode remote-test',
      'node scripts/check-bundles.ts remote',
    ]);
  });
});

describe('buildId', () => {
  it('names the UTC day of the build, which the server compares part by part with MIN_CLIENT_BUILD', () => {
    expect(buildId(new Date('2026-10-04T23:30:00Z'))).toBe('2026.10.4');
    expect(buildId(new Date('2026-10-04T21:30:00-03:00'))).toBe('2026.10.5');
  });
});
