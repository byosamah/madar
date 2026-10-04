import { defineConfig, devices } from '@playwright/test';
import { buildId } from './scripts/build-remote';
import { DEPLOY_ACCOUNTS, storageStateOf } from './tests/e2e-deploy/accounts';

/**
 * The browser checks on the test deployment (plan 7.5; tasks X1, X2): npx playwright test -c playwright.deploy.config.ts.
 *
 * - MADAR_DEPLOY_URL is the deployment to check (the Cloudflare Pages preview of madar-test).
 * - Without it, the checks run on the local stack. The config makes its own remote build for the local stack in
 *   test-results/remote-local (never dist/, where npm run build puts the prototype) and serves it with vite preview on port
 *   4174. It never reuses a server on that port. It needs MADAR_LOCAL_PUBLISHABLE_KEY, the PUBLISHABLE_KEY line of
 *   "supabase status -o env". The local stack must serve the api function (supabase functions serve api) with
 *   http://127.0.0.1:4174 in ALLOWED_ORIGINS (or APP_URL), and hold the seeded office and the 4 accounts.
 * - The setup project (tests/e2e-deploy/auth.setup.ts) signs in once for each office role and keeps the session (storageState)
 *   in playwright/.auth, outside the run output. It records no trace, because a trace keeps the typed password. The 4 accounts
 *   and their password secrets are in tests/e2e-deploy/accounts.ts; scripts/seed-test-office.ts makes them.
 * - A spec runs as the Admin unless it picks another role with test.use({ storageState: storageStateOf(role) }).
 * - A failed spec keeps its trace in test-results/e2e-deploy. That trace can hold a short-lived access token, so a CI job keeps
 *   it only as a private artifact with a short retention.
 * Playwright runs only in a delegated agent (plan 7.5).
 */
export const LOCAL_URL = 'http://127.0.0.1:4174';
/** The API gateway of the local Supabase stack (supabase start). */
export const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
/** The remote build for the local stack. git ignores test-results/. */
export const LOCAL_OUT_DIR = 'test-results/remote-local';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

function baseUrlOf(value: string | undefined): string {
  if (!value) return LOCAL_URL;
  const url = new URL(value);
  if (url.protocol !== 'https:' && !LOCAL_HOSTS.has(url.hostname)) throw new Error(`MADAR_DEPLOY_URL must be https: ${url.host}.`);
  return url.toString().replace(/\/+$/, '');
}

/** Builds the screens for the local stack and serves them. Without the publishable key it stops at once and says why. */
function localServer(env: Record<string, string | undefined>) {
  const key = env.MADAR_LOCAL_PUBLISHABLE_KEY;
  const command = key
    ? `npx vite build --mode remote-local --outDir ${LOCAL_OUT_DIR} && npx vite preview --mode remote-local --outDir ${LOCAL_OUT_DIR} --host 127.0.0.1 --port 4174 --strictPort`
    : 'echo "MADAR_LOCAL_PUBLISHABLE_KEY is missing: set it to the PUBLISHABLE_KEY line of supabase status -o env, or set MADAR_DEPLOY_URL." >&2; exit 1';
  return {
    command,
    url: LOCAL_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      VITE_MADAR_API: 'remote',
      VITE_SUPABASE_URL: LOCAL_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: key ?? '',
      VITE_MADAR_BUILD: buildId(new Date()),
    },
  };
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
      { name: 'setup', testMatch: /auth\.setup\.ts$/, use: { trace: 'off' } },
      {
        name: 'deploy',
        testMatch: /\.spec\.ts$/,
        dependencies: ['setup'],
        use: { ...devices['Desktop Chrome'], storageState: storageStateOf(DEPLOY_ACCOUNTS.admin.role) },
      },
    ],
    ...(deployed ? {} : { webServer: localServer(env) }),
  });
}

export default deployConfig();
