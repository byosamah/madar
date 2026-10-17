import { verifyBrowserToken } from '../auth/verify';
import { depsFrom, serverEnvFrom } from '../core/deps';
import { env as readEnv, setEnvSource } from '../env';
import { refusingDb } from '../office/refusingDb';
import { WorkerNet } from '../office/workerNet';
import { officeRoutes, type OfficeStub } from './officeWorker';
import { withServerHeader, workersServer } from './serverHeader';

/**
 * The office path of the Worker (exit wave 3): the routes of server/entries/officeWorker.ts with the real token check, the
 * office object of the binding OFFICE, and a WorkerNet on the file and mail ports of the Worker. workerd only (WorkerNet).
 */

type Env = Record<string, unknown>;
type Ctx = { waitUntil(work: Promise<unknown>): void };
type Namespace = { idFromName(name: string): unknown; get(id: unknown): unknown };

/** The name of the one office object of a copy. */
export const OFFICE_NAME = 'office';

/**
 * True when this Worker serves its copy from the office object: the binding OFFICE and the var MADAR_DATA = "office". No env of
 * wrangler.server.toml sets the var in wave 3, so every deployed Worker keeps today's Postgres path.
 */
export function onOffice(env: Env): boolean {
  const namespace = env.OFFICE as Partial<Namespace> | undefined;
  return env.MADAR_DATA === 'office' && typeof namespace?.idFromName === 'function' && typeof namespace.get === 'function';
}

export function officeEntry() {
  let routes: ReturnType<typeof officeRoutes> | undefined;
  const start = () => {
    if (routes) return routes;
    const values = serverEnvFrom(readEnv, { database: { writeUrl: '', readUrl: '' } });
    const deps = depsFrom(values, { db: refusingDb });
    routes = officeRoutes({
      deps,
      verifyToken: verifyBrowserToken,
      stub: (env) => {
        const namespace = env.OFFICE as Namespace;
        return namespace.get(namespace.idFromName(OFFICE_NAME)) as OfficeStub;
      },
      net: () => new WorkerNet({ files: deps.files, mail: deps.mail }),
      jobsSecret: () => values.jobsSecret,
    });
    return routes;
  };
  return {
    async fetch(request: Request, env: Env, ctx?: Ctx): Promise<Response> {
      setEnvSource(env);
      const response = await start().fetch(request, env, ctx);
      // A 101 answer carries the socket: a copy with one more header would lose it.
      return response.status === 101 ? response : withServerHeader(response, workersServer(request).replace(/^workers/, 'office'));
    },
    /** One Cron run of the office path (server/entries/workerMain.ts calls it only when onOffice is true). */
    async scheduled(at: Date, env: Env): Promise<void> {
      setEnvSource(env);
      await start().scheduled(at, env);
    },
  };
}
