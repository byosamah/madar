import { depsFrom, serverEnvFrom, type ServerEnv } from '../core/deps';
import { pgDb, type DatabaseConfig } from '../data/sql';
import { env, setEnvSource } from '../env';
import { apiMount } from './api';
import { hostOf, type AppMount } from './apps';
import { jobsMount } from './jobs';
import { mcpMount } from './mcp';
import { closeAfter, requestScopedDb, type RequestDb } from './requestDb';
import { lazyStart } from './start';

/**
 * The Cloudflare Workers entry, the fallback host (plan 2b, point 2): /api, /mcp and /jobs from the same source as the Supabase
 * functions, built to dist-server/worker.js and run by wrangler.server.toml. A Worker gets its values with each request, so the
 * entry hands them to env() before the app starts.
 *
 * The values and the apps are read and built once for each isolate. The database is not: each request opens its own Db and
 * closes it after the answer (server/entries/requestDb.ts, proof.md E4), because Workers ties a socket to one request.
 *
 * The database comes from the Hyperdrive binding DB (proof.md, Z0a item 7): the Workers socket trusts only public roots and
 * ignores a CA, and the Supabase pooler certificate chains to a private root. Hyperdrive makes the TLS connection with that root
 * (verify-full) and gives the Worker a finished connection string, which pgDb uses as it is. Without the binding the entry uses
 * DATABASE_URL, which works only for a local pooler without TLS.
 */

type Context = { waitUntil(work: Promise<unknown>): void };
export type WorkerOptions = {
  /** The Db of one request. The default is pgDb, whose pools open on the first query and end with close() (track C1). */
  openDb?: (database: DatabaseConfig) => RequestDb;
  mounts?: AppMount[];
};

/** The connection string of the Hyperdrive binding DB, when the Worker has one. */
export function hyperdriveOf(bindings: Record<string, unknown>): string | undefined {
  const binding = bindings.DB as { connectionString?: unknown } | undefined;
  return typeof binding?.connectionString === 'string' && binding.connectionString !== '' ? binding.connectionString : undefined;
}

/**
 * The values of the Worker. With the binding, the apps (and the health route) connect through Hyperdrive too, and serverEnvFrom
 * takes the binding's connection string in place of DATABASE_URL, so it neither reads nor checks the database values.
 */
function workerValues(hyperdrive: string | undefined): ServerEnv {
  return serverEnvFrom(env, hyperdrive === undefined ? {} : { database: { writeUrl: hyperdrive, readUrl: hyperdrive } });
}

export function workerEntry(o: WorkerOptions = {}) {
  const openDb = o.openDb ?? ((database: DatabaseConfig): RequestDb => pgDb(database));
  const scope = requestScopedDb();
  let bindings: Record<string, unknown> = {};
  const start = lazyStart('worker', () => {
    const hyperdrive = hyperdriveOf(bindings);
    const values = workerValues(hyperdrive);
    const database: DatabaseConfig = hyperdrive === undefined ? values.database : { connectionString: hyperdrive };
    const deps = depsFrom(values, { db: scope.db });
    const host = hostOf(o.mounts ?? [apiMount, mcpMount, jobsMount], deps, values);
    return {
      region: values.config.region,
      fetch: async (request, after) => {
        const db = openDb(database);
        const close = async () => {
          await db.close?.().catch((error: unknown) => deps.log.warn('The request database did not close.', { error: error instanceof Error ? error.message : String(error) }));
        };
        let response: Response;
        try {
          response = await scope.run(db, () => host.fetch(request));
        } catch (error) {
          const closing = close();
          after?.(closing);
          throw error;
        }
        return closeAfter(response, close, after);
      },
    };
  });
  return {
    async fetch(request: Request, env: Record<string, unknown>, ctx?: Context): Promise<Response> {
      setEnvSource(env);
      bindings = env;
      return start(request, ctx ? (work) => ctx.waitUntil(work) : undefined);
    },
  };
}

export default workerEntry();
