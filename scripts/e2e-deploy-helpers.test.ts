import { describe, expect, it } from 'vitest';
import { routeUrl, urlPattern } from '../tests/e2e-deploy/goto';
import { databaseTarget, linkPath } from '../tests/e2e-deploy/mail';
import { localOnly } from '../tests/e2e-deploy/local';

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
  const text = 'Welcome, Lina\n\nhttp://127.0.0.1:4174/welcome?token_hash=abc123&type=invite\n\nThe link works once.';

  it('gives the path and query of the screen link in a mail text', () => {
    expect(linkPath(text, 'welcome')).toBe('/welcome?token_hash=abc123&type=invite');
    expect(linkPath('Set a new password: https://madar-test.pages.dev/reset?token_hash=z9&type=recovery', 'reset')).toBe('/reset?token_hash=z9&type=recovery');
  });

  it('refuses a mail without a link to that screen', () => {
    expect(() => linkPath(text, 'reset')).toThrow(/no link to \/reset/);
    expect(() => linkPath('No link here.', 'welcome')).toThrow(/no link to \/welcome/);
  });
});

describe('databaseTarget', () => {
  it('uses the local database of the local stack by default, without TLS', () => {
    expect(databaseTarget({})).toEqual({ url: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', tls: false });
  });

  it('uses TLS for a hosted database and refuses the production project', () => {
    expect(databaseTarget({ MADAR_E2E_DATABASE_URL: 'postgresql://postgres.qdgwpnesxppnqsaabqzd:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres' }).tls).toBe(true);
    expect(() => databaseTarget({ MADAR_E2E_DATABASE_URL: 'postgresql://postgres.oprkvdjudjxxhvodkzgs:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres' })).toThrow(/production/);
    expect(() => databaseTarget({ MADAR_E2E_DATABASE_URL: 'postgresql://postgres:pw@db.oprkvdjudjxxhvodkzgs.supabase.co:5432/postgres' })).toThrow(/production/);
  });
});

describe('localOnly', () => {
  it('accepts only the local stack', () => {
    expect(() => localOnly('http://127.0.0.1:54321')).not.toThrow();
    expect(() => localOnly('http://localhost:54321')).not.toThrow();
    expect(() => localOnly('https://qdgwpnesxppnqsaabqzd.supabase.co')).toThrow(/local stack/);
  });
});
