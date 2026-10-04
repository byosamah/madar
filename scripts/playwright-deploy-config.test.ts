import { describe, expect, it } from 'vitest';
import config, { deployConfig, LOCAL_URL } from '../playwright.deploy.config';
import { AUTH_DIR, DEPLOY_ROLES, storageStateOf } from '../tests/e2e-deploy/accounts';

/** The Playwright config of the browser checks on the test deployment (task X1): it loads, and it signs in once for each role. */

type Project = { name: string; testMatch?: RegExp; dependencies?: string[]; use?: { storageState?: string } };
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

  it('keeps each session under test-results, which git ignores', () => {
    expect(DEPLOY_ROLES.map(storageStateOf)).toEqual(DEPLOY_ROLES.map((role) => `${AUTH_DIR}/${role}.json`));
    expect(AUTH_DIR.startsWith('test-results/')).toBe(true);
  });

  it('serves a local remote build when no deployment URL is given, and only then', () => {
    const local = deployConfig({});
    expect(local.use?.baseURL).toBe(LOCAL_URL);
    expect(local.webServer).toMatchObject({ url: LOCAL_URL, reuseExistingServer: true });
    expect((local.webServer as { command: string }).command).toMatch(/vite preview --host 127\.0\.0\.1 --port 4174 --strictPort/);
    const deployed = deployConfig({ MADAR_DEPLOY_URL: 'https://preview.madar-test.pages.dev/' });
    expect(deployed.use?.baseURL).toBe('https://preview.madar-test.pages.dev');
    expect(deployed.webServer).toBeUndefined();
  });

  it('refuses a deployment URL that is not https, except on this Mac', () => {
    expect(() => deployConfig({ MADAR_DEPLOY_URL: 'http://preview.madar-test.pages.dev' })).toThrow(/https/);
    expect(deployConfig({ MADAR_DEPLOY_URL: 'http://127.0.0.1:5173' }).use?.baseURL).toBe('http://127.0.0.1:5173');
  });
});
