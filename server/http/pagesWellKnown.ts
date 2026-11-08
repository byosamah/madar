import { copyOfPageHost, serverHostOf } from '../core/serverHost';
import { isAddressName } from '../enterprise/ids';
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

/**
 * The target of a discovery path (Madar enterprises): the two paths of VADOs' Companies, and the same two with an address name after
 * /mcp, which go to /mcp/<address>/.well-known/<name>. Nothing else passes: not a capital, not a second segment, not a path word.
 */
export function wellKnownTarget(pathname: string): string | undefined {
  if (Object.hasOwn(WELL_KNOWN_FORWARDS, pathname)) return WELL_KNOWN_FORWARDS[pathname];
  const match = /^\/\.well-known\/(oauth-authorization-server|openid-configuration)\/mcp\/([^/]+)$/.exec(pathname);
  return match && isAddressName(match[2]) ? `/mcp/${match[2]}/.well-known/${match[1]}` : undefined;
}

export async function proxyWellKnown(request: Request, fetcher: typeof fetch = fetch, env: PagesEnv = {}, o: McpProxyOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const target = wellKnownTarget(url.pathname);
  if (target === undefined || request.method !== 'GET') return new Response('Not found.', { status: 404 });
  // Only an office copy runs the own OAuth server (exit wave 4). Every other copy answers 404, as the Pages site did before.
  const copy = copyOfPageHost(url.hostname);
  if (!copy || serverHostOf(copy, o.setting) !== 'office') return new Response('Not found.', { status: 404 });
  return proxyMcp(new Request(new URL(target, url.origin), { method: 'GET', headers: request.headers }), fetcher, env, o);
}
