import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCK_KEY } from '../server/core/deps';
import { cloudTarget, OFFICE_LOCK_KEY, parseArgs, secretKeyFromApi } from './first-admin';

/** The parts of scripts/first-admin.ts that need no stack (task P3). scripts/first-admin.test.ts runs it on the local stack. */

const BASE = ['--env', 'test', '--email', 'Hala@Madar.test', '--name', 'Hala Nasser', '--language', 'ar', '--gender', 'female'];

describe('first-admin: the arguments', () => {
  it('reads every value, with Admin as the default discipline', () => {
    expect(parseArgs(BASE)).toEqual({
      env: 'test', email: 'hala@madar.test', name: 'Hala Nasser', language: 'ar', gender: 'female', discipline: 'Admin', passwordStdin: false,
    });
    expect(parseArgs([...BASE, '--discipline', 'Architect', '--password-stdin'])).toMatchObject({ discipline: 'Architect', passwordStdin: true });
  });

  it('names every missing or wrong value in one error', () => {
    expect(() => parseArgs(['--env', 'staging', '--email', 'x', '--language', 'fr'])).toThrow(
      /--env must be test, production or local.*--email must be an email.*--name is missing.*--language must be en or ar.*--gender must be female or male/s,
    );
  });

  it('takes --schema only with --env local (the test harness)', () => {
    expect(parseArgs(['--env', 'local', '--schema', 'madar_p3_1', ...BASE.slice(2)])).toMatchObject({ env: 'local', schema: 'madar_p3_1' });
    expect(() => parseArgs([...BASE, '--schema', 'x'])).toThrow(/--schema/);
  });
});

describe('first-admin: the office lock', () => {
  it('takes the same office lock key as the server', () => {
    expect(OFFICE_LOCK_KEY).toBe(DEFAULT_LOCK_KEY);
  });
});

describe('first-admin: the cloud projects', () => {
  it('connects as postgres through the session pooler with the root certificate, to the project of the env', () => {
    const test = cloudTarget('test', { MADAR_TEST_DB_PASSWORD: 'pw-test' });
    expect(test.supabaseUrl).toBe('https://qdgwpnesxppnqsaabqzd.supabase.co');
    expect(test.pg).toMatchObject({ host: 'aws-1-eu-central-1.pooler.supabase.com', port: 5432, user: 'postgres.qdgwpnesxppnqsaabqzd', password: 'pw-test', database: 'postgres' });
    expect(test.pg.ssl).toMatchObject({ rejectUnauthorized: true });
    const production = cloudTarget('production', { MADAR_DB_PASSWORD: 'pw-prod' });
    expect([production.supabaseUrl, production.pg.user]).toEqual(['https://oprkvdjudjxxhvodkzgs.supabase.co', 'postgres.oprkvdjudjxxhvodkzgs']);
    expect(() => cloudTarget('test', {})).toThrow(/MADAR_TEST_DB_PASSWORD/);
  });

  it('reads the secret key from the Management API when MADAR_SECRET_KEY is not set, and never prints it', async () => {
    const seen: string[] = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      seen.push(`${url} ${new Headers(init?.headers).get('authorization')}`);
      return Response.json([{ type: 'publishable', api_key: 'sb_publishable_x' }, { type: 'secret', api_key: 'sb_secret_y' }]);
    }) as typeof globalThis.fetch;
    await expect(secretKeyFromApi('qdgwpnesxppnqsaabqzd', 'token-1', fetch)).resolves.toBe('sb_secret_y');
    expect(seen).toEqual(['https://api.supabase.com/v1/projects/qdgwpnesxppnqsaabqzd/api-keys?reveal=true Bearer token-1']);
    const none = (async () => Response.json([{ type: 'publishable', api_key: 'p' }])) as unknown as typeof globalThis.fetch;
    await expect(secretKeyFromApi('qdgwpnesxppnqsaabqzd', 'token-1', none)).rejects.toThrow(/no secret key/);
  });
});
