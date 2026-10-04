import { defineConfig, devices } from '@playwright/test';
import { DEPLOY_ACCOUNTS, storageStateOf } from './tests/e2e-deploy/accounts';

/**
 * The browser checks on the test deployment (plan 7.5; tasks X1, X2): npx playwright test -c playwright.deploy.config.ts.
 *
 * - MADAR_DEPLOY_URL is the deployment to check (the Cloudflare Pages preview of madar-test). Without it, the checks run on a
 *   local remote build: build it first (npm run build:remote), and this config serves dist/ with vite preview on port 4174.
 * - The setup project (tests/e2e-deploy/auth.setup.ts) signs in once for each office role and keeps the session (storageState).
 *   The 4 accounts and their password secrets are in tests/e2e-deploy/accounts.ts; scripts/seed-test-office.ts makes them.
 * - A spec runs as the Admin unless it picks another role with test.use({ storageState: storageStateOf(role) }).
 * Playwright runs only in a delegated agent (plan 7.5).
 */
export const LOCAL_URL = 'http://127.0.0.1:4174';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

function baseUrlOf(value: string | undefined): string {
  if (!value) return LOCAL_URL;
  const url = new URL(value);
  if (url.protocol !== 'https:' && !LOCAL_HOSTS.has(url.hostname)) throw new Error(`MADAR_DEPLOY_URL must be https: ${url.host}.`);
  return url.toString().replace(/\/+$/, '');
}

export function deployConfig(env: Record<string, string | undefined> = process.env) {
  const deployed = env.MADAR_DEPLOY_URL;
  const baseURL = baseUrlOf(deployed);
  return defineConfig({
    testDir: 'tests/e2e-deploy',
    outputDir: 'test-results/e2e-deploy',
    timeout: 120_000,
    retries: env.CI ? 1 : 0,
    use: { baseURL, trace: 'retain-on-failure' },
    projects: [
      { name: 'setup', testMatch: /auth\.setup\.ts$/ },
      {
        name: 'deploy',
        testMatch: /\.spec\.ts$/,
        dependencies: ['setup'],
        use: { ...devices['Desktop Chrome'], storageState: storageStateOf(DEPLOY_ACCOUNTS.admin.role) },
      },
    ],
    ...(deployed
      ? {}
      : {
          webServer: {
            command: 'npx vite preview --host 127.0.0.1 --port 4174 --strictPort',
            url: LOCAL_URL,
            reuseExistingServer: true,
            timeout: 60_000,
          },
        }),
  });
}

export default deployConfig();
