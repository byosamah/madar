/**
 * The short MCP address (owner, 2026-10-05): https://madar.vado.sa/mcp. A Cloudflare Pages Function (functions/mcp/[[path]].ts)
 * runs this for every request under /mcp and forwards it to the mcp function of the Supabase project of that host, pinned to
 * Frankfurt with x-region, so the function never needs its own region hop. MCP_URL of the project is this short address, so the
 * token audience, the resource metadata and the WWW-Authenticate header all name it.
 *
 * - A fixed host list: production for madar.vado.sa, www.madar.vado.sa and madar-46r.pages.dev; madar-test for the test copy.
 *   Any other host (a deployment hash, a stranger) and any path outside /mcp get 404, so this is never an open proxy.
 * - Headers of Cloudflare and of the client address go: Supabase sits behind Cloudflare too and refuses a request that carries
 *   its own cf-connecting-ip (proof.md Z0b). x-madar-hop goes too: only the function sets it.
 * - The body goes on as a stream, and the answer comes back as a stream (MCP may answer with server-sent events).
 */

const PRODUCTION = 'https://oprkvdjudjxxhvodkzgs.supabase.co/functions/v1/mcp';
const TEST = 'https://qdgwpnesxppnqsaabqzd.supabase.co/functions/v1/mcp';

export const MCP_TARGETS: Readonly<Record<string, string>> = {
  'madar.vado.sa': PRODUCTION,
  'www.madar.vado.sa': PRODUCTION,
  'madar-46r.pages.dev': PRODUCTION,
  'preview.madar-46r.pages.dev': TEST,
};

const PREFIX = '/mcp';
/** Headers of one connection, of Cloudflare, or of the client address. fetch decodes the answer itself, so accept-encoding goes too. */
const REQUEST_SKIP = new Set([
  'host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding', 'keep-alive',
  'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip', 'true-client-ip', 'x-madar-hop',
]);
/** fetch already decoded the body of the answer, so its encoding and length no longer hold. */
const RESPONSE_SKIP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

export async function proxyMcp(request: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const target = MCP_TARGETS[url.hostname];
  const inside = url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`);
  if (!target || !inside) return new Response('Not found. The Madar MCP address is https://madar.vado.sa/mcp.', { status: 404 });

  // Encoded dots, encoded slashes and backslashes could become a path outside the mcp function upstream (security review).
  // The URL parser already removes plain dot segments, so the prefix check above holds for those.
  const suffix = url.pathname.slice(PREFIX.length);
  if (/%2e|%2f|%5c|\\/i.test(suffix)) return new Response('Not found.', { status: 404 });
  const base = new URL(target);
  const upstream = new URL(`${base.pathname}${suffix}${url.search}`, base);
  if (upstream.origin !== base.origin || !(upstream.pathname === base.pathname || upstream.pathname.startsWith(`${base.pathname}/`))) {
    return new Response('Not found.', { status: 404 });
  }

  const headers = new Headers();
  request.headers.forEach((value, name) => {
    const key = name.toLowerCase();
    if (!REQUEST_SKIP.has(key) && !key.startsWith('cf-')) headers.set(key, value);
  });
  headers.set('x-region', 'eu-central-1');
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const answer = await fetcher(upstream.toString(), {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit);

  const out = new Headers();
  answer.headers.forEach((value, name) => {
    if (!RESPONSE_SKIP.has(name.toLowerCase())) out.set(name, value);
  });
  return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers: out });
}
