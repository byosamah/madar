import type { JSONWebKeySet } from 'jose';
import { ApiError, invalid } from '../../../src/api/errors';
import { errorResponse, runErrorOf } from '../../http/errors';
import { readBody } from '../../http/limits';
import { ROUTES, type RouteDef } from '../../http/routes';
import { APPROVE_PATH, withApproveRoute } from '../../mcp/approval';
import { clientAddress } from '../forgot';
import { verifyBrowserToken, type TokenChecker } from '../verify';
import type { OpResult, SigninOffice } from './office';

/**
 * The HTTP routes of the own sign-in in the api app (Supabase exit, wave 2), at /api/auth/*. The Worker does the HTTP part only:
 * the body, the client address (clientAddress: x-madar-client-address on the Worker host) and the browser token check; the step
 * runs in the office object through SigninOffice. The hosts pass these routes in (AppOptions.routes): no Supabase entry loads them.
 */

export type OwnRouteOptions = { jwks: JSONWebKeySet; checkToken?: TokenChecker };
const NO_STORE = { 'Cache-Control': 'no-store' };

export function answer<T>(result: OpResult<T>, status = 200): Response {
  if (result.ok) return Response.json(result.value, { status, headers: NO_STORE });
  if ('oauth' in result) return Response.json({ error: result.oauth.error, error_description: result.oauth.error_description }, { status: result.oauth.status, headers: NO_STORE });
  return errorResponse(result.error, NO_STORE);
}

export async function jsonOf(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readBody(request)) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const idOf = (request: Request): string => decodeURIComponent(/\/oauth\/authorizations\/([^/]+)/.exec(new URL(request.url).pathname)?.[1] ?? '');

/** A route for a signed-in person: the browser token check first (an agent token gets 403 agent_token), then the work. */
export function signedIn(check: TokenChecker, work: (request: Request, who: { authId: string; sessionId: string }) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      const { authUserId, sessionId } = await check(request.headers.get('Authorization'));
      if (sessionId === undefined) throw new ApiError('unauthenticated', 'Sign in to continue.', { reason: 'session_ended' });
      return await work(request, { authId: authUserId, sessionId });
    } catch (error) {
      return errorResponse(runErrorOf(error), NO_STORE);
    }
  };
}

export function ownAuthRoutes(office: SigninOffice, o: OwnRouteOptions): RouteDef[] {
  const check = o.checkToken ?? verifyBrowserToken;
  return [
    {
      method: 'POST', path: '/auth/token', handler: async (request) => {
        const body = await jsonOf(request);
        if (body.grant_type === 'password') return answer(await office.run('auth.password', { email: text(body.email), password: text(body.password), address: clientAddress(request) }));
        if (body.grant_type === 'refresh_token') return answer(await office.run('auth.refresh', { refreshToken: text(body.refresh_token) }));
        return errorResponse(runErrorOf(invalid('grant_type', 'Send grant_type password or refresh_token.')), NO_STORE);
      },
    },
    {
      method: 'POST', path: '/auth/verify', handler: async (request) => {
        const body = await jsonOf(request);
        const type = body.type === 'invite' || body.type === 'recovery' ? body.type : undefined;
        if (type === undefined || text(body.token_hash) === '') return errorResponse(runErrorOf(invalid('token_hash', 'Open the link of your email again.', 'link_ended')), NO_STORE);
        return answer(await office.run('auth.verify', { token: text(body.token_hash), type, address: clientAddress(request) }));
      },
    },
    {
      method: 'POST', path: '/auth/password', handler: signedIn(check, async (request, who) => {
        const body = await jsonOf(request);
        return answer(await office.run('auth.setPassword', { ...who, password: text(body.password), ...(typeof body.current === 'string' ? { current: body.current } : {}) }));
      }),
    },
    {
      method: 'POST', path: '/auth/logout', handler: signedIn(check, async (request, who) => {
        const body = await jsonOf(request);
        return answer(await office.run('auth.logout', { ...who, scope: body.scope === 'others' ? 'others' : 'local' }));
      }),
    },
    { method: 'GET', path: '/auth/jwks', handler: async () => Response.json(o.jwks, { headers: { 'Cache-Control': 'public, max-age=600' } }) },
    {
      method: 'GET', path: '/oauth/authorizations/:id', handler: signedIn(check, async (request, who) => answer(await office.run('oauth.details', { authId: who.authId, id: idOf(request) }))),
    },
    {
      method: 'POST', path: '/oauth/authorizations/:id/consent', handler: signedIn(check, async (request, who) => {
        const body = await jsonOf(request);
        return answer(await office.run('oauth.consent', { authId: who.authId, id: idOf(request), action: body.action === 'approve' ? 'approve' : 'deny' }));
      }),
    },
    {
      method: 'POST', path: APPROVE_PATH, handler: signedIn(check, async (request, who) => {
        const body = await jsonOf(request);
        return answer(await office.run('oauth.approve', { authId: who.authId, id: text(body.authorizationId) }));
      }),
    },
    { method: 'POST', path: '/oauth/grants', handler: signedIn(check, async (_request, who) => answer(await office.run('oauth.grants', { authId: who.authId }))) },
    {
      method: 'POST', path: '/oauth/grants/revoke', handler: signedIn(check, async (request, who) => {
        const body = await jsonOf(request);
        return answer(await office.run('oauth.revoke', { authId: who.authId, clientId: text(body.client_id) }));
      }),
    },
  ];
}

/** The routes of the api app of the own stack: the routes of today, with the own approve route in place of the Supabase one. */
export function ownApiRoutes(office: SigninOffice, o: OwnRouteOptions): RouteDef[] {
  const own = ownAuthRoutes(office, o);
  const approve = own.find((route) => route.path === APPROVE_PATH)!;
  return [...withApproveRoute(ROUTES, approve), ...own.filter((route) => route !== approve)];
}
