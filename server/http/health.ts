import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { sharedCalls } from '../../src/api/sharedCalls';
import { HEALTH_LOCK_KEY } from '../core/deps';
import type { Logger } from '../core/ports';

/**
 * GET /api/health (plan, task E1), on every host.
 *
 * Without a secret it answers from memory: the region, the host and the file store (owner, 2026-10-16), and the count of the
 * shared calls. A caller who is not signed in can
 * never start database work here, so a flood of health calls never holds a connection of the pooler (review of E).
 *
 * With the jobs secret in x-madar-jobs-secret it also runs one read-only transaction that holds an advisory lock. That check
 * proves what the server relies on: pg works on the host, a transaction lock holds through the transaction pooler,
 * AsyncLocalStorage keeps its context across the database awaits, and the shared calls loaded. It opens one connection of its
 * own for each call and closes it, so it never holds a connection of the app's pools.
 */

export { HEALTH_LOCK_KEY };
export const HEALTH_SECRET_HEADER = 'x-madar-jobs-secret';

export type HealthClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
};

type Check = 'ok' | 'failed';
/** host: the host that answers (workers or supabase); fileStore: supabase or r2 (owner, 2026-10-16). Neither is a secret. */
export type HealthIdentity = { host?: string; fileStore?: string };
export type HealthBody = { ok: boolean; region: string; calls: number; checks: { database: Check; lock: Check; asyncContext: Check } } & HealthIdentity;
export type HealthOptions = { connect: () => Promise<HealthClient>; region: string; log?: Logger } & HealthIdentity;

/** The host and the file store of the options, when the caller gave them. */
function identityOf(o: HealthIdentity): HealthIdentity {
  return { ...(o.host === undefined ? {} : { host: o.host }), ...(o.fileStore === undefined ? {} : { fileStore: o.fileStore }) };
}

const context = new AsyncLocalStorage<string>();

/** A new key for each check, so two checks never wait on each other. 31 bits, so it fits int4 and the oid of pg_locks. */
function lockKeyOfCheck(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
}

export async function checkHealth(o: HealthOptions): Promise<{ status: number; body: HealthBody }> {
  const id = crypto.randomUUID();
  const checks: HealthBody['checks'] = { database: 'failed', lock: 'failed', asyncContext: 'failed' };
  await context.run(id, async () => {
    let client: HealthClient | undefined;
    let open = false;
    try {
      client = await o.connect();
      await client.query('begin isolation level repeatable read, read only');
      open = true;
      await client.query("set local statement_timeout = '5s'");
      // The two-key form: its keys never meet the one-key office lock (pg_locks objsubid 2, the office lock has 1).
      const key = [HEALTH_LOCK_KEY, lockKeyOfCheck()];
      await client.query('select pg_advisory_xact_lock($1::int4, $2::int4)', key);
      const { rows } = await client.query(
        "select count(*)::int as held from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted and classid = $1 and objid = $2 and objsubid = 2",
        key,
      );
      await client.query('commit');
      open = false;
      checks.database = 'ok';
      checks.lock = Number(rows[0]?.held) === 1 ? 'ok' : 'failed';
      checks.asyncContext = context.getStore() === id ? 'ok' : 'failed';
    } catch (error) {
      // The database error goes to the log only: the health route is public.
      o.log?.error('The health check failed.', { error: error instanceof Error ? error.message : String(error) });
      if (open) await client?.query('rollback').catch(() => undefined);
    } finally {
      await client?.end().catch(() => undefined);
    }
  });
  const ok = checks.database === 'ok' && checks.lock === 'ok' && checks.asyncContext === 'ok';
  return { status: ok ? 200 : 503, body: { ok, region: o.region, ...identityOf(o), calls: Object.keys(sharedCalls).length, checks } };
}

/** Compares two secrets in constant time: both go through SHA-256 first, so the length of the secret does not show either. */
async function sameSecret(given: string, secret: string): Promise<boolean> {
  const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const [a, b] = await Promise.all([digest(given), digest(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** The answer of GET /api/health. secret: JOBS_SECRET; without it, no caller can start the database check. */
export async function healthAnswer(request: Request, o: HealthOptions & { secret?: string }): Promise<{ status: number; body: unknown }> {
  const given = request.headers.get(HEALTH_SECRET_HEADER);
  if (given === null) return { status: 200, body: { ok: true, region: o.region, ...identityOf(o), calls: Object.keys(sharedCalls).length } };
  if (o.secret === undefined || !(await sameSecret(given, o.secret))) {
    return { status: 401, body: { v: 1, error: { code: 'unauthenticated', message: 'The health secret is not right.' } } };
  }
  return checkHealth(o);
}

/** One pg client for one health check. ca: the root certificate; without it the connection uses no TLS (only a local host). */
export function pgHealthClient(url: string, ca?: string): () => Promise<HealthClient> {
  return async () => {
    const client = new pg.Client({ connectionString: url, ssl: ca ? { ca, rejectUnauthorized: true } : undefined, connectionTimeoutMillis: 5000 });
    await client.connect();
    return client;
  };
}
