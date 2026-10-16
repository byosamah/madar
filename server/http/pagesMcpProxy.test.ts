import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ServerHostSetting } from '../core/serverHost';
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

  it('refuses encoded dots, encoded slashes and backslashes after /mcp, so no path leaves the mcp function upstream (security review)', async () => {
    const { seen, fetcher } = recorder();
    for (const path of ['/mcp/%2e%2e%2fapi%2fbatch', '/mcp/x%2Fy', '/mcp/x%5Cy', '/mcp/%2e%2e']) {
      expect((await proxyMcp(new Request(`https://madar.vado.sa${path}`, { method: 'POST', body: '{}' }), fetcher)).status, path).toBe(404);
    }
    expect(seen).toHaveLength(0);
    // A plain path still goes, and stays under the mcp function. The URL parser itself turns a lone %2e segment into nothing, so
    // /mcp/a/%2e/b reaches /mcp/a/b, inside the function; /mcp/%2E%2E/api never matches /mcp at all.
    await proxyMcp(new Request('https://madar.vado.sa/mcp/oauth-protected-resource'), fetcher);
    expect(new URL(seen[0].url).pathname).toBe('/functions/v1/mcp/oauth-protected-resource');
    await proxyMcp(new Request('https://madar.vado.sa/mcp/a/%2e/b'), fetcher);
    expect(new URL(seen[1].url).pathname).toBe('/functions/v1/mcp/a/b');
    expect((await proxyMcp(new Request('https://madar.vado.sa/mcp/%2E%2E/api'), fetcher)).status).toBe(404);
  });
});

describe('the short MCP address on the Worker (owner, 2026-10-16)', () => {
  const WORKERS: ServerHostSetting = { test: 'workers', production: 'workers' };
  function bindings(answer = () => new Response('{"ok":true}', { status: 200, headers: { 'x-madar-server': 'workers;colo=FRA' } })) {
    const seen: { name: string; request: Request }[] = [];
    const binding = (name: string) => ({ fetch: async (request: Request) => (seen.push({ name, request }), answer()) });
    return { seen, env: { MADAR_SERVER_TEST: binding('MADAR_SERVER_TEST'), MADAR_SERVER_PRODUCTION: binding('MADAR_SERVER_PRODUCTION') } };
  }

  it('hands the request to the Worker of its copy with /mcp, the rest of the path and the query, and sends no x-region', async () => {
    const { seen: fetched, fetcher } = recorder();
    const { seen, env } = bindings();
    const lines: string[] = [];
    const answer = await proxyMcp(new Request('https://madar.vado.sa/mcp/oauth-protected-resource?x=1', { headers: { Authorization: 'Bearer abc' } }), fetcher, env, { setting: WORKERS, log: (line) => void lines.push(line) });
    expect(answer.status).toBe(200);
    expect(answer.headers.get('x-madar-server')).toBe('workers;colo=FRA');
    expect(seen.map((s) => [s.name, s.request.url])).toEqual([['MADAR_SERVER_PRODUCTION', 'https://madar-server.internal/mcp/oauth-protected-resource?x=1']]);
    expect(seen[0].request.headers.get('authorization')).toBe('Bearer abc');
    expect(seen[0].request.headers.has('x-region')).toBe(false);
    expect(fetched).toEqual([]);
    expect(lines).toEqual([]);

    const body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
    await proxyMcp(new Request('https://preview.madar-46r.pages.dev/mcp', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }), fetcher, env, { setting: WORKERS });
    expect(seen[1].name).toBe('MADAR_SERVER_TEST');
    expect(seen[1].request.url).toBe('https://madar-server.internal/mcp');
    expect(await seen[1].request.text()).toBe(body);
  });

  it('drops the same headers on the way to the Worker, also a client address that the client sent', async () => {
    const { fetcher } = recorder();
    const { seen, env } = bindings();
    await proxyMcp(new Request('https://madar.vado.sa/mcp', {
      method: 'POST',
      body: '{}',
      headers: { 'cf-connecting-ip': '1.2.3.4', 'cf-ray': 'x', 'x-forwarded-for': '1.2.3.4', 'true-client-ip': '1.2.3.4', 'x-madar-hop': 'forged', 'x-madar-client-address': '9.9.9.9' },
    }), fetcher, env, { setting: WORKERS });
    for (const name of ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'true-client-ip', 'x-madar-hop', 'x-madar-client-address']) {
      expect(seen[0].request.headers.has(name), name).toBe(false);
    }
  });

  it('keeps every 404 rule on the Worker path, and calls nothing', async () => {
    const { seen: fetched, fetcher } = recorder();
    const { seen, env } = bindings();
    for (const url of ['https://abc123.madar-46r.pages.dev/mcp', 'https://evil.example/mcp', 'https://madar.vado.sa/mcpx', 'https://madar.vado.sa/api/batch', 'https://madar.vado.sa/mcp/%2e%2e%2fapi%2fbatch', 'https://madar.vado.sa/mcp/x%5Cy']) {
      expect((await proxyMcp(new Request(url, { method: 'POST', body: '{}' }), fetcher, env, { setting: WORKERS })).status, url).toBe(404);
    }
    expect([seen, fetched]).toEqual([[], []]);
  });

  it('never sends a production host to the test binding, also when the production binding is missing', async () => {
    const { seen: fetched, fetcher } = recorder();
    const { seen, env } = bindings();
    const lines: string[] = [];
    await proxyMcp(new Request('https://madar.vado.sa/mcp', { method: 'POST', body: '{}' }), fetcher, { MADAR_SERVER_TEST: env.MADAR_SERVER_TEST }, { setting: WORKERS, log: (line) => void lines.push(line) });
    expect(seen).toEqual([]);
    expect(fetched[0].url).toBe(PRODUCTION);
    expect(fetched[0].headers.get('x-region')).toBe('eu-central-1');
    expect(JSON.parse(lines[0])).toEqual({ level: 'warn', message: 'The MCP request went to the Supabase mcp function.', copy: 'production', reason: 'binding_missing' });
  });

  it('forwards to the Supabase mcp function as before when the setting says supabase, and logs it', async () => {
    const { seen: fetched, fetcher } = recorder();
    const { seen, env } = bindings();
    const lines: string[] = [];
    await proxyMcp(new Request('https://preview.madar-46r.pages.dev/mcp', { method: 'POST', body: '{}' }), fetcher, env, { setting: { test: 'supabase', production: 'workers' }, log: (line) => void lines.push(line) });
    expect(seen).toEqual([]);
    expect(fetched[0].url).toBe(TEST);
    expect(JSON.parse(lines[0])).toMatchObject({ level: 'info', copy: 'test', reason: 'setting' });
  });

  it('runs from a one-line Pages wrapper that passes the env', () => {
    const text = readFileSync(new URL('../../functions/mcp/[[path]].ts', import.meta.url), 'utf8');
    expect(text).toMatch(/export const onRequest = \(\{ request, env \}[^\n]*=> proxyMcp\(request, fetch, env\);/);
  });
});
