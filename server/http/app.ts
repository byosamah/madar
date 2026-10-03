import { Hono } from 'hono';
import { ApiError } from '../../src/api/errors';
import { principalOf } from '../auth/principal';
import { verifyBrowserToken } from '../auth/verify';
import type { Deps } from '../core/ports';
import { runCall } from '../core/runCall';
import { readOffice } from '../data/officeCache';
import { handleBatch, type BatchOptions } from './batch';
import { cors } from './cors';
import { errorResponse, runErrorOf } from './errors';
import { ROUTES, type RouteDef } from './routes';

/**
 * The api app (plan 4.10, task E3), the same on every host. The entries mount it at /api: Supabase passes the path with the
 * function name first, and the Workers entry mounts it under /api too. Paths here are relative: POST /batch, GET /health,
 * and every route of server/http/routes.ts. The defaults are the real parts (T0 stubs until their tracks merge); tests pass fakes.
 */

export type HealthCheck = (request: Request) => Promise<{ status: number; body: unknown }>;
export type AppOptions = Partial<BatchOptions> & { routes?: RouteDef[]; health?: HealthCheck };

export function apiApp(deps: Deps, o: AppOptions = {}): Hono {
  const batch: BatchOptions = {
    runCall: o.runCall ?? runCall,
    verifyToken: o.verifyToken ?? verifyBrowserToken,
    principalOf: o.principalOf ?? principalOf,
    readOffice: o.readOffice ?? ((d) => readOffice(d)),
  };
  const app = new Hono();
  app.use('*', cors(() => deps.config.allowedOrigins));
  if (o.health) {
    const health = o.health;
    app.get('/health', async (c) => {
      const result = await health(c.req.raw);
      return Response.json(result.body, { status: result.status });
    });
  }
  app.post('/batch', (c) => handleBatch(c.req.raw, deps, batch));
  for (const route of o.routes ?? ROUTES) app.on(route.method, route.path, (c) => route.handler(c.req.raw, deps));
  app.notFound(() => errorResponse({ code: 'not_found', message: 'This address does not exist.' }));
  app.onError((error) => {
    if (!(error instanceof ApiError)) deps.log.error('A route failed.', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse(runErrorOf(error));
  });
  return app;
}
