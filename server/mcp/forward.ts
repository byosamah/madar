import type { Config, Logger } from '../core/ports';

/**
 * The region hop of the mcp function (plan 5.6; plan section 2, change 5). The platform starts mcp in the region nearest to the
 * agent, and an MCP client cannot add the x-region header (a query parameter would change the OAuth resource URL). So the
 * function forwards every request once to the same function in MCP_FORWARD_REGION (default eu-central-1), before any token check
 * or database work. Client data stays in Frankfurt, and a far agent never holds the office lock across an ocean.
 *
 * - The hop goes to MCP_URL plus the path after /mcp, with forceFunctionRegion. The token goes on unchanged; the aud check in
 *   Frankfurt uses MCP_URL, never the request URL.
 * - The body goes on unread, as a stream.
 * - Only a real region hops. A local host (SB_REGION local-deno, local-workers) or a host with no SB_REGION (unknown, the Workers
 *   fallback) has no regional copy to hop to, so it serves the request itself.
 * - A request that already hopped and still runs in the wrong region gets 503, so a hop never loops.
 */

export const HOP_HEADER = 'x-madar-hop';

/** An AWS region name, as Supabase writes SB_REGION: eu-central-1, us-east-1, ap-southeast-1. */
const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d+$/;

/** Headers that belong to one connection, so they never go on to the next hop. accept-encoding: fetch decodes the answer itself. */
const REQUEST_SKIP = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding', 'keep-alive']);
/** fetch already decoded the body of the answer, so its encoding and length no longer hold. */
const RESPONSE_SKIP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

export type HopConfig = Pick<Config, 'region' | 'forwardRegion' | 'mcpUrl'>;
export type ForwardOptions = { config: HopConfig; fetch?: typeof fetch; log: Logger };

export function needsHop(config: Pick<Config, 'region' | 'forwardRegion'>): boolean {
  return REGION.test(config.region) && config.region !== config.forwardRegion;
}

/** The same function in the forward region: MCP_URL, the path after /mcp, the query, and forceFunctionRegion. */
export function hopUrl(request: Request, config: HopConfig): URL {
  const incoming = new URL(request.url);
  const rest = incoming.pathname.replace(/^.*?\/mcp(?=\/|$)/, '');
  const target = new URL(`${config.mcpUrl.replace(/\/+$/, '')}${rest}`);
  for (const [name, value] of incoming.searchParams) if (name !== 'forceFunctionRegion') target.searchParams.append(name, value);
  target.searchParams.set('forceFunctionRegion', config.forwardRegion);
  return target;
}

function hopError(status: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message } }, { status });
}

/** The answer of the forward region, or null when this function serves the request itself. */
export async function forwardOnce(request: Request, o: ForwardOptions): Promise<Response | null> {
  if (!needsHop(o.config)) return null;
  if (request.headers.has(HOP_HEADER)) {
    o.log.error('An MCP request hopped and still runs outside its region.', { region: o.config.region, forwardRegion: o.config.forwardRegion });
    return hopError(503, 'Madar cannot serve this request in its region now. Try again later.');
  }
  const headers = new Headers();
  for (const [name, value] of request.headers) if (!REQUEST_SKIP.has(name.toLowerCase())) headers.append(name, value);
  headers.set(HOP_HEADER, o.config.region);
  const target = hopUrl(request, o.config);
  const withBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null;
  let upstream: Response;
  try {
    upstream = await (o.fetch ?? fetch)(target, {
      method: request.method,
      headers,
      redirect: 'manual',
      ...(withBody ? { body: request.body, duplex: 'half' } : {}),
    } as RequestInit);
  } catch (error) {
    o.log.error('The MCP region hop failed.', { region: o.config.region, forwardRegion: o.config.forwardRegion, error: error instanceof Error ? error.message : String(error) });
    return hopError(502, 'Madar cannot reach its region now. Try again later.');
  }
  const out = new Headers();
  for (const [name, value] of upstream.headers) if (!RESPONSE_SKIP.has(name.toLowerCase())) out.append(name, value);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}
