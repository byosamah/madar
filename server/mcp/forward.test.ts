import { describe, expect, it } from 'vitest';
import { HOP_HEADER, forwardOnce, needsHop } from './forward';

const MCP_URL = 'https://ref.supabase.co/functions/v1/mcp';
const config = (region: string, forwardRegion = 'eu-central-1') => ({ region, forwardRegion, mcpUrl: MCP_URL });
const log = { info: () => undefined, warn: () => undefined, error: () => undefined };

type Seen = { url: string; method: string; headers: Headers; body: string };

/** A stand-in for the network: it records each request and answers with a gzip header, as a real upstream may. */
function recorder(answer = () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '999', 'x-sb-edge-region': 'eu-central-1' } })) {
  const seen: Seen[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    seen.push({ url: request.url, method: request.method, headers: request.headers, body: await request.text() });
    return answer();
  };
  return { seen, fetchImpl: fetchImpl as typeof fetch };
}

const post = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer abc', host: 'internal', ...headers }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });

describe('the region hop (plan 5.6, change 5)', () => {
  it('hops only when SB_REGION names a real region other than MCP_FORWARD_REGION', () => {
    expect(needsHop(config('eu-central-1'))).toBe(false);
    expect(needsHop(config('us-east-1'))).toBe(true);
    expect(needsHop(config('ap-southeast-1'))).toBe(true);
    // A local host or an unknown region has no regional copy to hop to.
    for (const region of ['unknown', 'local-deno', 'local-workers', '']) expect(needsHop(config(region))).toBe(false);
    expect(needsHop(config('eu-central-2', 'eu-central-2'))).toBe(false);
  });

  it('serves a request in Frankfurt itself: no forward', async () => {
    const net = recorder();
    expect(await forwardOnce(post('http://internal/mcp'), { config: config('eu-central-1'), fetch: net.fetchImpl, log })).toBeNull();
    expect(net.seen).toHaveLength(0);
  });

  it('forwards a request in another region once, unread, to the same function with forceFunctionRegion', async () => {
    const net = recorder();
    const response = await forwardOnce(post('http://internal/mcp?x=1'), { config: config('us-east-1'), fetch: net.fetchImpl, log });
    expect(net.seen).toHaveLength(1);
    const [sent] = net.seen;
    const url = new URL(sent.url);
    expect(`${url.origin}${url.pathname}`).toBe(MCP_URL);
    expect(url.searchParams.get('forceFunctionRegion')).toBe('eu-central-1');
    expect(url.searchParams.get('x')).toBe('1');
    expect(sent.method).toBe('POST');
    expect(sent.body).toBe('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
    // The token goes on unchanged: the aud check in Frankfurt uses MCP_URL, never the request URL.
    expect(sent.headers.get('authorization')).toBe('Bearer abc');
    expect(sent.headers.get(HOP_HEADER)).toBe('us-east-1');
    expect(sent.headers.get('host')).not.toBe('internal');
    // The answer comes back as it is, without the length and encoding of the first hop (fetch already decoded the body).
    expect(response!.status).toBe(200);
    expect(response!.headers.get('content-encoding')).toBeNull();
    expect(response!.headers.get('content-length')).toBeNull();
    expect(response!.headers.get('x-sb-edge-region')).toBe('eu-central-1');
    expect(await response!.json()).toEqual({ ok: true });
  });

  it('keeps the path after /mcp, so the metadata document hops too', async () => {
    const net = recorder();
    await forwardOnce(new Request('http://internal/mcp/oauth-protected-resource', { method: 'GET' }), { config: config('us-east-1'), fetch: net.fetchImpl, log });
    expect(new URL(net.seen[0].url).pathname).toBe('/functions/v1/mcp/oauth-protected-resource');
    expect(net.seen[0].method).toBe('GET');
  });

  it('never hops twice: a request that already hopped and still runs in the wrong region gets 503', async () => {
    const net = recorder();
    const response = await forwardOnce(post('http://internal/mcp', { [HOP_HEADER]: 'us-east-1' }), { config: config('us-east-1'), fetch: net.fetchImpl, log });
    expect(net.seen).toHaveLength(0);
    expect(response!.status).toBe(503);
  });

  it('answers 502 when the hop fails, and names no secret', async () => {
    const failing = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    const lines: string[] = [];
    const response = await forwardOnce(post('http://internal/mcp'), { config: config('us-east-1'), fetch: failing, log: { ...log, error: (m: string, f?: object) => lines.push(`${m} ${JSON.stringify(f)}`) } });
    expect(response!.status).toBe(502);
    expect(lines.join('\n')).not.toContain('Bearer abc');
  });
});
