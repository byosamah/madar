import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SERVER_HOST_SETTING, screensApiUrl } from '../../server/core/serverHost';
import { parsePublicEnv, remotePublicEnv } from '../build-remote.ts';

/** config/remote.<env>.env (plan, section 3, rule 6; task O3): the public values of each deployment, and nothing else. */
const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
const accounts = read('docs/superpowers/real-build/accounts.md');
const REFS = { test: 'qdgwpnesxppnqsaabqzd', production: 'oprkvdjudjxxhvodkzgs' } as const;

describe('config/remote.<env>.env', () => {
  for (const [target, ref] of Object.entries(REFS)) {
    const text = read(`config/remote.${target}.env`);
    const env = parsePublicEnv(text);

    it(`${target}: names the project of accounts.md, and only that project`, () => {
      expect(accounts).toContain(ref);
      expect(env.VITE_SUPABASE_URL).toBe(`https://${ref}.supabase.co`);
      const other = target === 'test' ? REFS.production : REFS.test;
      expect(text).not.toContain(other);
    });

    it(`${target}: has no VITE_API_URL, and the build takes it from config/server-host.json with no query (owner, 2026-10-16)`, () => {
      expect(env.VITE_API_URL).toBeUndefined();
      const built = remotePublicEnv(target as 'test' | 'production', text).VITE_API_URL;
      expect(built).toBe(screensApiUrl(target as 'test' | 'production', SERVER_HOST_SETTING[target as 'test' | 'production']));
      expect(built).not.toMatch(/[?#]/);
      if (built !== '/api') expect(built).toBe(`https://${ref}.supabase.co/functions/v1/api`);
    });

    it(`${target}: holds a publishable key and no secret key`, () => {
      expect(env.VITE_SUPABASE_PUBLISHABLE_KEY).toMatch(/^sb_publishable_[A-Za-z0-9_-]+$/);
      expect(text).not.toMatch(/sb_secret_|service_role|eyJ[A-Za-z0-9_-]{10,}/);
      expect(Object.keys(env).sort()).toEqual(['VITE_MADAR_API', 'VITE_MADAR_SATELLITE', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_URL', 'VITE_VAPID_PUBLIC_KEY']);
    });

    // The Satellite button (owner, 2026-10-20). The Esri key is the Pages secret ESRI_KEY: it never goes in a public file.
    it(`${target}: shows the Satellite button, and holds no Esri key`, () => {
      expect(env.VITE_MADAR_SATELLITE).toBe('on');
      expect(text).not.toMatch(/ESRI_KEY=|token=|\bAAP[KT][A-Za-z0-9_-]{10,}/);
    });

    it(`${target}: holds the public VAPID key of browser push (87 base64url characters of a P-256 point), and no private key`, () => {
      expect(env.VITE_VAPID_PUBLIC_KEY).toMatch(/^B[A-Za-z0-9_-]{86}$/);
      expect(text).not.toMatch(/VAPID_PRIVATE_KEY|VAPID_SUBJECT/);
    });
  }

  it('uses a VAPID pair of its own for test and for production', () => {
    expect(parsePublicEnv(read('config/remote.test.env')).VITE_VAPID_PUBLIC_KEY).not.toBe(parsePublicEnv(read('config/remote.production.env')).VITE_VAPID_PUBLIC_KEY);
  });

  it('test: carries the publishable key that accounts.md records for madar-test (track R2)', () => {
    const key = /madar-test publishable key: `(sb_publishable_[^`]+)`/.exec(accounts)?.[1];
    expect(key).toBeDefined();
    expect(parsePublicEnv(read('config/remote.test.env')).VITE_SUPABASE_PUBLISHABLE_KEY).toBe(key);
  });
});
