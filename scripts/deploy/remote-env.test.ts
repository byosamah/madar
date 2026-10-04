import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePublicEnv } from '../build-remote.ts';

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
      expect(env.VITE_API_URL).toBe(`https://${ref}.supabase.co/functions/v1/api`);
      const other = target === 'test' ? REFS.production : REFS.test;
      expect(text).not.toContain(other);
    });

    it(`${target}: keeps VITE_API_URL free of a query, so the screens can add forceFunctionRegion to every function URL`, () => {
      expect(env.VITE_API_URL).not.toMatch(/[?#]/);
    });

    it(`${target}: holds a publishable key and no secret key`, () => {
      expect(env.VITE_SUPABASE_PUBLISHABLE_KEY).toMatch(/^sb_publishable_[A-Za-z0-9_-]+$/);
      expect(text).not.toMatch(/sb_secret_|service_role|eyJ[A-Za-z0-9_-]{10,}/);
      expect(Object.keys(env).sort()).toEqual(['VITE_API_URL', 'VITE_MADAR_API', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_URL']);
    });
  }

  it('test: carries the publishable key that accounts.md records for madar-test (track R2)', () => {
    const key = /madar-test publishable key: `(sb_publishable_[^`]+)`/.exec(accounts)?.[1];
    expect(key).toBeDefined();
    expect(parsePublicEnv(read('config/remote.test.env')).VITE_SUPABASE_PUBLISHABLE_KEY).toBe(key);
  });
});
