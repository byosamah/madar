import { FORGOT_PATH, forgotRoute } from '../auth/forgot';
import { RENEW_PATH, renewRoute } from '../auth/renew';
import type { Deps } from '../core/ports';
import { APPROVE_ROUTE } from '../mcp/approval';

/**
 * The extra HTTP routes of the api function, beside POST /batch (plan 4.10). The app of track E mounts each route.
 * The path is relative to the api app, so POST /auth/forgot answers at /api/auth/forgot (Workers) and /functions/v1/api/auth/forgot (Supabase).
 */
export type RouteDef = { method: 'GET' | 'POST'; path: string; handler: (request: Request, deps: Deps) => Promise<Response> };

export const ROUTES: RouteDef[] = [
  { method: 'POST', path: FORGOT_PATH, handler: forgotRoute },
  { method: 'POST', path: RENEW_PATH, handler: renewRoute },
  APPROVE_ROUTE,
];
