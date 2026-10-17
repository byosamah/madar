/**
 * npm run dev:office (Supabase exit, wave 4): the local office stack. The real Workers bundle on wrangler dev with the office path
 * and the own sign-in (a new sign-in key for each run), the sample office and the 4 accounts through the seed of the office object,
 * and the Madar build of the screens on vite preview. It needs no Docker. Run it after npm run build:server, with the sandbox off
 * (wrangler dev and vite preview bind ports). It writes test-results/office-local/run.env (mode 600) with the lines of the deploy
 * suite on the office path, then waits; Ctrl-C (or a kill) stops both servers and removes the state of the run. The values that
 * look like keys are made for this run only: none of them is a real key.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPS_SECRET_HEADER } from '../../server/entries/officeWorker';
import { localPasswords } from '../../tests/e2e-deploy/local';
import { buildId } from '../build-remote';
import { newAuthKey } from '../office/auth-key';
import { importOffice } from '../office/import';
import { opsOf } from '../office/ops';
import { seedSource } from '../office/seed';

export const LOCAL_OFFICE = 'http://127.0.0.1:8792';
export const LOCAL_SCREENS = 'http://127.0.0.1:4174';
/** The run output: test-results/ is git-ignored, so run.env never goes into a commit. */
export const LOCAL_OUT = 'test-results/office-local';

type RunSecrets = { opsSecret: string; exportSecret: string; jobsSecret: string; authKey: string };

/** The env file of wrangler dev: the secrets of one run, and made-up values where the bundle wants a key it never uses here. */
export function workerEnvLines(o: RunSecrets): string[] {
  return [
    'MADAR_SECRET_KEY=sb_secret_local_not_a_key', `JOBS_SECRET=${o.jobsSecret}`, `MADAR_OPS_SECRET=${o.opsSecret}`, `MADAR_EXPORT_SECRET=${o.exportSecret}`,
    `MADAR_AUTH_PRIVATE_JWK=${o.authKey}`, `R2_ACCOUNT_ID=${'0'.repeat(32)}`, 'R2_ACCESS_KEY_ID=local-not-a-key', 'R2_SECRET_ACCESS_KEY=local-not-a-key',
  ];
}

export function screensEnv(build: string): Record<string, string> {
  return {
    VITE_MADAR_API: 'remote', VITE_MADAR_AUTH: 'madar', VITE_MADAR_LIVE: 'socket', VITE_API_URL: `${LOCAL_OFFICE}/api`, VITE_MADAR_BUILD: build,
    // The Madar build reads no Supabase value; the build of the screens still wants the two names.
    VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_not_used',
  };
}

/** The lines of the deploy suite on the office path (tests/CLAUDE.md), for the delegated Playwright helper. */
export function playwrightLines(o: { opsSecret: string }): string[] {
  return [
    `MADAR_DEPLOY_URL=${LOCAL_SCREENS}`, `MADAR_E2E_APP_URL=${LOCAL_SCREENS}`, `MADAR_E2E_OFFICE_URL=${LOCAL_OFFICE}`, `MADAR_E2E_MCP_URL=${LOCAL_OFFICE}/mcp`,
    `MADAR_E2E_OPS_SECRET=${o.opsSecret}`, 'MADAR_E2E_AFTER_G=1',
    ...Object.entries(localPasswords()).map(([name, value]) => `${name}=${value}`),
  ];
}

async function until(url: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'madar-office-local-'));
  const secrets: RunSecrets = {
    opsSecret: randomBytes(24).toString('base64url'), exportSecret: randomBytes(24).toString('base64url'), jobsSecret: randomBytes(24).toString('base64url'),
    authKey: await newAuthKey(),
  };
  const envFile = join(dir, 'worker.env');
  writeFileSync(envFile, `${workerEnvLines(secrets).join('\n')}\n`, { mode: 0o600 });
  const children: ChildProcess[] = [];
  const stop = () => {
    for (const child of children) child.kill('SIGINT');
    rmSync(dir, { recursive: true, force: true });
    rmSync(`${LOCAL_OUT}/run.env`, { force: true });
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stop();
      process.exit(130);
    });
  }
  children.push(spawn('npx', ['wrangler', 'dev', '-c', 'server/office/test/live/wrangler.local.toml', '--env-file', envFile, '--port', '8792', '--ip', '127.0.0.1',
    '--persist-to', join(dir, 'state'), '--show-interactive-dev-session=false'], { stdio: ['ignore', 'inherit', 'inherit'] }));
  if (!(await until(`${LOCAL_OFFICE}/api/health`, 60_000))) {
    stop();
    throw new Error('wrangler dev did not answer /api/health in 60 s. Run npm run build:server first.');
  }
  const { source } = await seedSource({ now: new Date(), passwords: localPasswords() });
  const report = await importOffice(opsOf({ base: LOCAL_OFFICE, secret: secrets.opsSecret, header: OPS_SECRET_HEADER }), source, { mode: 'replace' });
  console.log(`Seeded the local office: ${report.records} records and the 4 accounts.`);
  const env = { ...process.env, ...screensEnv(buildId(new Date())) };
  const built = spawnSync('npx', ['vite', 'build', '--mode', 'remote-local', '--outDir', `${LOCAL_OUT}/dist`], { stdio: 'inherit', env });
  if (built.status !== 0) {
    stop();
    throw new Error('The build of the screens failed.');
  }
  children.push(spawn('npx', ['vite', 'preview', '--mode', 'remote-local', '--outDir', `${LOCAL_OUT}/dist`, '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { stdio: ['ignore', 'inherit', 'inherit'], env }));
  if (!(await until(LOCAL_SCREENS, 60_000))) {
    stop();
    throw new Error('vite preview did not answer on port 4174 in 60 s.');
  }
  mkdirSync(LOCAL_OUT, { recursive: true });
  writeFileSync(`${LOCAL_OUT}/run.env`, `${playwrightLines({ opsSecret: secrets.opsSecret }).join('\n')}\n`, { mode: 0o600 });
  console.log(`Ready: the screens on ${LOCAL_SCREENS}, the office on ${LOCAL_OFFICE}. The deploy suite lines are in ${LOCAL_OUT}/run.env. Ctrl-C stops both.`);
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
