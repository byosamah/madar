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
 * - The hop header is "<region>.<tag>": an HMAC-SHA256 of the region under a key from the server secret key. Frankfurt can check the
 *   tag (hopTagOk), because a client can send the header itself. Nothing counts hops since the usage meter went (2026-10-23).
 */

export const HOP_HEADER = 'x-madar-hop';

/** An AWS region name, as Supabase writes SB_REGION: eu-central-1, us-east-1, ap-southeast-1. */
const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d+$/;

/** Headers that belong to one connection, so they never go on to the next hop. accept-encoding: fetch decodes the answer itself. */
const REQUEST_SKIP = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding', 'keep-alive']);
/** fetch already decoded the body of the answer, so its encoding and length no longer hold. */
const RESPONSE_SKIP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

export type HopConfig = Pick<Config, 'region' | 'forwardRegion' | 'mcpUrl'>;
export type ForwardOptions = { config: HopConfig; fetch?: typeof fetch; log: Logger; hopKey?: Uint8Array<ArrayBuffer> };

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const hmacKey = (key: Uint8Array<ArrayBuffer>, usage: 'sign' | 'verify') => crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
const hopLabel = (region: string) => encoder.encode(`madar.mcp.hop\n${region}`);

/** The hop key: HMAC-SHA256 of a fixed label under the server secret key (as stateKeyFrom in reasons.ts, with its own label). */
export async function hopKeyFrom(secretKey: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await hmacKey(encoder.encode(secretKey), 'sign');
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode('madar.mcp.hop.v1')));
}

/** The hop header of a region: "<region>.<tag>", or the region alone when no key exists. */
export async function hopHeaderOf(region: string, key: Uint8Array<ArrayBuffer> | undefined): Promise<string> {
  if (!key) return region;
  return `${region}.${hex(await crypto.subtle.sign('HMAC', await hmacKey(key, 'sign'), hopLabel(region)))}`;
}

/** True only when the header carries a tag of its region under this key. */
export async function hopTagOk(header: string | null, key: Uint8Array<ArrayBuffer> | undefined): Promise<boolean> {
  if (!header || !key) return false;
  const match = /^(.+)\.([0-9a-f]{64})$/.exec(header);
  if (!match) return false;
  const tag = new Uint8Array(match[2].match(/../g)!.map((pair) => parseInt(pair, 16)));
  return crypto.subtle.verify('HMAC', await hmacKey(key, 'verify'), tag, hopLabel(match[1]));
}

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
  headers.set(HOP_HEADER, await hopHeaderOf(o.config.region, o.hopKey));
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
