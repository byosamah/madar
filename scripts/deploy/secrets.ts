import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

/**
 * The secrets of one Supabase project (plan 5.9; proof Z0a, item 3):
 *   npx tsx scripts/deploy/secrets.ts <test|production> [--dry-run]
 *
 * It reads secrets/<env>.env (git ignores the folder) and:
 *   1. in one transaction, as postgres through the session pooler: writes the Vault secrets project_url and jobs_secret, writes
 *      platform_config.mcp_url, and makes madar_server a login role with the password of DATABASE_URL, sent as a SCRAM verifier;
 *   2. signs in with DATABASE_URL through the transaction pooler until current_user is madar_server, for up to a minute, because the
 *      pooler once refused a new password at first (proof Z0a, item 7); without that sign in it stops, and no function secret changes;
 *   3. sets the function secrets through the Management API (what `supabase secrets set` calls), with the Supabase root certificate
 *      as DATABASE_CA.
 *
 * It needs SUPABASE_ACCESS_TOKEN (the Madar account, never the Halulu sign-in of the CLI) and the postgres password of the project:
 * MADAR_TEST_DB_PASSWORD for test, MADAR_DB_PASSWORD for production. Production runs from the Mac only, after the typed word
 * production (plan, section 10, decision 9). It prints names, never a value.
 */

export type Target = 'test' | 'production';
export const REFS: Record<Target, string> = { test: 'qdgwpnesxppnqsaabqzd', production: 'oprkvdjudjxxhvodkzgs' };
const DB_PASSWORD: Record<Target, string> = { test: 'MADAR_TEST_DB_PASSWORD', production: 'MADAR_DB_PASSWORD' };
export const POOLER_HOST = 'aws-1-eu-central-1.pooler.supabase.com';
/** The advisory lock key of the health check (server/core/deps.ts, which imports the whole server, so a test keeps the two equal). */
export const HEALTH_LOCK_KEY = 7_310_999;
/** The sign in check after the new password: one try every 5 s for up to 60 s (proof Z0a, item 7). */
export const SIGN_IN_WAIT_MS = 5_000;
export const SIGN_IN_LIMIT_MS = 60_000;

/** The function secrets that the server reads (server/core/deps.ts). Supabase injects SUPABASE_URL, SUPABASE_SECRET_KEYS and SB_REGION. */
export const FUNCTION_SECRETS = [
  'DATABASE_URL', 'DATABASE_READ_URL', 'APP_URL', 'API_URL', 'MCP_URL', 'MAIL_FROM', 'MAIL_DRIVER', 'RESEND_API_KEY',
  'MADAR_FILE_STORE', 'FILES_BUCKET', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET',
  'MIN_CLIENT_BUILD', 'ALLOWED_ORIGINS', 'MCP_FORWARD_REGION', 'MADAR_LOCK_KEY', 'JOBS_SECRET', 'MADAR_SECRET_KEY', 'AUTH_ISSUER',
  'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_SUBJECT',
] as const;
/** Browser push (owner, 2026-10-08): all three or none (server/core/deps.ts). scripts/push/make-vapid.ts writes them. */
const VAPID_NAMES = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;
export const R2_NAMES = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const;
/** The R2 bucket of each copy (owner, 2026-10-16). Both are in the EU jurisdiction (server/files/r2.ts signs on the EU endpoint). */
export const R2_BUCKETS: Record<Target, string> = { test: 'madar-files-test', production: 'madar-files' };

export type R2Values = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };

/**
 * The R2 values of one copy, or null when no R2_ name is set. All four or none. R2_ACCOUNT_ID is the 32 hex characters of the
 * Cloudflare account, and R2_BUCKET is the bucket of that copy, so production never points at the test bucket (or the reverse).
 * The R2 lines may go into the file before the switch: the server ignores them while MADAR_FILE_STORE is supabase.
 * scripts/storage and the seed use the same check. Errors name the variable, never a value.
 */
export function r2Values(values: Record<string, string | undefined>, target: Target): R2Values | null {
  if (!R2_NAMES.some((name) => values[name] !== undefined)) return null;
  const absent = R2_NAMES.filter((name) => !values[name]);
  if (absent.length > 0) throw new Error(`R2 needs all of ${R2_NAMES.join(', ')}. The secrets file needs ${absent.join(', ')}.`);
  if (!/^[0-9a-f]{32}$/.test(values.R2_ACCOUNT_ID!)) throw new Error('R2_ACCOUNT_ID must be the 32 hex characters of the Cloudflare account.');
  if (values.R2_BUCKET !== R2_BUCKETS[target]) throw new Error(`R2_BUCKET must be ${R2_BUCKETS[target]} for ${target}.`);
  return { accountId: values.R2_ACCOUNT_ID!, accessKeyId: values.R2_ACCESS_KEY_ID!, secretAccessKey: values.R2_SECRET_ACCESS_KEY!, bucket: values.R2_BUCKET! };
}

/** The KEY=VALUE lines of secrets/<env>.env. Errors name the line or the name, never a value. */
export function parseSecretsFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const at = line.indexOf('=');
    const name = at === -1 ? '' : line.slice(0, at).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`secrets file, line ${index + 1}: not a NAME=value line.`);
    if (name.startsWith('SUPABASE_')) throw new Error(`${name}: Supabase injects every SUPABASE_ name into the functions, and refuses your own.`);
    if (name === 'DATABASE_CA') throw new Error('DATABASE_CA: leave it out. secrets.ts sets the Supabase root certificate (config/supabase-root-2021-ca.crt).');
    if (!(FUNCTION_SECRETS as readonly string[]).includes(name)) throw new Error(`${name}: the server reads no such value. Known names: ${FUNCTION_SECRETS.join(', ')}.`);
    if (name in values) throw new Error(`${name}: the file sets it twice.`);
    values[name] = line.slice(at + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
  });
  return values;
}

export type Checked = { serverPassword: string; mcpUrl: string; jobsSecret: string };

/**
 * A database URL of the server (plan, change 24): madar_server of this project on the transaction pooler, with no TLS setting.
 * It gives the password. Errors name the setting, never a value.
 */
function checkServerUrl(name: string, text: string, ref: string): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${name} is not a URL.`);
  }
  if (url.username !== `madar_server.${ref}`) throw new Error(`${name} must sign in as madar_server.${ref}, the server role of this project.`);
  if (url.hostname !== POOLER_HOST || url.port !== '6543') throw new Error(`${name} must use the transaction pooler ${POOLER_HOST}:6543.`);
  if (/[?&](ssl\w*|uselibpqcompat)=/i.test(url.search)) throw new Error(`${name} must not carry a TLS setting such as sslmode: the server uses DATABASE_CA.`);
  if (url.password === '') throw new Error(`${name} must hold the madar_server password.`);
  return decodeURIComponent(url.password);
}

/** The rules of the server's start (server/core/deps.ts) and of the server role (plan, change 24), checked before anything changes. */
export function checkSecrets(values: Record<string, string>, ref: string): Checked {
  const driver = values.MAIL_DRIVER ?? 'resend';
  if (driver !== 'resend' && driver !== 'outbox') throw new Error('MAIL_DRIVER must be resend or outbox.');
  const needed = ['DATABASE_URL', 'APP_URL', 'MAIL_FROM'];
  if (driver === 'resend') needed.push('RESEND_API_KEY');
  needed.push('JOBS_SECRET');
  if (values.MADAR_FILE_STORE === 'r2') needed.push(...R2_NAMES);
  const missing = needed.filter((name) => !values[name]);
  if (missing.length > 0) throw new Error(`The secrets file needs ${missing.join(', ')}.`);
  if (values.MADAR_FILE_STORE !== undefined && !['supabase', 'r2'].includes(values.MADAR_FILE_STORE)) throw new Error('MADAR_FILE_STORE must be supabase or r2.');
  const target = (Object.keys(REFS) as Target[]).find((name) => REFS[name] === ref);
  if (!target) throw new Error('The project must be madar-test or madar.');
  r2Values(values, target);

  const serverPassword = checkServerUrl('DATABASE_URL', values.DATABASE_URL, ref);
  // secrets.ts sets the role password from DATABASE_URL only, and postgres must never read for the server: it skips RLS.
  if (values.DATABASE_READ_URL !== undefined && checkServerUrl('DATABASE_READ_URL', values.DATABASE_READ_URL, ref) !== serverPassword) {
    throw new Error('DATABASE_READ_URL must hold the password of DATABASE_URL: the role madar_server has one password.');
  }

  if (VAPID_NAMES.some((name) => values[name] !== undefined)) {
    const absent = VAPID_NAMES.filter((name) => !values[name]);
    if (absent.length > 0) throw new Error(`Browser push needs all of ${VAPID_NAMES.join(', ')}. The secrets file needs ${absent.join(', ')}.`);
    if (!/^B[A-Za-z0-9_-]{86}$/.test(values.VAPID_PUBLIC_KEY)) throw new Error('VAPID_PUBLIC_KEY must be the 65 byte public point as 87 base64url characters.');
    if (!/^[A-Za-z0-9_-]{43}$/.test(values.VAPID_PRIVATE_KEY)) throw new Error('VAPID_PRIVATE_KEY must be the 32 byte private value as 43 base64url characters.');
    if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(values.VAPID_SUBJECT)) throw new Error('VAPID_SUBJECT must be a mailto: or https: address.');
  }

  if (values.MADAR_LOCK_KEY !== undefined) {
    const lockKey = Number(values.MADAR_LOCK_KEY);
    if (values.MADAR_LOCK_KEY === '' || !Number.isSafeInteger(lockKey)) throw new Error('MADAR_LOCK_KEY must be a whole number.');
    if (lockKey === HEALTH_LOCK_KEY) throw new Error('MADAR_LOCK_KEY must not be the health check key.');
  }

  if (!/^https:\/\//.test(values.APP_URL) || /\/\/(127\.0\.0\.1|localhost)[:/]?/.test(values.APP_URL)) throw new Error('APP_URL must be the https address of the screens.');
  const mcpUrl = values.MCP_URL ?? `https://${ref}.supabase.co/functions/v1/mcp`;
  if (!/^https:\/\/[^?#]+$/.test(mcpUrl)) {
    throw new Error('MCP_URL must be an https URL with no query: it is the OAuth resource URL, so forceFunctionRegion never goes there (plan, change 5).');
  }
  return { serverPassword, mcpUrl, jobsSecret: values.JOBS_SECRET };
}

const SCRAM_ITERATIONS = 4096;

/**
 * The SCRAM-SHA-256 verifier that Postgres stores for a password (RFC 5802, RFC 7677): SCRAM-SHA-256$4096:<salt>$<StoredKey>:<ServerKey>.
 * Copied from scripts/proof/lib.ts. Postgres takes it in ALTER ROLE as it is, so the DDL log of the hosted project never holds the
 * plain password (proof Z0a, item 3). The password must be printable ASCII, because Postgres runs SASLprep on other text first.
 */
export function scramSha256Verifier(password: string, salt: Buffer = randomBytes(16)): string {
  if (!/^[\x21-\x7e]+$/.test(password)) throw new Error('the madar_server password must be printable ASCII with no space');
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest('base64');
  const serverKey = createHmac('sha256', salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString('base64')}$${storedKey}:${serverKey}`;
}

/** madar_server as a login role. The migration makes it nologin; the statement carries the verifier, never the password. */
export function serverRoleSql(password: string): string {
  // The verifier is base64 with "$" and ":", so it holds no quote.
  return `alter role madar_server with login noinherit password '${scramSha256Verifier(password)}'`;
}

export type Query = (text: string, values?: unknown[]) => Promise<{ rowCount: number | null }>;
export type SecretsRun = {
  target: Target;
  /** The text of secrets/<env>.env. */
  text: string;
  rootCa: string;
  env: Record<string, string | undefined>;
  dryRun: boolean;
  connect: (o: { ref: string; password: string; ca: string }) => Promise<{ query: Query; end: () => Promise<void> }>;
  /** Signs in with a server URL through the transaction pooler and gives current_user. */
  serverUser: (o: { url: string; ca: string }) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  fetch: typeof fetch;
  ask: (question: string) => Promise<string>;
  log: (line: string) => void;
};

/** Production only from the Mac, and only after the typed word (plan, section 10, decision 9). all.sh asks once for every step. */
async function confirmProduction(run: SecretsRun, ref: string): Promise<void> {
  if (run.target !== 'production') return;
  if (run.env.CI || run.env.GITHUB_ACTIONS) throw new Error('Production deploys run from the Mac only (plan, section 10, decision 9). GitHub deploys only the test project.');
  if (run.env.MADAR_DEPLOY_CONFIRMED === 'production') return;
  const word = await run.ask(`This changes the production project ${ref}. Type production to go on: `);
  if (word.trim() !== 'production') throw new Error('Stopped: the typed word was not production. Nothing changed.');
}

/**
 * madar_server signs in with DATABASE_URL through the transaction pooler (proof Z0a, item 7). The error names no value: a driver
 * error can quote the URL, so its text stays out.
 */
async function waitForServerSignIn(run: SecretsRun, url: string): Promise<void> {
  for (let waited = 0; ; waited += SIGN_IN_WAIT_MS) {
    const user = await run.serverUser({ url, ca: run.rootCa }).catch(() => '');
    if (user === 'madar_server') return;
    if (waited >= SIGN_IN_LIMIT_MS) break;
    await run.sleep(SIGN_IN_WAIT_MS);
  }
  throw new Error(
    `madar_server could not sign in through the transaction pooler with DATABASE_URL of ${run.target} for ${SIGN_IN_LIMIT_MS / 1000} s. ` +
      'The database has the new password; no function secret changed. Run secrets.ts again.',
  );
}

export async function runSecrets(run: SecretsRun): Promise<void> {
  const ref = REFS[run.target];
  if (!ref) throw new Error('The target must be test or production.');
  await confirmProduction(run, ref);
  const values = parseSecretsFile(run.text);
  const checked = checkSecrets(values, ref);
  const secrets = [...Object.entries(values).map(([name, value]) => ({ name, value })), { name: 'DATABASE_CA', value: run.rootCa }];
  const projectUrl = `https://${ref}.supabase.co`;
  const names = secrets.map((secret) => secret.name).join(', ');

  if (run.dryRun) {
    run.log(`Dry run for ${run.target} (${ref}). Nothing changes.`);
    run.log(`Database: Vault project_url and jobs_secret, platform_config.mcp_url = ${checked.mcpUrl}, madar_server login with a SCRAM verifier.`);
    run.log(`Function secrets: ${names}.`);
    return;
  }
  const token = run.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set: load the Madar token from ~/dev/madar/.env.local (never the Halulu sign-in).');
  const dbPassword = run.env[DB_PASSWORD[run.target]];
  if (!dbPassword) throw new Error(`${DB_PASSWORD[run.target]} is not set: the postgres password of ${run.target}.`);

  const db = await run.connect({ ref, password: dbPassword, ca: run.rootCa });
  try {
    await db.query('begin');
    try {
      for (const [name, value] of [['project_url', projectUrl], ['jobs_secret', checked.jobsSecret]]) {
        const updated = await db.query('select vault.update_secret(id, $2) from vault.secrets where name = $1', [name, value]);
        if (!updated.rowCount) await db.query('select vault.create_secret($2, $1)', [name, value]);
      }
      await db.query("insert into public.platform_config (key, value) values ('mcp_url', $1) on conflict (key) do update set value = excluded.value", [checked.mcpUrl]);
      await db.query(serverRoleSql(checked.serverPassword));
      await db.query('commit');
    } catch (error) {
      await db.query('rollback').catch(() => undefined);
      throw error;
    }
  } finally {
    await db.end();
  }
  run.log(`Database of ${run.target}: Vault project_url and jobs_secret, platform_config.mcp_url, madar_server login.`);
  await waitForServerSignIn(run, values.DATABASE_URL);
  run.log(`madar_server signs in through the transaction pooler of ${run.target}.`);

  const answer = await run.fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(secrets),
  });
  if (!answer.ok) throw new Error(`The Management API refused the function secrets of ${run.target}: HTTP ${answer.status}.`);
  run.log(`Function secrets of ${run.target}: ${names}.`);
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const target = args.find((arg) => !arg.startsWith('--'));
  if (target !== 'test' && target !== 'production') {
    console.error('Usage: npx tsx scripts/deploy/secrets.ts <test|production> [--dry-run]');
    process.exit(2);
  }
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const file = `${root}secrets/${target}.env`;
  if (!existsSync(file)) {
    console.error(`${file} is missing. It holds the function secrets of ${target} (git ignores secrets/).`);
    process.exit(1);
  }
  const { default: pg } = await import('pg');
  runSecrets({
    target,
    text: readFileSync(file, 'utf8'),
    rootCa: readFileSync(`${root}config/supabase-root-2021-ca.crt`, 'utf8'),
    env: process.env,
    dryRun: args.includes('--dry-run'),
    connect: async ({ ref, password, ca }) => {
      // The session pooler as postgres, with the root certificate and a checked host name (proof Z0a, item 3).
      const client = new pg.Client({
        host: POOLER_HOST, port: 5432, user: `postgres.${ref}`, password, database: 'postgres',
        ssl: { ca, rejectUnauthorized: true, servername: POOLER_HOST },
      });
      await client.connect();
      return { query: (text, values) => client.query(text, values), end: () => client.end() };
    },
    serverUser: async ({ url, ca }) => {
      // The transaction pooler as madar_server, as the functions connect (server/data/sql.ts), with the checked host name.
      const parsed = new URL(url);
      const client = new pg.Client({
        host: parsed.hostname, port: Number(parsed.port), user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password),
        database: decodeURIComponent(parsed.pathname.slice(1)) || 'postgres',
        ssl: { ca, rejectUnauthorized: true, servername: parsed.hostname },
        connectionTimeoutMillis: 10_000,
      });
      try {
        await client.connect();
        const answer = await client.query<{ current_user: string }>('select current_user');
        return answer.rows[0]?.current_user ?? '';
      } finally {
        await client.end().catch(() => undefined);
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fetch,
    ask: async (question) => {
      const reader = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await reader.question(question);
      } catch {
        return '';
      } finally {
        reader.close();
      }
    },
    log: (line) => console.log(line),
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
