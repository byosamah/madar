// The local stack for the browser checks of task X2, so the specs run on a local remote build before Z6 runs them on madar-test.
//
//   npx tsx tests/e2e-deploy/local.ts functions-env <file>   write the env file of "supabase functions serve api"
//   npx tsx tests/e2e-deploy/local.ts seed                   seed the local office and the 4 accounts (runSeed of task X1)
//   npx tsx tests/e2e-deploy/local.ts playwright-env         print the shell lines for the Playwright run (eval them)
//
// The steps, under the Docker lock (plan 2b, point 6): supabase db reset, npm run build:server, supabase functions serve api
// --env-file <file>, then seed, then npx playwright test -c playwright.deploy.config.ts. Every command talks only to 127.0.0.1.
// The 4 passwords here are made-up local values; the test deployment takes its own from the secrets that accounts.ts names.
import { execFileSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeed } from '../../src/data/seed';
import { settleFuture } from '../../src/data/shift';
import { todayISO } from '../../src/lib/dates';
import { localClient } from '../../server/it/migrate';
import { clientDb, OFFICE_LOCK_KEY } from '../../scripts/first-admin';
import { runSeed, seedAuthPort, TEST_REF } from '../../scripts/seed-test-office';
import { DEPLOY_ACCOUNTS, DEPLOY_ROLES } from './accounts';

const ROOT = join(import.meta.dirname, '..', '..');
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
/** The local remote build of playwright.deploy.config.ts. */
const APP_URL = 'http://127.0.0.1:4174';
const SUPABASE_URL = 'http://127.0.0.1:54321';

/** Refuses every address that is not the local stack. */
export function localOnly(url: string): void {
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) throw new Error(`This step runs only on the local stack, not on ${new URL(url).host}.`);
}

/** The made-up local password of each role, under the secret name of accounts.ts. */
export function localPasswords(): Record<string, string> {
  return Object.fromEntries(DEPLOY_ROLES.map((role) => [DEPLOY_ACCOUNTS[role].passwordSecret, `Madar-local-${role}-pass-1`]));
}

function status(): Record<string, string> {
  const out = execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const values = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string>;
  localOnly(values.API_URL ?? SUPABASE_URL);
  return values;
}

function functionsEnv(file: string): void {
  const values = status();
  const lines = {
    // Inside the Docker network the pooler is "pooler" (proof.md E1, fact 1).
    DATABASE_URL: 'postgres://postgres.pooler-dev:postgres@pooler:6543/postgres',
    MADAR_SECRET_KEY: values.SECRET_KEY ?? values.SERVICE_ROLE_KEY,
    // A local function sees SUPABASE_URL=http://kong:8000, but its tokens name the address of the Mac (proof.md P1).
    AUTH_ISSUER: `${SUPABASE_URL}/auth/v1`,
    APP_URL,
    ALLOWED_ORIGINS: APP_URL,
    MAIL_FROM: 'Madar <notices@madar.test>',
    MAIL_DRIVER: 'outbox',
    SB_REGION: 'local-deno',
  };
  writeFileSync(file, Object.entries(lines).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  console.log(`Wrote ${file}.`);
}

async function seed(): Promise<void> {
  const values = status();
  const now = new Date();
  const office = settleFuture(await buildSeed(todayISO(now), async () => undefined), now);
  const client = await localClient();
  try {
    // runSeed takes the madar-test ref as its guard; here the database and Auth are the local stack's, as in its Docker test.
    await runSeed({
      db: clientDb(client), auth: seedAuthPort({ supabaseUrl: values.API_URL ?? SUPABASE_URL, secretKey: values.SECRET_KEY ?? values.SERVICE_ROLE_KEY }),
      seed: office, ref: TEST_REF, env: { ...localPasswords(), ...process.env }, dryRun: false, lockKey: OFFICE_LOCK_KEY, log: (line) => console.log(line),
    });
  } finally {
    await client.end();
  }
}

function playwrightEnv(): void {
  const values = status();
  const lines = { MADAR_LOCAL_PUBLISHABLE_KEY: values.PUBLISHABLE_KEY ?? values.ANON_KEY, MADAR_E2E_SUPABASE_URL: SUPABASE_URL, ...localPasswords() };
  for (const [k, v] of Object.entries(lines)) console.log(`export ${k}='${v}'`);
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const [command, file] = process.argv.slice(2);
  const run = command === 'seed' ? seed() : command === 'functions-env' && file ? Promise.resolve(functionsEnv(file)) : command === 'playwright-env' ? Promise.resolve(playwrightEnv()) : Promise.reject(new Error('Use: seed | functions-env <file> | playwright-env'));
  run.then(() => process.exit(0), (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
