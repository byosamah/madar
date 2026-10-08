/**
 * The same-host batch address (performance audit 2026-10-07, FET-10): POST /api/batch on the page host. A Cloudflare Pages
 * Function (functions/api/batch.ts) runs this and forwards the request to the api function of the Supabase project of that
 * host, pinned to Frankfurt with x-region. The page and the batch then share one origin, so the browser sends no CORS
 * preflight before a batch.
 *
 * - The fixed host list of the MCP address (MCP_TARGETS). Any other host and any other path get 404, and any other method gets
 *   405, so this is never an open proxy.
 * - Only the batch goes this way. /api/auth/forgot and /api/auth/renew-invite stay on the Supabase address: they limit requests
 *   by the client address, and a forwarder must drop that address (Supabase refuses a request with its own cf-connecting-ip,
 *   proof.md Z0b). The batch reads no client address.
 * - The headers of Cloudflare and of the client address go, and the cookies of the page host go both ways.
 */
import { MCP_TARGETS } from './pagesMcpProxy';

const PATH = '/api/batch';

/** The api batch of the project of each host: the project of the MCP target of that host. */
export const BATCH_TARGETS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MCP_TARGETS).map(([host, mcp]) => [host, `${new URL(mcp).origin}/functions/v1/api/batch`]),
);

/** Headers of one connection, of Cloudflare, of the client address, or of the page host. fetch decodes the answer itself. */
const REQUEST_SKIP = new Set([
  'host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding', 'keep-alive', 'cookie',
  'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip', 'true-client-ip', 'x-madar-hop',
]);
/** fetch already decoded the body of the answer, so its encoding and length no longer hold. No cookie of Supabase goes on. */
const RESPONSE_SKIP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie']);

export async function proxyBatch(request: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const target = BATCH_TARGETS[url.hostname];
  if (!target || url.pathname !== PATH) return new Response('Not found.', { status: 404 });
  if (request.method !== 'POST') return new Response('Method not allowed.', { status: 405, headers: { Allow: 'POST' } });

  const upstream = new URL(target);
  upstream.search = url.search;
  const headers = new Headers();
  request.headers.forEach((value, name) => {
    const key = name.toLowerCase();
    if (!REQUEST_SKIP.has(key) && !key.startsWith('cf-')) headers.set(key, value);
  });
  headers.set('x-region', 'eu-central-1');
  const answer = await fetcher(upstream.toString(), {
    method: 'POST',
    headers,
    body: request.body,
    redirect: 'manual',
    duplex: 'half',
  } as RequestInit);

  const out = new Headers();
  answer.headers.forEach((value, name) => {
    if (!RESPONSE_SKIP.has(name.toLowerCase())) out.set(name, value);
  });
  return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers: out });
}
