import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import config, { deployConfig, LOCAL_OUT_DIR, LOCAL_SUPABASE_URL, LOCAL_URL } from '../playwright.deploy.config';
import { AUTH_DIR, DEPLOY_ROLES, prepareAuthDir, storageStateOf } from '../tests/e2e-deploy/accounts';

/** The Playwright config of the browser checks on the test deployment (task X1): it loads, and it signs in once for each role. */

type Project = { name: string; testMatch?: RegExp; dependencies?: string[]; use?: { storageState?: string; trace?: string } };
type WebServer = { command: string; url: string; reuseExistingServer: boolean; env?: Record<string, string> };
const KEY = 'sb_publishable_local_test_value';
const projects = (c: typeof config) => c.projects as Project[];

describe('playwright.deploy.config', () => {
  it('runs tests/e2e-deploy after one setup project that signs in for each role', () => {
    expect(config.testDir).toBe('tests/e2e-deploy');
    expect(config.outputDir).toBe('test-results/e2e-deploy');
    expect(projects(config).map((p) => p.name)).toEqual(['setup', 'deploy']);
    const [setup, deploy] = projects(config);
    expect(setup.testMatch!.test('auth.setup.ts')).toBe(true);
    expect(setup.testMatch!.test('shell.spec.ts')).toBe(false);
    expect(deploy.testMatch!.test('shell.spec.ts')).toBe(true);
    expect(deploy.testMatch!.test('auth.setup.ts')).toBe(false);
    expect(deploy.dependencies).toEqual(['setup']);
    // A spec that names no role runs as the Admin; test.use({ storageState: storageStateOf(role) }) picks another.
    expect(deploy.use?.storageState).toBe(storageStateOf('admin'));
  });

  it('keeps each session outside test-results, so an upload of the run output never carries a refresh token', () => {
    expect(DEPLOY_ROLES.map(storageStateOf)).toEqual(DEPLOY_ROLES.map((role) => `${AUTH_DIR}/${role}.json`));
    expect(AUTH_DIR).toBe('playwright/.auth');
    expect(AUTH_DIR.startsWith('test-results')).toBe(false);
    expect(AUTH_DIR.startsWith(config.outputDir!)).toBe(false);
  });

  it('makes the session folder with a .gitignore of its own, so git ignores the sessions without the root .gitignore', () => {
    const root = mkdtempSync(join(tmpdir(), 'madar-auth-dir-'));
    try {
      prepareAuthDir(root);
      prepareAuthDir(root);
      expect(readFileSync(join(root, AUTH_DIR, '.gitignore'), 'utf8')).toBe('*\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('records no trace of the sign-ins, so no password reaches a trace', () => {
    const [setup] = projects(config);
    expect(setup.use?.trace).toBe('off');
    expect(projects(deployConfig({ MADAR_DEPLOY_URL: 'https://preview.madar-test.pages.dev' }))[0].use?.trace).toBe('off');
  });

  it('builds its own remote build for the local stack in a folder of its own, and never reuses a server on the port', () => {
    const local = deployConfig({ MADAR_LOCAL_PUBLISHABLE_KEY: KEY });
    expect(local.use?.baseURL).toBe(LOCAL_URL);
    const server = local.webServer as WebServer;
    expect(server).toMatchObject({ url: LOCAL_URL, reuseExistingServer: false });
    expect(LOCAL_OUT_DIR.startsWith('test-results/')).toBe(true);
    expect(server.command).toBe(
      `npx vite build --mode remote-local --outDir ${LOCAL_OUT_DIR} && npx vite preview --mode remote-local --outDir ${LOCAL_OUT_DIR} --host 127.0.0.1 --port 4174 --strictPort`,
    );
    expect(server.env).toMatchObject({ VITE_MADAR_API: 'remote', VITE_SUPABASE_URL: LOCAL_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: KEY });
    expect(LOCAL_SUPABASE_URL).toBe('http://127.0.0.1:54321');
    expect(server.env!.VITE_MADAR_BUILD).toMatch(/^\d{4}\.\d{1,2}\.\d{1,2}$/);
    // The key goes in the environment, never in the shell command.
    expect(server.command).not.toContain(KEY);
  });

  it('stops with the name of the missing key when the local stack has no publishable key', () => {
    const server = deployConfig({}).webServer as WebServer;
    expect(server.reuseExistingServer).toBe(false);
    const run = spawnSync('sh', ['-c', server.command], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/MADAR_LOCAL_PUBLISHABLE_KEY/);
    expect(run.stderr).toMatch(/supabase status -o env/);
  });

  it('serves the deployment when a URL is given, with no local server', () => {
    const deployed = deployConfig({ MADAR_DEPLOY_URL: 'https://preview.madar-test.pages.dev/' });
    expect(deployed.use?.baseURL).toBe('https://preview.madar-test.pages.dev');
    expect(deployed.webServer).toBeUndefined();
  });

  it('refuses a deployment URL that is not https, except on this Mac', () => {
    expect(() => deployConfig({ MADAR_DEPLOY_URL: 'http://preview.madar-test.pages.dev' })).toThrow(/https/);
    expect(deployConfig({ MADAR_DEPLOY_URL: 'http://127.0.0.1:5173' }).use?.baseURL).toBe('http://127.0.0.1:5173');
  });
});
