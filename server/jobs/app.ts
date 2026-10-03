import { Hono } from 'hono';
import { notBuiltResponse } from '../core/notBuilt';
import type { Deps } from '../core/ports';

/** POST /jobs/run: the 15-minute job (plan 5.5). The entries mount it at /jobs. Until track N3 builds it, every request gets 501. */
export function jobsApp(_deps: Deps): Hono {
  const app = new Hono();
  app.all('*', () => notBuiltResponse('The job runner'));
  return app;
}
