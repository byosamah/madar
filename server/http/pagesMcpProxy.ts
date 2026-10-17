import { COPY_HOSTS, PAGE_HOSTS, copyOfPageHost, serverHostOf, type ServerHostSetting } from '../core/serverHost';
import { CLIENT_ADDRESS_HEADER, INTERNAL_ORIGIN, answerOf, bindingOf, defaultLog, fallbackLine, forwardHeaders, forwardInit, unsafeSuffix, type PagesEnv } from './pagesForward';

/**
 * The short MCP address (owner, 2026-10-05): https://madar.vado.sa/mcp. A Cloudflare Pages Function (functions/mcp/[[path]].ts)
 * runs this for every request under /mcp. MCP_URL of the project is this short address, so the token audience, the resource
 * metadata and the WWW-Authenticate header all name it, on both server hosts: no agent connects again after a switch.
 *
 * - The server host of the copy (owner, 2026-10-16; config/server-host.json): with workers and the Pages service binding of the
 *   copy (MADAR_SERVER_TEST, MADAR_SERVER_PRODUCTION), the request goes to the Worker as /mcp<rest> with the query, and no
 *   x-region (the Worker is placed in aws:eu-central-1 and makes no region hop). Otherwise it goes to the mcp function of the
 *   Supabase project of that host, pinned to Frankfurt with x-region, so the function never needs its own region hop. Each
 *   request to Supabase logs one line: info for the setting, a warning for a missing binding.
 * - A fixed host list: production for madar.vado.sa, www.madar.vado.sa and madar-46r.pages.dev; madar-test for the test copy.
 *   Any other host (a deployment hash, a stranger) and any path outside /mcp get 404, so this is never an open proxy. A
 *   production host never reaches the test binding.
 * - Headers of Cloudflare and of the client address go (server/http/pagesForward.ts): Supabase sits behind Cloudflare too and
 *   refuses a request that carries its own cf-connecting-ip (proof.md Z0b). x-madar-hop goes too: only the function sets it.
 *   On the Worker path, this function then writes x-madar-client-address from cf-connecting-ip, as the /api forwarder does.
 * - The body goes on as a stream, and the answer comes back as a stream (MCP may answer with server-sent events).
 */

/** The mcp function of each page host (the way back). */
export const MCP_TARGETS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(PAGE_HOSTS).map(([host, copy]) => [host, COPY_HOSTS[copy].supabase.mcp]),
);

const PREFIX = '/mcp';
const FALLBACK = 'The MCP request went to the Supabase mcp function.';

export type McpProxyOptions = { setting?: ServerHostSetting; log?: (line: string) => void };

export async function proxyMcp(request: Request, fetcher: typeof fetch = fetch, env: PagesEnv = {}, o: McpProxyOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const copy = copyOfPageHost(url.hostname);
  const inside = url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`);
  if (!copy || !inside) return new Response('Not found. The Madar MCP address is https://madar.vado.sa/mcp.', { status: 404 });

  // Encoded dots, encoded slashes and backslashes could become a path outside the mcp function upstream (security review).
  // The URL parser already removes plain dot segments, so the prefix check above holds for those.
  const suffix = url.pathname.slice(PREFIX.length);
  if (unsafeSuffix(suffix)) return new Response('Not found.', { status: 404 });

  const headers = forwardHeaders(request);
  const onWorkers = serverHostOf(copy, o.setting) === 'workers';
  const binding = onWorkers ? bindingOf(env, COPY_HOSTS[copy].workers.binding) : undefined;
  if (binding) {
    // The Worker has no public address, so the limits of the OAuth routes count the address that this function writes
    // (clientAddress). Without it, every client would share one count, and one client could block the rest.
    const address = request.headers.get('cf-connecting-ip')?.trim();
    if (address) headers.set(CLIENT_ADDRESS_HEADER, address);
    return answerOf(await binding.fetch(new Request(`${INTERNAL_ORIGIN}${PREFIX}${suffix}${url.search}`, forwardInit(request, headers))));
  }

  (o.log ?? defaultLog)(fallbackLine(FALLBACK, copy, onWorkers ? 'binding_missing' : 'setting'));
  const base = new URL(COPY_HOSTS[copy].supabase.mcp);
  const upstream = new URL(`${base.pathname}${suffix}${url.search}`, base);
  if (upstream.origin !== base.origin || !(upstream.pathname === base.pathname || upstream.pathname.startsWith(`${base.pathname}/`))) {
    return new Response('Not found.', { status: 404 });
  }
  headers.set('x-region', 'eu-central-1');
  return answerOf(await fetcher(upstream.toString(), forwardInit(request, headers)));
}
