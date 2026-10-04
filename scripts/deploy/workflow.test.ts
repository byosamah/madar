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

  it('deploys the test project only: migrations, functions, then screens', () => {
    const runs = [...code.matchAll(/run: (.+)/g)].map((match) => match[1].trim());
    expect(runs).toEqual(['npm ci', 'scripts/deploy/db.sh test', 'scripts/deploy/functions.sh test', 'scripts/deploy/pages.sh test']);
    expect(code).not.toMatch(/production|all\.sh|secrets\.ts|config\.sh/);
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
    expect(step('Screens')).toContain('CLOUDFLARE_API_TOKEN: ${{ secrets.TEST_CLOUDFLARE_API_TOKEN }}');
    expect(step('Screens')).not.toContain('SUPABASE_ACCESS_TOKEN');
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
    expect(text).not.toContain('—');
  });
});
