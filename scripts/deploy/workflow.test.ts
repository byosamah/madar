import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * .github/workflows/deploy.yml (plan 5.9, task O3): the manual deploy of the test project. It runs only in GitHub, so these tests
 * check the rules on the text: test only, by hand only, secrets only in the steps that need them. Production deploys run from the
 * Mac only (plan, section 10, decision 9).
 */
const path = new URL('../../.github/workflows/deploy.yml', import.meta.url);
const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
const code = text
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');

/** The lines of one step, from its "- name:" line to the next step. */
function step(name: string): string {
  const lines = code.split('\n');
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  if (start === -1) return '';
  const indent = lines[start].indexOf('-');
  const end = lines.findIndex((line, at) => at > start && line.indexOf('- ') === indent && line.trimStart().startsWith('- '));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

describe('.github/workflows/deploy.yml', () => {
  it('exists and runs only by hand', () => {
    expect(text).not.toBe('');
    expect(code).toMatch(/^on:\n {2}workflow_dispatch:\s*$/m);
    for (const trigger of ['push:', 'pull_request', 'schedule:', 'workflow_run', 'repository_dispatch']) expect(code).not.toContain(trigger);
  });

  it('checks the token scope first, then builds with no secret, then deploys the migrations and functions of the test project only', () => {
    const runs = [...code.matchAll(/run: (.+)/g)].map((match) => match[1].trim());
    expect(runs).toEqual([
      'scripts/deploy/token-scope.sh',
      'npm ci',
      'npm run build:server',
      'scripts/deploy/db.sh test',
      'scripts/deploy/functions.sh test --prebuilt',
    ]);
    expect(code).not.toMatch(/production|all\.sh|secrets\.ts|config\.sh/);
  });

  it('never runs npm (install or build) in a step that holds a secret, so dependency code never sees a token', () => {
    const steps = code.split(/\n(?= {6}- )/).filter((part) => part.trimStart().startsWith('- '));
    expect(steps.length).toBeGreaterThan(4);
    for (const part of steps) if (part.includes('secrets.')) expect(part, part).not.toMatch(/\bnpm\b|npx|build/);
    expect(step('Build')).not.toContain('secrets.');
  });

  it('stops the job before any build when the Supabase token reaches production (plan, section 10, decision 9)', () => {
    const scope = code.indexOf('- name: Token scope');
    expect(scope).toBeGreaterThan(-1);
    expect(scope).toBeLessThan(code.indexOf('- name: Install'));
    expect(step('Token scope')).toContain('SUPABASE_ACCESS_TOKEN: ${{ secrets.TEST_SUPABASE_ACCESS_TOKEN }}');
  });

  it('holds no Cloudflare token: the Pages project madar serves production too, so the test screens deploy from the Mac', () => {
    expect(code).not.toMatch(/CLOUDFLARE|pages\.sh|wrangler/);
  });

  it('uses only TEST_ repository secrets, each in the one step that needs it, never in the job or during npm ci', () => {
    const secrets = [...code.matchAll(/secrets\.(\w+)/g)].map((match) => match[1]);
    expect(secrets.length).toBeGreaterThan(0);
    for (const name of secrets) expect(name).toMatch(/^TEST_/);
    const head = code.slice(0, code.indexOf('    steps:'));
    expect(head).not.toContain('secrets.');
    expect(step('Install')).not.toContain('secrets.');
    expect(step('Migrations')).toContain('SUPABASE_ACCESS_TOKEN: ${{ secrets.TEST_SUPABASE_ACCESS_TOKEN }}');
    expect(step('Migrations')).toContain('MADAR_TEST_DB_PASSWORD: ${{ secrets.TEST_DB_PASSWORD }}');
    expect(step('Functions')).toContain('SUPABASE_ACCESS_TOKEN: ${{ secrets.TEST_SUPABASE_ACCESS_TOKEN }}');
    expect(step('Functions')).not.toContain('DB_PASSWORD');
    expect(step('Token scope')).not.toContain('DB_PASSWORD');
  });

  it('reads the repository only, keeps no job token in .git/config, and pins every action to a full commit', () => {
    expect(code).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(code).toContain('persist-credentials: false');
    const uses = [...code.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/);
  });

  it('never runs two deploys at once and never stops one halfway, and has a time limit', () => {
    expect(code).toMatch(/concurrency:\n {2}group: deploy-test\n {2}cancel-in-progress: false/);
    expect(code).toMatch(/timeout-minutes: \d+/);
  });

  it('has no em dash', () => {
    expect(text).not.toContain('\u2014');
  });
});
