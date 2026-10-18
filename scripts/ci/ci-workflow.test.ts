import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The CI workflows (plan 6.3, task O1; test map 6). actionlint checks the syntax; these tests check the rules of the plan,
 * and that every command the workflows run exists in this repository.
 * ci.yml holds unit, server and lite. ci-stack.yml holds db, integration and office. Both start only by hand (owner, 2026-10-18).
 * Two files, not one file with job-level if: conditions, because GitHub reports a job that an if: skips as Success,
 * and that skipped run could meet a required check while the real job fails.
 */
const root = new URL('../../', import.meta.url);
const read = (name: string) => {
  const path = new URL(`.github/workflows/${name}`, root);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};
const FILES = { 'ci.yml': read('ci.yml'), 'ci-stack.yml': read('ci-stack.yml') };
const both = Object.values(FILES).join('\n');
const scripts = (JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { scripts: Record<string, string> }).scripts;

/** Which file holds each job. */
const JOB_FILE: Record<string, keyof typeof FILES> = { unit: 'ci.yml', server: 'ci.yml', lite: 'ci.yml', db: 'ci-stack.yml', integration: 'ci-stack.yml', office: 'ci-stack.yml' };
const ALL_JOBS = Object.keys(JOB_FILE);

/** The lines of one job, from its "  name:" line under jobs: to the next job. */
function job(name: string): string {
  const lines = FILES[JOB_FILE[name]].split('\n');
  const jobsAt = lines.indexOf('jobs:');
  const start = lines.findIndex((line, at) => at > jobsAt && line === `  ${name}:`);
  if (jobsAt === -1 || start === -1) return '';
  const end = lines.findIndex((line, at) => at > start && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** The "on:" block of a file, up to the next top-level key. */
function triggers(text: string): string {
  const match = /^on:\n((?: {2}.*\n|\n)*)/m.exec(text);
  return match ? match[1] : '';
}

/** The position of the step whose run: or name: line holds the text, in one job (-1 when it is missing). */
const at = (body: string, text: string) => body.indexOf(text);

/** The text as a literal part of a regular expression. */
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('.github/workflows/ci.yml and ci-stack.yml', () => {
  it('exist and hold the six jobs of the plans, each in its own file', () => {
    for (const [name, text] of Object.entries(FILES)) expect(text, name).not.toBe('');
    for (const name of ALL_JOBS) expect(job(name), `job ${name}`).not.toBe('');
    expect(FILES['ci.yml']).not.toMatch(/^ {2}(db|integration|office):$/m);
    expect(FILES['ci-stack.yml']).not.toMatch(/^ {2}(unit|server|lite):$/m);
  });

  it('starts both files only by hand, never on a push, a pull request or a schedule (owner, 2026-10-18: the free minutes go to the backups)', () => {
    for (const [name, text] of Object.entries(FILES)) {
      const on = triggers(text);
      expect(on, name).toMatch(/^ {2}workflow_dispatch:/m);
      expect(on, name).not.toMatch(/push|pull_request|schedule/);
    }
  });

  it('has no job-level if: condition, so a skipped job never reports Success under a check name', () => {
    for (const name of ALL_JOBS) expect(job(name), name).not.toMatch(/^ {4}if:/m);
  });

  it('cancels the older run of the same branch or pull request, with one group per file', () => {
    const groups = Object.values(FILES).map((text) => /^concurrency:\n {2}group: (.*)\n {2}cancel-in-progress: true$/m.exec(text)?.[1]);
    for (const group of groups) expect(group).toContain('github.ref');
    expect(new Set(groups).size).toBe(2);
  });

  it('gives every job a time limit, so a stuck run cannot use the month of free minutes', () => {
    for (const name of ALL_JOBS) expect(job(name), name).toMatch(/^ {4}timeout-minutes: \d+$/m);
  });

  it('reads the repository only, and uses no secret (the local stack has fixed keys)', () => {
    for (const [name, text] of Object.entries(FILES)) expect(text, name).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(both).not.toMatch(/\$\{\{[^}]*\bsecrets\./);
  });

  it('does not keep the job token in .git/config after the checkout', () => {
    const checkouts = [...both.matchAll(/uses: actions\/checkout@\S+.*\n(?: {8}.*\n)*/g)].map((match) => match[0]);
    expect(checkouts.length).toBe(ALL_JOBS.length);
    for (const step of checkouts) expect(step).toMatch(/^ {8}with:\n {10}persist-credentials: false$/m);
  });

  it('pins every action to a full commit, and every image to a digest', () => {
    const uses = [...both.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action, action).toMatch(/@[0-9a-f]{40}$/);
    const images = [...both.matchAll(/\b(cgr\.dev\/\S+|docker\.io\/\S+)/g)].map((match) => match[1]);
    for (const image of images) expect(image, image).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it('runs only npm scripts that package.json defines', () => {
    const used = [...both.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1]);
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

  it('starts the full stack and MinIO for the integration job, and serves no function itself', () => {
    const integration = job('integration');
    expect(integration).toMatch(/supabase start\s*$/m);
    expect(integration).toContain('minio');
    expect(integration).toContain('npm run test:it');
    // The conformance runner and the cron and worker suites serve their own functions; a shared serve answered for them.
    expect(integration).not.toContain('supabase functions serve');
  });

  it('takes MinIO from Chainguard, pinned by digest, because Docker Hub no longer serves minio/minio (F1)', () => {
    const images = [...job('integration').matchAll(/(\S*minio\S*@sha256:[0-9a-f]{64})/g)].map((match) => match[1]);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatch(/^cgr\.dev\/chainguard\/minio@sha256:[0-9a-f]{64}$/);
    expect(both).not.toMatch(/(^|[\s/])minio\/minio\b/m);
    // The integration tests start the same image on the Mac (server/it/minio.ts).
    expect(readFileSync(new URL('server/it/minio.ts', root), 'utf8')).toContain(images[0]);
  });

  it('starts the stack without the edge runtime while the function folders are missing, because config.toml names them', () => {
    // supabase start fails with "open supabase/functions/api/index.ts: no such file" until track E adds the folders.
    const integration = job('integration');
    const functions = "hashFiles('supabase/functions/*/index.ts')";
    expect(integration).toMatch(new RegExp(`if: ${escape(functions)} != ''\\n {8}run: npx supabase start\\n`));
    expect(integration).toMatch(new RegExp(`if: ${escape(functions)} == ''\\n {8}run: npx supabase start -x edge-runtime\\n`));
  });

  it('builds the server bundles before the stack starts, because the edge runtime opens the files that index.ts imports', () => {
    const integration = job('integration');
    const build = at(integration, 'run: npm run build:server');
    expect(build).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(at(integration, 'run: npm ci'));
    expect(build).toBeLessThan(at(integration, 'npx supabase start'));
  });

  it('runs the MCP conformance check, once G3 adds server/mcp/run.ts, before the integration suites', () => {
    const integration = job('integration');
    expect(integration).toMatch(/- name: MCP conformance\n {8}if: hashFiles\('server\/mcp\/run\.ts'\) != ''\n {8}run: npm run test:mcp\n/);
    // The runner serves its own mcp function (server/mcp/conformance.ts), before the integration suites, and a db reset
    // between them gives the suites the fresh database they expect.
    expect(at(integration, 'npm run test:mcp')).toBeLessThan(at(integration, 'npx supabase db reset'));
    expect(at(integration, 'npx supabase db reset')).toBeLessThan(at(integration, 'npm run test:it'));
  });

  it('runs test:lite in the lite job and test:office with the bundle smoke in the office job, with no Docker (exit wave 4)', () => {
    const lite = job('lite');
    expect(lite).toContain('npm run test:lite');
    const office = job('office');
    expect(at(office, 'run: npm run build:server')).toBeGreaterThan(at(office, 'run: npm ci'));
    expect(at(office, 'run: npm run build:server')).toBeLessThan(at(office, 'run: npm run test:office'));
    expect(office).toContain('run: npm run smoke:office');
    for (const body of [lite, office]) {
      expect(body).not.toMatch(/supabase start|docker/i);
      expect(body).toMatch(/^ {4}timeout-minutes: \d+$/m);
    }
  });

  it('uses the Supabase CLI version that package.json pins', () => {
    expect(both).not.toContain('supabase/setup-cli');
    expect(both).toMatch(/npx supabase start/);
  });

  it('has no em dash', () => {
    expect(both).not.toContain('\u2014');
  });
});
