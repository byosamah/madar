import { describe, expect, it } from 'vitest';
import { MCP_TARGETS, proxyMcp } from './pagesMcpProxy';

/** A fetch that records the request it gets and answers with the given response. */
function recorder(answer: Response = new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })) {
  const seen: Request[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init));
    return answer;
  }) as typeof fetch;
  return { seen, fetcher };
}

const PRODUCTION = 'https://oprkvdjudjxxhvodkzgs.supabase.co/functions/v1/mcp';
const TEST = 'https://qdgwpnesxppnqsaabqzd.supabase.co/functions/v1/mcp';

describe('the short MCP address on Cloudflare Pages (owner, 2026-10-05)', () => {
  it('sends each host to the mcp function of its own project, and the test copy to madar-test', () => {
    expect(MCP_TARGETS['madar.vado.sa']).toBe(PRODUCTION);
    expect(MCP_TARGETS['www.madar.vado.sa']).toBe(PRODUCTION);
    expect(MCP_TARGETS['madar-46r.pages.dev']).toBe(PRODUCTION);
    expect(MCP_TARGETS['preview.madar-46r.pages.dev']).toBe(TEST);
  });

  it('forwards the method, the path after /mcp, the query, the token and the body, pinned to Frankfurt', async () => {
    const { seen, fetcher } = recorder();
    const request = new Request('https://madar.vado.sa/mcp/oauth-protected-resource?x=1', { method: 'GET', headers: { Authorization: 'Bearer abc' } });
    const answer = await proxyMcp(request, fetcher);
    expect(answer.status).toBe(200);
    expect(seen[0].url).toBe(`${PRODUCTION}/oauth-protected-resource?x=1`);
    expect(seen[0].headers.get('authorization')).toBe('Bearer abc');
    expect(seen[0].headers.get('x-region')).toBe('eu-central-1');

    const body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
    await proxyMcp(new Request('https://preview.madar-46r.pages.dev/mcp', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-11-25' } }), fetcher);
    expect(seen[1].url).toBe(TEST);
    expect(seen[1].method).toBe('POST');
    expect(await seen[1].text()).toBe(body);
    expect(seen[1].headers.get('mcp-protocol-version')).toBe('2025-11-25');
  });

  it('drops the headers of Cloudflare and of the client address, so Supabase (behind Cloudflare too) never refuses the hop', async () => {
    const { seen, fetcher } = recorder();
    await proxyMcp(new Request('https://madar.vado.sa/mcp', {
      method: 'POST',
      body: '{}',
      headers: { 'cf-connecting-ip': '1.2.3.4', 'cf-ray': 'x', 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '1.2.3.4', 'true-client-ip': '1.2.3.4', 'x-madar-hop': 'forged', 'accept-encoding': 'gzip' },
    }), fetcher);
    for (const name of ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-real-ip', 'true-client-ip', 'x-madar-hop', 'accept-encoding']) {
      expect(seen[0].headers.has(name), name).toBe(false);
    }
  });

  it('gives back the status, the headers and the body of Supabase, without the encoding headers that fetch already undid', async () => {
    const { fetcher } = recorder(new Response('unauthorized', {
      status: 401,
      headers: { 'www-authenticate': 'Bearer resource_metadata="https://madar.vado.sa/mcp/oauth-protected-resource"', 'content-encoding': 'gzip', 'content-length': '12' },
    }));
    const answer = await proxyMcp(new Request('https://madar.vado.sa/mcp', { method: 'POST', body: '{}' }), fetcher);
    expect(answer.status).toBe(401);
    expect(answer.headers.get('www-authenticate')).toContain('resource_metadata=');
    expect(answer.headers.has('content-encoding')).toBe(false);
    expect(await answer.text()).toBe('unauthorized');
  });

  it('refuses any other host or path with 404, so the proxy never forwards for a stranger', async () => {
    const { seen, fetcher } = recorder();
    expect((await proxyMcp(new Request('https://abc123.madar-46r.pages.dev/mcp'), fetcher)).status).toBe(404);
    expect((await proxyMcp(new Request('https://evil.example/mcp'), fetcher)).status).toBe(404);
    expect((await proxyMcp(new Request('https://madar.vado.sa/mcpx'), fetcher)).status).toBe(404);
    expect((await proxyMcp(new Request('https://madar.vado.sa/api/batch'), fetcher)).status).toBe(404);
    expect(seen).toHaveLength(0);
  });
});
