import { describe, expect, it } from 'vitest';
import { routeUrl, urlPattern } from '../tests/e2e-deploy/goto';
import { linkPath } from '../tests/e2e-deploy/mail';
import { appOrigin, databaseTarget, supabaseTarget } from '../tests/e2e-deploy/targets';
import { localOnly } from '../tests/e2e-deploy/local';
import { word } from '../tests/e2e-deploy/words';

/** The pure helpers of the browser checks on the test deployment (task X2). */

describe('routeUrl', () => {
  it('gives a path in the remote build and a hash link in the prototype', () => {
    expect(routeUrl('/', 'remote')).toBe('/');
    expect(routeUrl('/projects/prj_001?tab=tasks', 'remote')).toBe('/projects/prj_001?tab=tasks');
    expect(routeUrl('/', 'prototype')).toBe('/#/');
    expect(routeUrl('/projects/prj_001?tab=tasks', 'prototype')).toBe('/#/projects/prj_001?tab=tasks');
  });

  it('refuses a route that does not start with a slash or that is already a hash link', () => {
    expect(() => routeUrl('projects', 'remote')).toThrow(/starts with \//);
    expect(() => routeUrl('/#/projects', 'prototype')).toThrow(/hash/);
  });
});

describe('urlPattern', () => {
  it('matches the route as a path after the host in the remote build', () => {
    const pattern = urlPattern('/projects?filter=at_risk', { target: 'remote' });
    expect(pattern.test('http://127.0.0.1:4174/projects?filter=at_risk')).toBe(true);
    expect(pattern.test('http://127.0.0.1:4174/#/projects?filter=at_risk')).toBe(false);
    expect(pattern.test('http://127.0.0.1:4174/sign-in?next=%2Fprojects%3Ffilter%3Dat_risk')).toBe(false);
  });

  it('matches the route after the hash in the prototype', () => {
    const pattern = urlPattern('/projects?filter=at_risk', { target: 'prototype' });
    expect(pattern.test('http://127.0.0.1:4173/#/projects?filter=at_risk')).toBe(true);
    expect(pattern.test('http://127.0.0.1:4173/projects?filter=at_risk')).toBe(false);
  });

  it('can require the end of the address, as /#\\/dashboard$/ did', () => {
    const pattern = urlPattern('/dashboard', { target: 'remote', end: true });
    expect(pattern.test('https://madar-test.pages.dev/dashboard')).toBe(true);
    expect(pattern.test('https://madar-test.pages.dev/dashboard/meeting')).toBe(false);
    expect(urlPattern('/inbox/', { target: 'prototype' }).test('http://x/#/inbox/cnv_1')).toBe(true);
  });
});

describe('linkPath', () => {
  const app = 'http://127.0.0.1:4174';
  const text = 'Welcome, Lina\n\nhttp://127.0.0.1:4174/welcome?token_hash=abc123&type=invite\n\nThe link works once.';

  it('gives the path and query of the screen link in a mail text, when the link goes to the app of the run', () => {
    expect(linkPath(text, 'welcome', app)).toBe('/welcome?token_hash=abc123&type=invite');
    expect(linkPath('Set a new password: https://madar-test.pages.dev/reset?token_hash=z9&type=recovery', 'reset', 'https://madar-test.pages.dev')).toBe('/reset?token_hash=z9&type=recovery');
  });

  it('refuses a mail whose link sends the token to another origin', () => {
    expect(() => linkPath('https://madar.example.com/welcome?token_hash=abc123&type=invite', 'welcome', app)).toThrow(/https:\/\/madar\.example\.com, not to http:\/\/127\.0\.0\.1:4174/);
    expect(() => linkPath('http://127.0.0.1:5173/reset?token_hash=z9&type=recovery', 'reset', app)).toThrow(/not to http:\/\/127\.0\.0\.1:4174/);
  });

  it('refuses a mail without a link to that screen', () => {
    expect(() => linkPath(text, 'reset', app)).toThrow(/no link to \/reset/);
    expect(() => linkPath('No link here.', 'welcome', app)).toThrow(/no link to \/welcome/);
  });
});

describe('appOrigin', () => {
  it('is MADAR_E2E_APP_URL when set, else the base URL of the run', () => {
    expect(appOrigin({ MADAR_E2E_APP_URL: 'https://madar-test.pages.dev/' }, 'https://abc123.madar-test.pages.dev')).toBe('https://madar-test.pages.dev');
    expect(appOrigin({}, 'http://127.0.0.1:4174')).toBe('http://127.0.0.1:4174');
    expect(() => appOrigin({}, undefined)).toThrow(/MADAR_E2E_APP_URL/);
  });
});

describe('databaseTarget', () => {
  const POOLER = 'postgresql://postgres.qdgwpnesxppnqsaabqzd:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres';

  it('uses the local database of the local stack by default, without TLS', () => {
    expect(databaseTarget({})).toEqual({ url: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', tls: false });
  });

  it('uses TLS for the database of madar-test and refuses the production project', () => {
    expect(databaseTarget({ MADAR_E2E_DATABASE_URL: POOLER }).tls).toBe(true);
    expect(databaseTarget({ MADAR_E2E_DATABASE_URL: 'postgresql://postgres:pw@db.qdgwpnesxppnqsaabqzd.supabase.co:5432/postgres' }).tls).toBe(true);
    expect(() => databaseTarget({ MADAR_E2E_DATABASE_URL: 'postgresql://postgres.oprkvdjudjxxhvodkzgs:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres' })).toThrow(/production/);
    expect(() => databaseTarget({ MADAR_E2E_DATABASE_URL: 'postgresql://postgres:pw@db.oprkvdjudjxxhvodkzgs.supabase.co:5432/postgres' })).toThrow(/production/);
  });

  it('reads only madar-test or the local stack, even when a password holds the ref of madar-test', () => {
    expect(() => databaseTarget({ MADAR_E2E_DATABASE_URL: 'postgresql://postgres.abcdefghijklmnopqrst:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres' })).toThrow(/qdgwpnesxppnqsaabqzd/);
    expect(() => databaseTarget({ MADAR_E2E_DATABASE_URL: 'postgresql://someone:qdgwpnesxppnqsaabqzd@db.example.com:5432/postgres' })).toThrow(/qdgwpnesxppnqsaabqzd/);
  });

  it('refuses a URL with a TLS setting, because pg lets it replace the root certificate check (plan 4.5)', () => {
    for (const setting of ['sslmode=no-verify', 'sslmode=disable', 'ssl=0', 'sslrootcert=system', 'uselibpqcompat=true', 'SSLMODE=require']) {
      expect(() => databaseTarget({ MADAR_E2E_DATABASE_URL: `${POOLER}?${setting}` }), setting).toThrow(/TLS setting/);
      expect(() => databaseTarget({ MADAR_E2E_DATABASE_URL: `${POOLER}?application_name=x2&${setting}` }), setting).toThrow(/TLS setting/);
    }
  });

  it('stops a run on the test deployment that names no database, so it never reads the local stack by mistake', () => {
    expect(() => databaseTarget({ MADAR_DEPLOY_URL: 'https://preview.madar-test.pages.dev' })).toThrow('MADAR_E2E_DATABASE_URL is missing for the test deployment');
    expect(databaseTarget({ MADAR_DEPLOY_URL: 'https://preview.madar-test.pages.dev', MADAR_E2E_DATABASE_URL: POOLER }).url).toBe(POOLER);
  });
});

describe('supabaseTarget', () => {
  it('uses the local stack by default, and the MCP function of the project URL', () => {
    expect(supabaseTarget({})).toEqual({ supabaseUrl: 'http://127.0.0.1:54321', mcpUrl: 'http://127.0.0.1:54321/functions/v1/mcp' });
    expect(supabaseTarget({ MADAR_E2E_SUPABASE_URL: 'https://qdgwpnesxppnqsaabqzd.supabase.co/' })).toEqual({
      supabaseUrl: 'https://qdgwpnesxppnqsaabqzd.supabase.co', mcpUrl: 'https://qdgwpnesxppnqsaabqzd.supabase.co/functions/v1/mcp',
    });
  });

  it('stops a run on the test deployment that names no project, before any call', () => {
    expect(() => supabaseTarget({ MADAR_DEPLOY_URL: 'https://preview.madar-test.pages.dev' })).toThrow('MADAR_E2E_SUPABASE_URL is missing for the test deployment');
  });

  it('refuses the production project and every project but madar-test, for the project and the MCP URL', () => {
    expect(() => supabaseTarget({ MADAR_E2E_SUPABASE_URL: 'https://oprkvdjudjxxhvodkzgs.supabase.co' })).toThrow(/MADAR_E2E_SUPABASE_URL/);
    expect(() => supabaseTarget({ MADAR_E2E_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' })).toThrow(/qdgwpnesxppnqsaabqzd/);
    expect(() => supabaseTarget({ MADAR_E2E_MCP_URL: 'https://oprkvdjudjxxhvodkzgs.supabase.co/functions/v1/mcp' })).toThrow(/MADAR_E2E_MCP_URL/);
    expect(() => supabaseTarget({ MADAR_E2E_SUPABASE_URL: 'https://qdgwpnesxppnqsaabqzd.supabase.co', MADAR_E2E_MCP_URL: 'https://mcp.example.com/mcp' })).toThrow(/MADAR_E2E_MCP_URL/);
  });
});

describe('word', () => {
  it('reads a text of either language from the base files and the files of the real build', () => {
    expect(word('en', 'auth.signOut')).toBe('Sign out');
    expect(word('en', 'settings.languages.ar')).toBe('العربية');
    expect(word('ar', 'auth.signOut')).not.toBe('Sign out');
    expect(word('ar', 'auth.signOut')).toMatch(/[؀-ۿ]/);
  });

  it('fills the placeholders and refuses a key that no file has', () => {
    expect(word('en', 'auth.welcome.greeting', { name: 'Lina' })).toBe('Welcome, Lina');
    expect(() => word('en', 'auth.nothing.here')).toThrow(/auth\.nothing\.here/);
  });
});

describe('localOnly', () => {
  it('accepts only the local stack', () => {
    expect(() => localOnly('http://127.0.0.1:54321')).not.toThrow();
    expect(() => localOnly('http://localhost:54321')).not.toThrow();
    expect(() => localOnly('https://qdgwpnesxppnqsaabqzd.supabase.co')).toThrow(/local stack/);
  });
});
