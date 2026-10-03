import type { MiddlewareHandler } from 'hono';

/**
 * CORS for the screens (plan 4.10; platform facts 1.7): only the allowed origins, never "*". A preflight (OPTIONS) gets its
 * answer here, before any sign-in check, and is cached for 2 hours (Chromium's cap). Refusals carry the headers too, so the
 * screen can read the status. A request with no Origin (a server, a script) gets no CORS headers and runs as usual.
 */

export const CORS_MAX_AGE = 7200;
const ALLOW_HEADERS = 'Authorization, Content-Type, X-Madar-Build, X-Client-Info, Apikey';
const ALLOW_METHODS = 'GET, POST, OPTIONS';
const EXPOSE_HEADERS = 'Retry-After';

export function cors(allowedOrigins: () => readonly string[]): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('Origin');
    const allowed = origin !== undefined && allowedOrigins().includes(origin);
    if (c.req.method === 'OPTIONS') {
      const headers = new Headers({ Vary: 'Origin' });
      if (allowed) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Allow-Methods', ALLOW_METHODS);
        headers.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
        headers.set('Access-Control-Max-Age', String(CORS_MAX_AGE));
      }
      return new Response(null, { status: 204, headers });
    }
    await next();
    c.res.headers.append('Vary', 'Origin');
    if (allowed) {
      c.res.headers.set('Access-Control-Allow-Origin', origin);
      c.res.headers.set('Access-Control-Expose-Headers', EXPOSE_HEADERS);
    }
  };
}
