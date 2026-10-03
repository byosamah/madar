import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The CI workflow (plan 6.3, task O1; test map 6). actionlint checks the syntax; these tests check the rules of the plan,
 * and that every command the workflow runs exists in this repository.
 */
const root = new URL('../../', import.meta.url);
const workflowPath = new URL('.github/workflows/ci.yml', root);
const workflow = existsSync(workflowPath) ? readFileSync(workflowPath, 'utf8') : '';
const scripts = (JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { scripts: Record<string, string> }).scripts;

/** The lines of one job, from its "  name:" line under jobs: to the next job. */
function job(name: string): string {
  const lines = workflow.split('\n');
  const jobsAt = lines.indexOf('jobs:');
  const start = lines.findIndex((line, at) => at > jobsAt && line === `  ${name}:`);
  if (jobsAt === -1 || start === -1) return '';
  const end = lines.findIndex((line, at) => at > start && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** The job's "if:" condition, without spaces, so the test does not depend on the layout. */
function condition(name: string): string {
  const match = /^ {4}if: (.+)$/m.exec(job(name));
  return match ? match[1].replace(/\s+/g, '') : '';
}

const ALL_JOBS = ['unit', 'server', 'db', 'integration'];
const PULL_REQUEST_AND_MAIN = "github.event_name=='pull_request'||github.ref=='refs/heads/main'";

describe('.github/workflows/ci.yml', () => {
  it('exists and has the four jobs of the plan', () => {
    expect(workflow).not.toBe('');
    for (const name of ALL_JOBS) expect(job(name), `job ${name}`).not.toBe('');
  });

  it('runs on every push and on pull requests', () => {
    expect(workflow).toMatch(/^on:\n(?: {2}.*\n|\n)*? {2}push:/m);
    expect(workflow).toMatch(/^on:\n(?: {2}.*\n|\n)*? {2}pull_request:/m);
  });

  it('cancels the older run of the same branch or pull request', () => {
    expect(workflow).toMatch(/^concurrency:\n {2}group: .*github\.ref.*\n {2}cancel-in-progress: true$/m);
  });

  it('runs unit and server on pushes only, so a pull request does not run them twice', () => {
    for (const name of ['unit', 'server']) expect(condition(name), name).toBe("github.event_name!='pull_request'");
  });

  it('runs db and integration only on pull requests and on main (and by hand)', () => {
    for (const name of ['db', 'integration']) expect(condition(name), name).toContain(PULL_REQUEST_AND_MAIN);
  });

  it('gives every job a time limit, so a stuck run cannot use the month of free minutes', () => {
    for (const name of ALL_JOBS) expect(job(name), name).toMatch(/^ {4}timeout-minutes: \d+$/m);
  });

  it('reads the repository only, and uses no secret (the local stack has fixed keys)', () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(workflow).not.toMatch(/\$\{\{[^}]*\bsecrets\./);
  });

  it('pins every action to a full commit, and every image to a digest', () => {
    const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action, action).toMatch(/@[0-9a-f]{40}$/);
    const images = [...workflow.matchAll(/\b(cgr\.dev\/\S+|docker\.io\/\S+)/g)].map((match) => match[1]);
    for (const image of images) expect(image, image).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it('runs only npm scripts that package.json defines', () => {
    const used = [...workflow.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect(scripts, `npm run ${name}`).toHaveProperty(name);
  });

  it('type checks, tests and builds in the unit job', () => {
    const unit = job('unit');
    expect(unit).toContain('npm run typecheck');
    expect(unit).toContain('vitest run --project unit');
    expect(unit).toContain('npm run build');
  });

  it('checks the migrations for a literal secret, and runs the server tests, in the server job', () => {
    const server = job('server');
    expect(server).toContain('node scripts/ci/check-migration-secrets.ts');
    expect(existsSync(new URL('scripts/ci/check-migration-secrets.ts', root))).toBe(true);
    expect(server).toContain('npm run test:server');
  });

  it('starts Postgres only for the db job and passes its address as DATABASE_URL', () => {
    const db = job('db');
    expect(db).toMatch(/supabase start -x \S*supavisor/);
    for (const service of ['gotrue', 'realtime', 'storage-api', 'kong', 'edge-runtime']) expect(db).toContain(service);
    expect(db).toContain('scripts/ci/stack-env.sh >> "$GITHUB_ENV"');
    expect(readFileSync(new URL('scripts/ci/stack-env.sh', root), 'utf8')).toContain('db.url=DATABASE_URL');
    expect(db).toContain('npm run test:db');
  });

  it('starts the full stack, MinIO and the functions for the integration job', () => {
    const integration = job('integration');
    expect(integration).toMatch(/supabase start\s*$/m);
    expect(integration).toContain('minio');
    expect(integration).toContain('supabase functions serve');
    expect(integration).toContain('npm run test:it');
  });

  it('uses the Supabase CLI version that package.json pins', () => {
    expect(workflow).not.toContain('supabase/setup-cli');
    expect(workflow).toMatch(/npx supabase start/);
  });

  it('has no em dash', () => {
    expect(workflow).not.toContain('\u2014');
  });
});
