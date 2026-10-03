import { depsFrom, serverEnvFrom, type ServerEnv } from '../core/deps';
import { pgDb } from '../data/sql';
import { setEnvSource } from '../env';
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
 */

type Context = { waitUntil(work: Promise<unknown>): void };
export type WorkerOptions = {
  /** The Db of one request. The default is pgDb, whose pools open on the first query and end with close() (track C1). */
  openDb?: (database: ServerEnv['database']) => RequestDb;
  mounts?: AppMount[];
};

export function workerEntry(o: WorkerOptions = {}) {
  const openDb = o.openDb ?? ((database: ServerEnv['database']): RequestDb => pgDb(database));
  const scope = requestScopedDb();
  const start = lazyStart('worker', () => {
    const values = serverEnvFrom();
    const deps = depsFrom(values, { db: scope.db });
    const host = hostOf(o.mounts ?? [apiMount, mcpMount, jobsMount], deps, values);
    return {
      region: values.config.region,
      fetch: async (request, after) => {
        const db = openDb(values.database);
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
      return start(request, ctx ? (work) => ctx.waitUntil(work) : undefined);
    },
  };
}

export default workerEntry();
