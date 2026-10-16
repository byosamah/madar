// Shared helpers of the Hyperdrive probe on madar-test (proof.md, "Hyperdrive probe on madar-test (2026-10-16)").
// The Mac scripts (setup.ts, run.ts) and the probe Worker (probe.ts) import this file. It has no Node or Workers import,
// so it runs on both. It refuses the production project in every URL.

export const TEST_REF = 'qdgwpnesxppnqsaabqzd';
export const PRODUCTION_REF = 'oprkvdjudjxxhvodkzgs';
export const POOLER_HOST = 'aws-1-eu-central-1.pooler.supabase.com';
export const ACCOUNT_ID = 'd76d34779c63849f5acdf3d6af3751cd';
export const CA_NAME = 'supabase-root-2021-ca';

/** The two Hyperdrive configs of the probe: the session pooler and the transaction pooler of madar-test. */
export const CONFIGS = [
  { name: 'madar-db-test', port: 5432, binding: 'DB_SESSION' },
  { name: 'madar-db-test-tx', port: 6543, binding: 'DB_TX' },
] as const;

/**
 * The soft limit of origin connections for each config. Hyperdrive allows 5 at the least. The probe keeps it low because
 * madar-test is on the Free plan and the live test server uses the same pooler and the same role.
 */
export const ORIGIN_CONNECTION_LIMIT = 5;

export type Origin = { scheme: 'postgres'; host: string; port: number; user: string; password: string; database: string };
export type SslMode = 'verify-full' | 'require';

/** The origin of one config from DATABASE_URL of secrets/test.env, with the port of that config. Error texts hold no value. */
export function originOf(databaseUrl: string, port: number): Origin {
  if (databaseUrl.includes(PRODUCTION_REF)) throw new Error('DATABASE_URL names the production project: the probe runs on madar-test only.');
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL does not parse.');
  }
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (user !== `madar_server.${TEST_REF}`) throw new Error('DATABASE_URL has another user than madar_server of madar-test.');
  if (url.hostname !== POOLER_HOST) throw new Error('DATABASE_URL has another host than the shared pooler of madar-test.');
  if (url.pathname !== '/postgres') throw new Error('DATABASE_URL has another database than postgres.');
  if (password === '') throw new Error('DATABASE_URL has no password.');
  return { scheme: 'postgres', host: url.hostname, port, user, password, database: 'postgres' };
}

/** The body of POST /accounts/<id>/hyperdrive/configs. The API refuses a CA with sslmode require. */
export function configBody(name: string, origin: Origin, caId: string, sslmode: SslMode = 'verify-full') {
  return {
    name,
    origin,
    caching: { disabled: true as const },
    mtls: sslmode === 'require' ? { sslmode } : { ca_certificate_id: caId, sslmode },
    origin_connection_limit: ORIGIN_CONNECTION_LIMIT,
  };
}

type ApiConfig = {
  id?: string;
  name?: string;
  origin?: { host?: string; port?: number; user?: string; database?: string; password?: string; scheme?: string };
  caching?: { disabled?: boolean };
  mtls?: { ca_certificate_id?: string; sslmode?: string };
  origin_connection_limit?: number;
};

/** The parts of a config that the probe prints. Never the password (the API does not return it, and this drops it too). */
export function summary(config: ApiConfig) {
  return {
    id: config.id,
    name: config.name,
    host: config.origin?.host,
    port: config.origin?.port,
    user: config.origin?.user,
    database: config.origin?.database,
    cachingDisabled: config.caching?.disabled === true,
    sslmode: config.mtls?.sslmode,
    caId: config.mtls?.ca_certificate_id,
    originConnectionLimit: config.origin_connection_limit,
  };
}

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** A compare of two secrets that reads every character, so the time does not show where they differ. */
export function sameSecret(given: string | null, expected: string): boolean {
  if (given === null || expected === '' || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** One value of an env file (NAME=value, NAME="value" or NAME='value'). Comment lines do not count. */
export function envValue(text: string, name: string): string | undefined {
  for (const line of text.split('\n')) {
    if (!line.startsWith(`${name}=`)) continue;
    return line.slice(name.length + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return undefined;
}

/** The text with each secret, and its URL-encoded form, replaced. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets.filter((s) => s.length > 0)) {
    for (const form of new Set([secret, encodeURIComponent(secret)])) out = out.split(form).join('[redacted]');
  }
  return out;
}
