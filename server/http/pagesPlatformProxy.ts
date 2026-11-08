import { COPY_HOSTS, copyOfPlatformHost } from '../core/serverHost';
import {
  CLIENT_ADDRESS_HEADER,
  INTERNAL_ORIGIN,
  answerOf,
  bindingOf,
  defaultLog,
  fallbackLine,
  forwardHeaders,
  forwardInit,
  unsafeSuffix,
  type PagesEnv,
} from './pagesForward';

/**
 * The page's own /api/platform on the site Madar enterprises (design 12, D7). A Cloudflare Pages Function of the project madar-platform
 * (functions-platform/api/platform/[[path]].ts) runs this for every request under /api/platform. It hands the request to the Worker of the
 * copy through the Pages service binding (MADAR_SERVER_TEST on the preview host, MADAR_SERVER_PRODUCTION on a production host). The platform
 * routes exist on the office path of the Worker only, so there is no Supabase fallback: a missing binding answers 404.
 *
 * - A fixed host table (PLATFORM_HOSTS in server/core/serverHost.ts). Any other host, also a host of a company page, gets 404.
 * - Only /api/platform and the paths under it pass (the platform calls, /auth/token and /auth/logout). Every other path gets 404, so this is
 *   never an open proxy and never a door to the routes of the companies.
 * - The path and the query stay. A production host never reaches the test binding.
 * - x-madar-client-address is always the incoming cf-connecting-ip, never a value that the client sent (the sign-in limit counts it).
 * - The headers follow the rules of pagesForward.ts: no cf-* header, no forwarded address, no hop headers.
 */

const PREFIX = '/api/platform';
const NOT_FOUND = 'Not found.';
const MISSING = 'The platform api has no binding to the Worker.';

export type PlatformProxyOptions = { log?: (line: string) => void };

export async function proxyPlatform(request: Request, env: PagesEnv = {}, o: PlatformProxyOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const copy = copyOfPlatformHost(url.hostname);
  const inside = url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`);
  if (!copy || !inside) return new Response(NOT_FOUND, { status: 404 });
  const suffix = url.pathname.slice(PREFIX.length);
  if (unsafeSuffix(suffix)) return new Response(NOT_FOUND, { status: 404 });

  const binding = bindingOf(env, COPY_HOSTS[copy].workers.binding);
  if (!binding) {
    (o.log ?? defaultLog)(fallbackLine(MISSING, copy, 'binding_missing'));
    return new Response(NOT_FOUND, { status: 404 });
  }
  const headers = forwardHeaders(request);
  const address = request.headers.get('cf-connecting-ip')?.trim();
  if (address) headers.set(CLIENT_ADDRESS_HEADER, address);
  return answerOf(await binding.fetch(new Request(`${INTERNAL_ORIGIN}${PREFIX}${suffix}${url.search}`, forwardInit(request, headers))));
}
