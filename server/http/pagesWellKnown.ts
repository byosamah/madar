import { copyOfPageHost, serverHostOf } from '../core/serverHost';
import type { PagesEnv } from './pagesForward';
import { proxyMcp, type McpProxyOptions } from './pagesMcpProxy';

/**
 * The discovery paths of the own OAuth server (Supabase exit, wave 2). An MCP client tries /.well-known/oauth-authorization-server/mcp
 * first. Only these two paths pass, as /mcp/.well-known/<name>, through the /mcp forwarder and its host list; everything else is 404.
 * Wave 4 adds the two Pages Functions (functions/.well-known/oauth-authorization-server/[[path]].ts and
 * functions/.well-known/openid-configuration/[[path]].ts); they answer only for an office copy, so production gets 404 until the
 * switch, as the Pages site did before.
 */
export const WELL_KNOWN_FORWARDS: Readonly<Record<string, string>> = {
  '/.well-known/oauth-authorization-server/mcp': '/mcp/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration/mcp': '/mcp/.well-known/openid-configuration',
};

export async function proxyWellKnown(request: Request, fetcher: typeof fetch = fetch, env: PagesEnv = {}, o: McpProxyOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const target = WELL_KNOWN_FORWARDS[url.pathname];
  if (target === undefined || request.method !== 'GET') return new Response('Not found.', { status: 404 });
  // Only an office copy runs the own OAuth server (exit wave 4). Every other copy answers 404, as the Pages site did before.
  const copy = copyOfPageHost(url.hostname);
  if (!copy || serverHostOf(copy, o.setting) !== 'office') return new Response('Not found.', { status: 404 });
  return proxyMcp(new Request(new URL(target, url.origin), { method: 'GET', headers: request.headers }), fetcher, env, o);
}
