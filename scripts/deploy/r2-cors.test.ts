import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The CORS rules of the two R2 buckets (owner, 2026-10-16): config/r2-cors.test.json for madar-files-test and
 * config/r2-cors.production.json for madar-files. The lead sets them with
 *   npx wrangler r2 bucket cors set <bucket> --file config/r2-cors.<env>.json --jurisdiction eu
 * wrangler 4.147 takes only the R2 form ("rules", "allowed"), never the S3 form ("CORSRules", "AllowedOrigins"). The browser
 * sends only the upload PUT with Content-Type across origins; pictures, the PDF preview and downloads need no CORS.
 */

const read = (env: 'test' | 'production'): unknown => JSON.parse(readFileSync(new URL(`../../config/r2-cors.${env}.json`, import.meta.url), 'utf8'));

const ORIGINS = {
  test: ['https://preview.madar-46r.pages.dev', 'http://127.0.0.1:5173'],
  production: ['https://madar.vado.sa', 'https://www.madar.vado.sa', 'https://madar-46r.pages.dev'],
};

type Rule = { allowed: { origins: string[]; methods: string[]; headers: string[] }; maxAgeSeconds: number };

function rulesOf(env: 'test' | 'production'): Rule[] {
  const file = read(env) as { rules?: unknown };
  expect(Object.keys(file)).toEqual(['rules']);
  expect(Array.isArray(file.rules)).toBe(true);
  return file.rules as Rule[];
}

describe('the CORS files of the R2 buckets', () => {
  for (const env of ['test', 'production'] as const) {
    it(`${env}: one rule in the R2 form that wrangler 4.147 takes, with PUT and GET, Content-Type and 2 hours of preflight cache`, () => {
      const rules = rulesOf(env);
      expect(rules).toHaveLength(1);
      const [rule] = rules;
      expect(Object.keys(rule).sort()).toEqual(['allowed', 'maxAgeSeconds']);
      expect(Object.keys(rule.allowed).sort()).toEqual(['headers', 'methods', 'origins']);
      expect(rule.allowed.methods).toEqual(['PUT', 'GET']);
      expect(rule.allowed.headers).toEqual(['Content-Type']);
      expect(rule.maxAgeSeconds).toBe(7200);
      // The S3 form: wrangler refuses it (CORSRules, AllowedOrigins, AllowedMethods, AllowedHeaders).
      expect(JSON.stringify(read(env))).not.toMatch(/CORSRules|Allowed(Origins|Methods|Headers)/);
    });

    it(`${env}: only the origins of that copy`, () => {
      expect(rulesOf(env)[0].allowed.origins).toEqual(ORIGINS[env]);
    });
  }

  it('production never holds a local origin, a preview origin or an address without https', () => {
    for (const origin of rulesOf('production')[0].allowed.origins) {
      expect(origin, origin).toMatch(/^https:\/\//);
      expect(origin, origin).not.toMatch(/127\.0\.0\.1|localhost|preview\./);
      expect(ORIGINS.test, origin).not.toContain(origin);
    }
  });
});
