import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { COPY_HOSTS } from '../../server/core/serverHost.ts';
import { hyperdriveOrigin, type HyperdriveOrigin } from './cloudflare.ts';

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
 *      as DATABASE_CA;
 *   4. the Worker of the copy (owner, 2026-10-16), when it exists: the origin password of its Hyperdrive config madar-db-<env>
 *      from DATABASE_URL, then its secrets with `wrangler secret bulk` (JSON on stdin), every function secret but the database
 *      values, with MADAR_SECRET_KEY from the Management API. A Worker that does not exist yet is skipped with a clear line.
 *
 * With --office (exit wave 4; all.sh runs it for a copy whose host word is office) it runs only step 4 without Hyperdrive: the
 * Worker secrets of the file and the office secrets, with no Supabase token and no database password (runOfficeSecrets).
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

/**
 * Hyperdrive refused the origin login (Cloudflare code 2013). Each run writes a new SCRAM verifier for madar_server, and the
 * session pooler can keep the old one for some time, so the PATCH right after it can fail (2026-10-16, the second all.sh test
 * of that day). pushWorker tries again within the sign-in limit.
 */
export class HyperdriveCredentialsRefused extends Error {}

/** The function secrets that the server reads (server/core/deps.ts). Supabase injects SUPABASE_URL, SUPABASE_SECRET_KEYS and SB_REGION. */
export const FUNCTION_SECRETS = [
  'DATABASE_URL', 'DATABASE_READ_URL', 'APP_URL', 'API_URL', 'MCP_URL', 'MAIL_FROM', 'MAIL_DRIVER', 'RESEND_API_KEY',
  'MADAR_FILE_STORE', 'FILES_BUCKET', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET',
  'MIN_CLIENT_BUILD', 'ALLOWED_ORIGINS', 'MCP_FORWARD_REGION', 'MADAR_LOCK_KEY', 'JOBS_SECRET', 'MADAR_SECRET_KEY', 'AUTH_ISSUER',
  'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_SUBJECT',
] as const;
/**
 * The secrets of an office copy (exit wave 4): the export route (GitHub) and the ops routes (the Mac). They go to the Worker only,
 * never to the Supabase functions, and on every word of the copy: the ops reach the Worker whenever the binding exists.
 */
export const OFFICE_WORKER_SECRETS = ['MADAR_EXPORT_SECRET', 'MADAR_OPS_SECRET'] as const;
/** Never in a secrets file: scripts/office/auth-key.ts writes the sign-in key straight to the Worker (wave 2, Merge notes 14). */
export const KEPT_ON_WORKER = ['MADAR_AUTH_PRIVATE_JWK'] as const;
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

/** The names that a secrets file may hold: the function secrets and the Worker secrets of an office copy. */
const FILE_NAMES: readonly string[] = [...FUNCTION_SECRETS, ...OFFICE_WORKER_SECRETS];

/**
 * The KEY=VALUE lines of secrets/<env>.env. Errors name the line or the name, never a value. file names the file in the refusal
 * of the sign-in key.
 */
export function parseSecretsFile(text: string, o: { file?: string } = {}): Record<string, string> {
  const values: Record<string, string> = {};
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const at = line.indexOf('=');
    const name = at === -1 ? '' : line.slice(0, at).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`secrets file, line ${index + 1}: not a NAME=value line.`);
    if (name.startsWith('SUPABASE_')) throw new Error(`${name}: Supabase injects every SUPABASE_ name into the functions, and refuses your own.`);
    if (name === 'DATABASE_CA') throw new Error('DATABASE_CA: leave it out. secrets.ts sets the Supabase root certificate (config/supabase-root-2021-ca.crt).');
    if ((KEPT_ON_WORKER as readonly string[]).includes(name)) throw new Error(`${name} must not be in ${o.file ?? 'a secrets file'}: scripts/office/auth-key.ts writes it to the Worker.`);
    if (!FILE_NAMES.includes(name)) throw new Error(`${name}: the server reads no such value. Known names: ${FILE_NAMES.join(', ')}.`);
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
  /** The Worker of the copy and its Hyperdrive config (Cloudflare API and wrangler). */
  worker: WorkerPort;
  /** The default secret key of the project, from the Management API (secretKeyFromApi of scripts/first-admin.ts). */
  secretKey: (ref: string, token: string) => Promise<string>;
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
  const values = parseSecretsFile(run.text, { file: `secrets/${run.target}.env` });
  const checked = checkSecrets(values, ref);
  // The office secrets go to the Worker only (pushWorker): the functions read no such value.
  const functionValues = Object.entries(values).filter(([name]) => (FUNCTION_SECRETS as readonly string[]).includes(name));
  const secrets = [...functionValues.map(([name, value]) => ({ name, value })), { name: 'DATABASE_CA', value: run.rootCa }];
  const projectUrl = `https://${ref}.supabase.co`;
  const names = secrets.map((secret) => secret.name).join(', ');

  if (run.dryRun) {
    run.log(`Dry run for ${run.target} (${ref}). Nothing changes.`);
    run.log(`Database: Vault project_url and jobs_secret, platform_config.mcp_url = ${checked.mcpUrl}, madar_server login with a SCRAM verifier.`);
    run.log(`Function secrets: ${names}.`);
    for (const line of workerDryRun(run.target, values)) run.log(line);
    return;
  }
  const token = run.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set: load the Madar token from ~/dev/madar/.env.local (never the Halulu sign-in).');
  const dbPassword = run.env[DB_PASSWORD[run.target]];
  if (!dbPassword) throw new Error(`${DB_PASSWORD[run.target]} is not set: the postgres password of ${run.target}.`);

  // The Worker checks come before any change, so a missing MCP_URL stops the run with nothing changed.
  const worker = await planWorker(run, values);

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
  if (worker) await pushWorker(run, ref, token, values, checked, worker);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The Worker of the copy (owner, 2026-10-16). Kept apart from the steps above, so the server and the files tracks of the move
// to Cloudflare merge without a clash. The Supabase functions keep every step above: they are the way back.
// ---------------------------------------------------------------------------------------------------------------------------------

/** Hyperdrive replaces the database values on the Worker (the binding DB of wrangler.server.toml), so these never go there. */
export const NOT_FOR_WORKER = ['DATABASE_URL', 'DATABASE_READ_URL', 'DATABASE_CA'] as const;
/**
 * The secret names of the Worker: every function secret but the database values, and the office secrets (exit wave 4).
 * MADAR_SECRET_KEY comes from the Management API.
 */
export const WORKER_SECRETS: readonly string[] = [
  ...FUNCTION_SECRETS.filter((name) => !(NOT_FOR_WORKER as readonly string[]).includes(name)),
  ...OFFICE_WORKER_SECRETS,
];

export type WorkerPort = {
  /** True when the Worker exists on the Cloudflare account. */
  exists(name: string): Promise<boolean>;
  /** The id of the Hyperdrive config of that name, or undefined when it does not exist. */
  hyperdriveId(name: string): Promise<string | undefined>;
  /** Sets the origin of a Hyperdrive config (the password changes with it), through the Cloudflare API. */
  updateHyperdrive(id: string, origin: HyperdriveOrigin): Promise<void>;
  /** `wrangler secret bulk -c wrangler.server.toml --env <target>`, with the JSON on stdin. */
  secretBulk(target: Target, json: string): Promise<void>;
};

/**
 * The JSON of `wrangler secret bulk`: each Worker name with its value. A name that the file does not set goes as null, so the
 * Worker loses it (Supabase function secrets stay until someone removes them). The file's MADAR_SECRET_KEY never counts: the
 * Worker gets the key that Supabase gives the functions, so both hosts sign the MCP state with the same key.
 */
export function workerSecretsOf(values: Record<string, string>, secretKey: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const name of WORKER_SECRETS) out[name] = name === 'MADAR_SECRET_KEY' ? secretKey : (values[name] ?? null);
  return out;
}

/** The Worker lines of a dry run: names only, and no network call. */
export function workerDryRun(target: Target, values: Record<string, string>): string[] {
  const hosts = COPY_HOSTS[target].workers;
  const set = WORKER_SECRETS.filter((name) => name === 'MADAR_SECRET_KEY' || values[name] !== undefined);
  const removed = WORKER_SECRETS.filter((name) => name !== 'MADAR_SECRET_KEY' && values[name] === undefined);
  return [
    `Worker ${hosts.name}, when it exists: Hyperdrive ${hosts.hyperdrive} gets the madar_server password of DATABASE_URL (session pooler).`,
    `Worker secrets: ${set.join(', ')}. MADAR_SECRET_KEY comes from the Management API.${values.MCP_URL ? '' : ' MCP_URL is missing: the Worker step would stop.'}`,
    ...(removed.length > 0 ? [`Removed from the Worker (not in the file): ${removed.join(', ')}.`] : []),
    `Never sent to the Worker: ${NOT_FOR_WORKER.join(', ')}.`,
  ];
}

type WorkerPlan = { name: string; hyperdrive?: { name: string; id: string } };

/** The Worker and its Hyperdrive config, looked up before any change. A Worker needs MCP_URL: it has no default there. */
async function planWorker(run: SecretsRun, values: Record<string, string>): Promise<WorkerPlan | undefined> {
  const hosts = COPY_HOSTS[run.target].workers;
  if (!(await run.worker.exists(hosts.name))) {
    run.log(`Skip: the Worker ${hosts.name} does not exist yet, so it gets no secrets and no Hyperdrive password. Deploy it (scripts/deploy/worker.sh ${run.target}), then run secrets.ts again.`);
    return undefined;
  }
  if (!values.MCP_URL) {
    throw new Error(`MCP_URL: the Worker ${hosts.name} needs the short MCP address in secrets/${run.target}.env (it has no default there). Nothing changed.`);
  }
  const id = await run.worker.hyperdriveId(hosts.hyperdrive);
  if (!id) run.log(`Skip: the Hyperdrive config ${hosts.hyperdrive} does not exist yet (npx tsx scripts/deploy/cloudflare-setup.ts --env ${run.target}).`);
  return { name: hosts.name, ...(id ? { hyperdrive: { name: hosts.hyperdrive, id } } : {}) };
}

/** After the function secrets: the Hyperdrive password first (the role has the new one), then the Worker secrets. */
async function pushWorker(run: SecretsRun, ref: string, token: string, values: Record<string, string>, checked: Checked, plan: WorkerPlan): Promise<void> {
  if (plan.hyperdrive) {
    const origin = hyperdriveOrigin(ref, checked.serverPassword);
    for (let waited = 0; ; waited += SIGN_IN_WAIT_MS) {
      try {
        await run.worker.updateHyperdrive(plan.hyperdrive.id, origin);
        break;
      } catch (error) {
        if (!(error instanceof HyperdriveCredentialsRefused) || waited >= SIGN_IN_LIMIT_MS) throw error;
        await run.sleep(SIGN_IN_WAIT_MS);
      }
    }
    run.log(`Hyperdrive ${plan.hyperdrive.name}: the madar_server password of DATABASE_URL, on the session pooler.`);
  }
  const secrets = workerSecretsOf(values, await run.secretKey(ref, token));
  await run.worker.secretBulk(run.target, JSON.stringify(secrets));
  const removed = Object.keys(secrets).filter((name) => secrets[name] === null);
  run.log(`Worker secrets of ${plan.name}: ${Object.keys(secrets).filter((name) => secrets[name] !== null).join(', ')} (MADAR_SECRET_KEY from the Management API).`);
  if (removed.length > 0) run.log(`Removed from the Worker (not in the file): ${removed.join(', ')}.`);
}

/**
 * The bulk JSON of an office copy (exit wave 4): every Worker secret of the file, or null to remove it. MADAR_SECRET_KEY stays
 * out: the Worker keeps the key that the earlier runs gave it, so an office deploy needs no Supabase token.
 */
export function officeSecretsOf(values: Record<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const name of WORKER_SECRETS) if (name !== 'MADAR_SECRET_KEY') out[name] = values[name] ?? null;
  return out;
}

export type OfficeSecretsRun = {
  target: Target; text: string; dryRun: boolean; log: (line: string) => void;
  worker: Pick<WorkerPort, 'exists' | 'secretBulk'>;
};

/**
 * secrets.ts <env> --office (exit wave 4): the Worker secrets of an office copy only. No Supabase token, no database password,
 * no Hyperdrive and no function secret: the Supabase project keeps its last state as the way back. The test copy only until the
 * switch of production (wave 6).
 */
export async function runOfficeSecrets(run: OfficeSecretsRun): Promise<void> {
  if (run.target !== 'test') throw new Error('Only the test copy runs on its office object now; production comes with the switch (wave 6).');
  const values = parseSecretsFile(run.text, { file: `secrets/${run.target}.env` });
  if (!values.MCP_URL) throw new Error(`MCP_URL is missing in secrets/${run.target}.env: the own OAuth issuer comes from it.`);
  const secrets = officeSecretsOf(values);
  const set = Object.keys(secrets).filter((name) => secrets[name] !== null);
  const removed = Object.keys(secrets).filter((name) => secrets[name] === null);
  if (run.dryRun) {
    run.log(`Dry run of the office copy ${run.target}. Worker secrets: ${set.join(', ')}. Removed: ${removed.join(', ') || 'none'}. Kept: MADAR_SECRET_KEY, ${KEPT_ON_WORKER.join(', ')}.`);
    return;
  }
  const name = COPY_HOSTS[run.target].workers.name;
  if (!(await run.worker.exists(name))) {
    run.log(`Skip: ${name} does not exist yet. Run scripts/deploy/worker.sh ${run.target} first.`);
    return;
  }
  await run.worker.secretBulk(run.target, JSON.stringify(secrets));
  run.log(`Worker secrets of ${name}: ${set.join(', ')}. Kept as they are: MADAR_SECRET_KEY, ${KEPT_ON_WORKER.join(', ')}.`);
  if (removed.length > 0) run.log(`Removed from the Worker (not in the file): ${removed.join(', ')}.`);
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const target = args.find((arg) => !arg.startsWith('--'));
  if (target !== 'test' && target !== 'production') {
    console.error('Usage: npx tsx scripts/deploy/secrets.ts <test|production> [--dry-run] [--office]');
    process.exit(2);
  }
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const file = `${root}secrets/${target}.env`;
  if (!existsSync(file)) {
    console.error(`${file} is missing. It holds the function secrets of ${target} (git ignores secrets/).`);
    process.exit(1);
  }
  const cloudflare = await import('./cloudflare.ts');
  const wrangler = `${root}node_modules/.bin/wrangler`;
  const wranglerEnv = { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? cloudflare.ACCOUNT_ID };
  let api: ReturnType<typeof cloudflare.cloudflareApi> | undefined;
  /** The Cloudflare API, made at the first Worker step: a dry run and a run before the cloud setup need no sign-in. */
  const cf = async () => {
    if (!api) {
      // wrangler whoami refreshes the OAuth token of the sign-in. Its output names the account, so it stays out of the log.
      if (!process.env.CLOUDFLARE_API_TOKEN) await cloudflare.runWithStdin(wrangler, ['whoami'], '', { cwd: root, env: wranglerEnv });
      api = cloudflare.cloudflareApi(cloudflare.cloudflareToken());
    }
    return api;
  };
  const exists = async (name: string): Promise<boolean> => {
    const answer = await (await cf())(`/workers/scripts/${name}/settings`);
    if (answer.status === 404) return false;
    if (!answer.success) throw new Error(`The Cloudflare API refused the check of the Worker ${name}: ${cloudflare.codesOf(answer)}. Run npx wrangler whoami, then secrets.ts again.`);
    return true;
  };
  const secretBulk = async (env: Target, json: string): Promise<void> => {
    const values = Object.values(JSON.parse(json) as Record<string, string | null>).filter((value): value is string => typeof value === 'string');
    // The values go on stdin only: never in an argument, never in a file.
    const { code, output } = await cloudflare.runWithStdin(wrangler, ['secret', 'bulk', '-c', 'wrangler.server.toml', '--env', env], json, { cwd: root, env: wranglerEnv });
    if (code !== 0) {
      const tail = cloudflare.redact(output, values).trim().split('\n').slice(-6).join(' | ');
      throw new Error(`wrangler secret bulk failed for ${env} (exit ${code}): ${tail}`);
    }
  };
  const failed = (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  };
  if (args.includes('--office')) {
    // An office copy (exit wave 4): the Worker secrets only. No pg, no Supabase token, no database password.
    await runOfficeSecrets({ target, text: readFileSync(file, 'utf8'), dryRun: args.includes('--dry-run'), log: (line) => console.log(line), worker: { exists, secretBulk } }).catch(failed);
    process.exit(0);
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
    worker: {
      exists,
      hyperdriveId: async (name) => {
        const answer = await (await cf())<{ id: string; name: string }[]>('/hyperdrive/configs');
        if (!answer.success) throw new Error(`The Cloudflare API refused the list of the Hyperdrive configs: ${cloudflare.codesOf(answer)}.`);
        return answer.result.find((config) => config.name === name)?.id;
      },
      updateHyperdrive: async (id, origin) => {
        const answer = await (await cf())(`/hyperdrive/configs/${id}`, { method: 'PATCH', body: { origin } });
        if (!answer.success) {
          const text = `The Cloudflare API refused the Hyperdrive password: ${cloudflare.redact(cloudflare.codesOf(answer), [origin.password])}. The function secrets are set; the Worker has the old password. Run secrets.ts again.`;
          throw answer.errors.some((e) => e.code === 2013) ? new HyperdriveCredentialsRefused(text) : new Error(text);
        }
      },
      secretBulk,
    },
    secretKey: async (ref, token) => (await import('../first-admin.ts')).secretKeyFromApi(ref, token),
  }).catch(failed);
}
