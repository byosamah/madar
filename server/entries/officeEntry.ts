import { OWN_AUTH_SECRET, ownPublicJwks } from '../auth/ownKeys';
import { verifyBrowserToken } from '../auth/verify';
import { depsFrom, serverEnvFrom } from '../core/deps';
import { env as readEnv, setEnvSource } from '../env';
import { refusingDb } from '../office/refusingDb';
import { WorkerNet } from '../office/workerNet';
import { officeSigninRoutes } from './officeSignin';
import { directoryOf } from '../enterprise/directory';
import { PLATFORM_OBJECT } from '../enterprise/ids';
import type { PlatformStub } from '../enterprise/platform/stub';
import { OFFICE_NAME, officeRoutes, type OfficeRoute, type OfficeStub } from './officeWorker';
import { withServerHeader, workersServer } from './serverHeader';

/**
 * The office path of the Worker (exit wave 3): the routes of server/entries/officeWorker.ts with the real token check, the
 * office object of the binding OFFICE, and a WorkerNet on the file and mail ports of the Worker. With MADAR_AUTH_PRIVATE_JWK it
 * also serves the own sign-in under /api (server/entries/officeSignin.ts, exit waves 2 and 3). workerd only (WorkerNet).
 */

type Env = Record<string, unknown>;
type Ctx = { waitUntil(work: Promise<unknown>): void };
type Namespace = { idFromName(name: string): unknown; get(id: unknown): unknown };

export { OFFICE_NAME };

/**
 * True when this Worker serves its copy from the office object: the binding OFFICE and the var MADAR_DATA = "office". No env of
 * wrangler.server.toml sets the var in wave 3, so every deployed Worker keeps today's Postgres path.
 */
export function onOffice(env: Env): boolean {
  const namespace = env.OFFICE as Partial<Namespace> | undefined;
  return env.MADAR_DATA === 'office' && typeof namespace?.idFromName === 'function' && typeof namespace.get === 'function';
}

/**
 * The office object of an enterprise: its name is the enterprise id (Madar enterprises). The Worker reaches it through the router
 * (server/enterprise/router.ts), which makes sure that an untrusted id is listed by the platform object first. The ops use a name
 * (stubOf) for the spare objects of a rehearsal.
 */
export function stubFor(env: Env, name: string): OfficeStub {
  const namespace = env.OFFICE as Namespace;
  return namespace.get(namespace.idFromName(name)) as OfficeStub;
}

/** The one platform object. */
export function platformStub(env: Env): PlatformStub {
  const namespace = env.PLATFORM as Namespace | undefined;
  if (!namespace) throw new Error('The Worker has no binding PLATFORM. Add it to this env of wrangler.server.toml.');
  return namespace.get(namespace.idFromName(PLATFORM_OBJECT)) as PlatformStub;
}

export function officeEntry() {
  let routes: ReturnType<typeof officeRoutes> | undefined;
  const start = () => {
    if (routes) return routes;
    const values = serverEnvFrom(readEnv, { database: { writeUrl: '', readUrl: '' } });
    const deps = depsFrom(values, { db: refusingDb });
    // The own sign-in (exit waves 2 and 3) needs the key MADAR_AUTH_PRIVATE_JWK. With no key, /api/auth/* answers not_found.
    let own: OfficeRoute[] | undefined;
    const secret = readEnv(OWN_AUTH_SECRET);
    if (secret !== undefined) {
      try {
        own = officeSigninRoutes({ jwks: ownPublicJwks(secret), deps });
      } catch (error) {
        deps.log.error('The own sign-in routes are off: the key did not load.', { error: error instanceof Error ? error.message : String(error) });
      }
    }
    routes = officeRoutes({
      deps,
      verifyToken: verifyBrowserToken,
      stubFor,
      platform: platformStub,
      // The port works for one enterprise: the file folder (plan D) and the email directory (plan C) of the request.
      net: (env, ent) => new WorkerNet({
        ent, files: deps.files, mail: deps.mail, ...(deps.config.daftra ? { daftra: deps.config.daftra } : {}),
        directory: directoryOf(platformStub(env), ent), platform: platformStub(env),
      }),
      jobsSecret: () => values.jobsSecret,
      exportSecret: () => readEnv('MADAR_EXPORT_SECRET'),
      opsSecret: () => readEnv('MADAR_OPS_SECRET'),
      ...(own ? { routes: own } : {}),
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
