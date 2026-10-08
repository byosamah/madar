import { warmKeySet } from '../auth/verify';
import type { Deps } from '../core/ports';
import { apiApp } from '../http/app';
import { healthAnswer, pgHealthClient } from '../http/health';
import { startApps, type AppMount } from './apps';
import type { Started } from './start';

/** The api app at /api: POST /batch, GET /health and the routes of server/http/routes.ts. */
export const apiMount: AppMount = {
  name: 'api',
  app: (deps, values) =>
    apiApp(deps, {
      health: (request) =>
        healthAnswer(request, {
          connect: pgHealthClient(values.database.writeUrl, values.database.ca),
          region: values.config.region,
          log: deps.log,
          secret: values.jobsSecret,
        }),
    }),
};

/**
 * The warm-up of a new api worker (performance audit LIV-7): the load of the key set and the connect of the read pool, both
 * started and not awaited, so they overlap with the first request. No office read: a request with no good token still causes no
 * database read (a connect reads nothing).
 */
export function warmApi(deps: Deps): void {
  warmKeySet();
  void deps.db.warm?.('read').catch(() => undefined);
}

export const startApi = (): Started => startApps([apiMount], { warm: warmApi });
