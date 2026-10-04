import { authAdminPort } from '../auth/admin';
// Registers the Auth effects (auth.invite, auth.ban, auth.unban, auth.email) in every entry (plan 4.12).
import '../auth/effects';
// Registers the file effect (r2.delete) in every entry, also one that runs only jobs (plan 4.12).
import '../files/effects';
// Registers the agent effect (agents.revokeAll) in every entry, also one that runs only jobs (plan 4.12).
import '../mcp/revokeAll';
// Registers the mail effects (mail.notice, mail.quotaWarning) and the notice producers in every entry (task N2.2).
import '../mail/effects';
import { pgDb } from '../data/sql';
import { env } from '../env';
import { r2FilesPort } from '../files/r2';
import { supabaseStorageFilesPort } from '../files/supabaseStorage';
import { outboxMailPort } from '../mail/outboxDriver';
import { resendMailPort } from '../mail/resend';
import { realtimeSender } from '../signal/realtime';
import { meterPort } from '../usage/meter';
import { FILE_STORE_LIMITS, fileStoreKind, type Config, type Db, type Deps, type LogFields, type Logger } from './ports';

/**
 * The real Deps from the environment (plan 4.5, task E2), the same on Supabase Edge Functions and on Cloudflare Workers.
 * Each port comes from its owner track; until a track merges, its T0 stub refuses with ApiError('failed').
 * A missing value stops the start, and the error names every missing value. No error ever holds a value.
 *
 * Values:
 *   DATABASE_URL           the transaction pooler, as madar_server (required); no TLS setting (ssl, sslmode and the like) in it
 *   DATABASE_READ_URL      the pool for reads (default DATABASE_URL)
 *   DATABASE_CA            the root certificate (required unless every database host, write and read, is a local name)
 *   SUPABASE_URL           the project URL (Supabase injects it)
 *   AUTH_ISSUER            the issuer of the browser tokens (default SUPABASE_URL/auth/v1), where the function sees another
 *                          address for Auth than the browser does (server/auth/verify.ts)
 *   SUPABASE_SECRET_KEYS   the secret keys as JSON (Supabase injects it), or MADAR_SECRET_KEY on a host that does not
 *   APP_URL                the screens (required); API_URL and MCP_URL default to the function URLs of SUPABASE_URL
 *   MAIL_FROM              the sender (required); MAIL_DRIVER resend (default, needs RESEND_API_KEY) or outbox
 *   MADAR_FILE_STORE       supabase (default, bucket FILES_BUCKET or madar-files) or r2 (needs the four R2_ values)
 *   FILES_PUBLIC_URL       the address of the Supabase Storage links for the browser (default SUPABASE_URL), where the function
 *                          sees another address for Storage than the browser does (a local function sees http://kong:8000)
 *   MIN_CLIENT_BUILD       the oldest screen build the server accepts (default 0)
 *   ALLOWED_ORIGINS        the origins for CORS, separated by commas (default the origin of APP_URL)
 *   SB_REGION              the region of the running function (Supabase injects it)
 *   MCP_FORWARD_REGION     the region of every MCP request (default eu-central-1)
 *   MADAR_LOCK_KEY         the office lock key (default 7310001; never HEALTH_LOCK_KEY)
 *   JOBS_SECRET            the secret of the job runner (x-madar-jobs-secret); it also opens the database check of GET /api/health
 */

export type ReadEnv = (name: string) => string | undefined;

export const DEFAULT_LOCK_KEY = 7_310_001;
/** The class of the health check lock (server/http/health.ts), in the two-key space. Never the office lock key. */
export const HEALTH_LOCK_KEY = 7_310_999;
const FUNCTION_REGION = 'eu-central-1';

export class MissingConfigError extends Error {
  constructor(readonly names: string[]) {
    super(`The server cannot start. Missing: ${names.join(', ')}.`);
    this.name = 'MissingConfigError';
  }
}

/** The full config with the values that only the ports need. */
export type ServerEnv = {
  config: Config;
  database: { writeUrl: string; readUrl: string; ca?: string };
  secretKey: string;
  jobsSecret?: string;
  mail: { driver: 'resend'; apiKey: string } | { driver: 'outbox' };
  files: { bucket: string; publicUrl?: string } | { r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string } };
};

/** The database hosts that may go without TLS: the Mac and the names inside the local Docker network. */
const LOCAL_DATABASE_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1', 'pooler', 'db', 'host.docker.internal']);

/** True only for a URL whose host is a local name. Any other host, or a URL that does not parse, needs the root certificate. */
function localDatabase(url: string): boolean {
  try {
    return LOCAL_DATABASE_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** The first key of SUPABASE_SECRET_KEYS (a JSON object of named keys), else MADAR_SECRET_KEY. */
function secretKeyOf(read: ReadEnv): string | undefined {
  const injected = read('SUPABASE_SECRET_KEYS');
  if (injected !== undefined) {
    try {
      const keys = JSON.parse(injected) as unknown;
      if (keys && typeof keys === 'object') {
        const first = Object.values(keys).find((v): v is string => typeof v === 'string' && v !== '');
        if (first) return first;
      }
    } catch {
      // Not JSON: the whole value is one key.
      return injected;
    }
  }
  return read('MADAR_SECRET_KEY');
}

/**
 * o.database: the database values from the caller, for example the finished connection string of the Hyperdrive binding
 * (server/entries/worker.ts). serverEnvFrom then neither reads nor checks DATABASE_URL, DATABASE_READ_URL and DATABASE_CA.
 */
export function serverEnvFrom(read: ReadEnv = env, o: { database?: ServerEnv['database'] } = {}): ServerEnv {
  const missing: string[] = [];
  const need = (name: string): string => {
    const value = read(name);
    if (value === undefined) missing.push(name);
    return value ?? '';
  };

  const writeUrl = o.database ? o.database.writeUrl : need('DATABASE_URL');
  const supabaseUrl = need('SUPABASE_URL');
  const secretKey = secretKeyOf(read);
  if (secretKey === undefined) missing.push('SUPABASE_SECRET_KEYS or MADAR_SECRET_KEY');
  const appUrl = need('APP_URL');
  const mailFrom = need('MAIL_FROM');

  const driver = read('MAIL_DRIVER') ?? 'resend';
  if (driver !== 'resend' && driver !== 'outbox') throw new Error('MAIL_DRIVER must be resend or outbox.');
  const apiKey = driver === 'resend' ? need('RESEND_API_KEY') : '';

  const readUrl = o.database ? o.database.readUrl : (read('DATABASE_READ_URL') ?? writeUrl);
  const ca = o.database ? o.database.ca : read('DATABASE_CA');
  if (!o.database && ca === undefined && writeUrl !== '' && !(localDatabase(writeUrl) && localDatabase(readUrl))) missing.push('DATABASE_CA');

  const fileStore = fileStoreKind(read('MADAR_FILE_STORE'));
  const r2 = fileStore === 'r2'
    ? { accountId: need('R2_ACCOUNT_ID'), accessKeyId: need('R2_ACCESS_KEY_ID'), secretAccessKey: need('R2_SECRET_ACCESS_KEY'), bucket: need('R2_BUCKET') }
    : undefined;

  if (missing.length > 0) throw new MissingConfigError(missing);

  for (const [name, url] of o.database ? [] : ([['DATABASE_URL', writeUrl], ['DATABASE_READ_URL', readUrl]] as const)) {
    if (/[?&](ssl\w*|uselibpqcompat)=/i.test(url)) throw new Error(`${name} must not carry a TLS setting such as ssl or sslmode: put the root certificate in DATABASE_CA (plan 4.5).`);
  }

  const lockText = read('MADAR_LOCK_KEY');
  const lockKey = lockText === undefined ? DEFAULT_LOCK_KEY : Number(lockText);
  if (!Number.isSafeInteger(lockKey)) throw new Error('MADAR_LOCK_KEY must be a whole number.');
  if (lockKey === HEALTH_LOCK_KEY) throw new Error('MADAR_LOCK_KEY must not be the health check key.');

  const functions = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1`;
  const origins = read('ALLOWED_ORIGINS');
  const config: Config = {
    lockKey,
    appUrl,
    apiUrl: read('API_URL') ?? `${functions}/api`,
    mcpUrl: read('MCP_URL') ?? `${functions}/mcp`,
    supabaseUrl,
    mailFrom,
    minClientBuild: read('MIN_CLIENT_BUILD') ?? '0',
    allowedOrigins: origins ? origins.split(',').map((o) => o.trim()).filter(Boolean) : [new URL(appUrl).origin],
    region: read('SB_REGION') ?? 'unknown',
    forwardRegion: read('MCP_FORWARD_REGION') ?? FUNCTION_REGION,
    fileStore,
    limits: { maxFileBytes: FILE_STORE_LIMITS[fileStore].maxFileBytes, filesTotalBytes: FILE_STORE_LIMITS[fileStore].totalBytes },
  };

  const jobsSecret = read('JOBS_SECRET');
  return {
    config,
    database: ca === undefined ? { writeUrl, readUrl } : { writeUrl, readUrl, ca },
    secretKey: secretKey as string,
    ...(jobsSecret === undefined ? {} : { jobsSecret }),
    mail: driver === 'resend' ? { driver, apiKey } : { driver },
    files: r2 ? { r2 } : { bucket: read('FILES_BUCKET') ?? 'madar-files', ...(read('FILES_PUBLIC_URL') ? { publicUrl: read('FILES_PUBLIC_URL') } : {}) },
  };
}

export function configFromEnv(read: ReadEnv = env): Config {
  return serverEnvFrom(read).config;
}

/** One JSON line for each message, so the function logs stay searchable. */
export function consoleLogger(): Logger {
  const line = (level: 'info' | 'warn' | 'error', out: (text: string) => void) => (message: string, fields?: LogFields) =>
    out(JSON.stringify({ level, message, ...fields }));
  return { info: line('info', (t) => console.log(t)), warn: line('warn', (t) => console.warn(t)), error: line('error', (t) => console.error(t)) };
}

export function buildDeps(read: ReadEnv = env): Deps {
  return depsFrom(serverEnvFrom(read));
}

/**
 * The ports of read values. The entries keep the values too, for the health check. o.db replaces the pools of the isolate:
 * the Workers entry passes a Db that opens its connections for each request (server/entries/requestDb.ts).
 */
export function depsFrom(values: ServerEnv, o: { db?: Db } = {}): Deps {
  const { config } = values;
  const db = o.db ?? pgDb(values.database);
  const log = consoleLogger();
  const meter = meterPort();
  return {
    db,
    clock: { now: () => new Date() },
    files: 'r2' in values.files
      ? r2FilesPort(values.files.r2)
      : supabaseStorageFilesPort({ supabaseUrl: config.supabaseUrl, publicUrl: values.files.publicUrl, secretKey: values.secretKey, bucket: values.files.bucket }),
    mail: values.mail.driver === 'resend' ? resendMailPort({ apiKey: values.mail.apiKey, from: config.mailFrom }) : outboxMailPort(db),
    signal: realtimeSender({ log, meter }),
    authAdmin: authAdminPort({ supabaseUrl: config.supabaseUrl, secretKey: values.secretKey }),
    meter,
    config,
    log,
  };
}
