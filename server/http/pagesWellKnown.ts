import type { PagesEnv } from './pagesForward';
import { proxyMcp, type McpProxyOptions } from './pagesMcpProxy';

/**
 * The discovery paths of the own OAuth server (Supabase exit, wave 2). An MCP client tries /.well-known/oauth-authorization-server/mcp
 * first. Wave 5 adds the one-line Pages Function functions/.well-known/[[path]].ts that calls proxyWellKnown, with the switch of the
 * test copy (a new Pages Function runs on production too, so this wave adds none). Only these two paths pass, as
 * /mcp/.well-known/<name>, through the /mcp forwarder and its host list; everything else is 404.
 */
export const WELL_KNOWN_FORWARDS: Readonly<Record<string, string>> = {
  '/.well-known/oauth-authorization-server/mcp': '/mcp/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration/mcp': '/mcp/.well-known/openid-configuration',
};

export async function proxyWellKnown(request: Request, fetcher: typeof fetch = fetch, env: PagesEnv = {}, o: McpProxyOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const target = WELL_KNOWN_FORWARDS[url.pathname];
  if (target === undefined || request.method !== 'GET') return new Response('Not found.', { status: 404 });
  return proxyMcp(new Request(new URL(target, url.origin), { method: 'GET', headers: request.headers }), fetcher, env, o);
}
