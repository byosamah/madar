import { ApiError, invalid } from '../../../src/api/errors';
import { clientAddress } from '../../auth/forgot';
import type { PlatformTokenChecker } from '../../auth/verify';
import type { Deps } from '../../core/ports';
import { runErrorOf } from '../../http/errors';
import { readBody } from '../../http/limits';
import { NO_STORE, platformErrorResponse } from './answer';
import type { PlatformStub } from './stub';

/**
 * The sign-in routes of the platform (Madar enterprises, plan F, design D8). The Worker does the HTTP part: the body, the network address
 * and the token check; the work runs in the platform object. They belong to the office path only, so the Postgres path answers 404.
 *
 * POST /api/platform/auth/token  { grant_type: 'password', email, password } or { grant_type: 'refresh_token', refresh_token }
 * POST /api/platform/auth/logout with the platform access token: 204.
 *
 * A refusal has the usual body { v: 1, error: { code, message, details: { reason } } } and always the status 401 (a limit: 429 with Retry-After).
 */

type Env = Record<string, unknown>;

export type PlatformAuthOptions = {
  deps: Pick<Deps, 'config' | 'clock' | 'log'>;
  platform: (env: Env) => PlatformStub;
  verifyToken: PlatformTokenChecker;
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

async function jsonOf(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readBody(request)) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function platformAuth(o: PlatformAuthOptions) {
  const { log } = o.deps;
  const fail = (error: unknown): Response => {
    if (!(error instanceof ApiError)) log.error('A platform sign-in route failed.', { error: error instanceof Error ? error.message : String(error) });
    return platformErrorResponse(runErrorOf(error));
  };

  return {
    async token(request: Request, env: Env): Promise<Response> {
      try {
        if (request.method !== 'POST') throw new ApiError('not_found', 'This address does not exist.');
        const body = await jsonOf(request);
        const platform = o.platform(env);
        if (body.grant_type === 'password') {
          return Response.json(await platform.platformSignIn({ email: text(body.email), password: text(body.password), address: clientAddress(request) }), { headers: NO_STORE });
        }
        if (body.grant_type === 'refresh_token') {
          return Response.json(await platform.platformRefresh({ refreshToken: text(body.refresh_token) }), { headers: NO_STORE });
        }
        throw invalid('grant_type', 'Send grant_type password or refresh_token.');
      } catch (error) {
        return fail(error);
      }
    },

    async logout(request: Request, env: Env): Promise<Response> {
      try {
        if (request.method !== 'POST') throw new ApiError('not_found', 'This address does not exist.');
        const token = await o.verifyToken(request.headers.get('Authorization'));
        await o.platform(env).platformSignOut({ sessionId: token.sessionId });
        return new Response(null, { status: 204, headers: NO_STORE });
      } catch (error) {
        return fail(error);
      }
    },
  };
}
