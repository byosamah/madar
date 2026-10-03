import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { sharedCalls } from '../../src/api/sharedCalls';
import type { Logger } from '../core/ports';

/**
 * GET /api/health (plan, task E1): one read-only transaction on the database that holds an advisory lock, on every host.
 * It proves at each call what the server relies on: pg works on the host, a transaction lock holds through the transaction
 * pooler, AsyncLocalStorage keeps its context across the database awaits, and the shared calls loaded. It names SB_REGION.
 * It opens one connection of its own for each call and closes it, so it never holds a connection of the app's pools.
 */

/** Never the office lock key, so a health check never waits behind a write and a write never waits behind it. */
export const HEALTH_LOCK_KEY = 7_310_999;

export type HealthClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
};

type Check = 'ok' | 'failed';
export type HealthBody = { ok: boolean; region: string; calls: number; checks: { database: Check; lock: Check; asyncContext: Check } };

const context = new AsyncLocalStorage<string>();

export async function checkHealth(o: { connect: () => Promise<HealthClient>; region: string; log?: Logger }): Promise<{ status: number; body: HealthBody }> {
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
      await client.query('select pg_advisory_xact_lock($1)', [HEALTH_LOCK_KEY]);
      const { rows } = await client.query(
        "select count(*)::int as held from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted and objid = $1",
        [HEALTH_LOCK_KEY],
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
  return { status: ok ? 200 : 503, body: { ok, region: o.region, calls: Object.keys(sharedCalls).length, checks } };
}

/** One pg client for one health check. ca: the Supabase root certificate; without it the connection uses no TLS (the local stack). */
export function pgHealthClient(url: string, ca?: string): () => Promise<HealthClient> {
  return async () => {
    const client = new pg.Client({ connectionString: url, ssl: ca ? { ca, rejectUnauthorized: true } : undefined, connectionTimeoutMillis: 5000 });
    await client.connect();
    return client;
  };
}
