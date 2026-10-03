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

export const startApi = (): Started => startApps([apiMount]);
