import { COPY_HOSTS, copyOfPageHost, onWorker, serverHostOf, type ServerHostSetting } from '../core/serverHost';
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
 * The page's own /api (owner, 2026-10-16). A Cloudflare Pages Function (functions/api/[[path]].ts) runs this for every request
 * under /api of the page host. When config/server-host.json says workers for the copy of that host, it hands the request to the
 * Worker of that copy through the Pages service binding (MADAR_SERVER_TEST, MADAR_SERVER_PRODUCTION). Why: the screens then make
 * no cross-site call (no preflight), use one connection with the page, and never see a workers.dev address (security vendors
 * report heavy phishing abuse of workers.dev, so office filters can flag it), and the Worker needs no public address.
 *
 * - A fixed host table (server/core/serverHost.ts): production for madar.vado.sa, www.madar.vado.sa and madar-46r.pages.dev,
 *   the test copy for preview.madar-46r.pages.dev. Any other host and any path outside /api get 404, so this is never an open
 *   proxy. A production host never reaches the test binding.
 * - The path and the query stay, and both bodies go on as streams.
 * - x-madar-client-address: always the incoming cf-connecting-ip, never a value that the client sent. The Worker reads the client
 *   address only from it (server/auth/forgot.ts, clientAddress).
 * - When the setting says supabase, or the binding is missing, it forwards to the Supabase api function of the copy, pinned to
 *   Frankfurt with forceFunctionRegion, and logs the case. That serves the tabs that a build for the Worker opened before a switch
 *   back. Supabase then sees the address of the Pages Function, not of the person (the forgot limit counts them together).
 * - A 101 answer of the Worker (the live socket, exit wave 3) goes back as it is.
 * - The word office (exit wave 4) also goes to the binding: the Worker of the copy serves it from its office object.
 * - /api/office and every path under it (the office ops of exit wave 4: export, import, peek, drop) go to the binding whatever the
 *   word says, and nowhere else. No Supabase function has them, so with no binding they answer 404 (production before wave 6).
 */

const PREFIX = '/api';
const NOT_FOUND = 'Not found.';
const FALLBACK = 'The page api went to the Supabase api function.';

export type ProxyOptions = { fetch?: typeof fetch; setting?: ServerHostSetting; log?: (line: string) => void };

export async function proxyApi(request: Request, env: PagesEnv = {}, o: ProxyOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const copy = copyOfPageHost(url.hostname);
  const inside = url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`);
  if (!copy || !inside) return new Response(NOT_FOUND, { status: 404 });
  const suffix = url.pathname.slice(PREFIX.length);
  if (unsafeSuffix(suffix)) return new Response(NOT_FOUND, { status: 404 });

  const headers = forwardHeaders(request);
  const hosts = COPY_HOSTS[copy];
  // The ops of the office object (exit wave 4) go to the Worker whatever the word says, and nowhere else.
  const ops = suffix === '/office' || suffix.startsWith('/office/');
  const onWorkers = ops || onWorker(serverHostOf(copy, o.setting));
  const binding = onWorkers ? bindingOf(env, hosts.workers.binding) : undefined;
  if (binding) {
    const address = request.headers.get('cf-connecting-ip')?.trim();
    if (address) headers.set(CLIENT_ADDRESS_HEADER, address);
    const answer = await binding.fetch(new Request(`${INTERNAL_ORIGIN}${PREFIX}${suffix}${url.search}`, forwardInit(request, headers)));
    // A socket upgrade (GET /api/live, exit wave 3): the 101 answer carries the socket, and a copy of it would lose the socket.
    return answer.status === 101 ? answer : answerOf(answer);
  }

  if (ops) return new Response(NOT_FOUND, { status: 404 });
  (o.log ?? defaultLog)(fallbackLine(FALLBACK, copy, onWorkers ? 'binding_missing' : 'setting'));
  const base = new URL(hosts.supabase.api);
  const upstream = new URL(`${base.pathname}${suffix}${url.search}`, base);
  if (upstream.origin !== base.origin || !(upstream.pathname === base.pathname || upstream.pathname.startsWith(`${base.pathname}/`))) {
    return new Response(NOT_FOUND, { status: 404 });
  }
  upstream.searchParams.set('forceFunctionRegion', 'eu-central-1');
  return answerOf(await (o.fetch ?? fetch)(upstream.toString(), forwardInit(request, headers)));
}
