import { describe, expect, it } from 'vitest';
import { BATCH_TARGETS, proxyBatch } from './pagesApiProxy';
import { MCP_TARGETS } from './pagesMcpProxy';

/** A fetch that records the request it gets and answers with a copy of the given response. */
function recorder(answer: Response = new Response('{"results":[]}', { status: 200, headers: { 'content-type': 'application/json' } })) {
  const seen: Request[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init));
    return answer.clone();
  }) as typeof fetch;
  return { seen, fetcher };
}

const PRODUCTION = 'https://oprkvdjudjxxhvodkzgs.supabase.co/functions/v1/api/batch';
const TEST = 'https://qdgwpnesxppnqsaabqzd.supabase.co/functions/v1/api/batch';
const BODY = '{"calls":[{"name":"session.get","input":{}}]}';

function batch(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: 'POST', body: BODY, headers: { 'Content-Type': 'application/json', ...headers } });
}

describe('the same-host batch address on Cloudflare Pages (performance audit 2026-10-07, FET-10)', () => {
  it('sends each host to the api batch of its own project, with the same host list as the MCP address', () => {
    expect(BATCH_TARGETS['madar.vado.sa']).toBe(PRODUCTION);
    expect(BATCH_TARGETS['www.madar.vado.sa']).toBe(PRODUCTION);
    expect(BATCH_TARGETS['madar-46r.pages.dev']).toBe(PRODUCTION);
    expect(BATCH_TARGETS['preview.madar-46r.pages.dev']).toBe(TEST);
    expect(Object.keys(BATCH_TARGETS).sort()).toEqual(Object.keys(MCP_TARGETS).sort());
  });

  it('forwards the query, the token, the key, the build and the body, pinned to Frankfurt', async () => {
    const { seen, fetcher } = recorder();
    const answer = await proxyBatch(
      batch('https://madar.vado.sa/api/batch?forceFunctionRegion=eu-central-1', { Authorization: 'Bearer abc', apikey: 'pk', 'X-Madar-Build': '2026.10.8' }),
      fetcher,
    );
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe('{"results":[]}');
    expect(seen[0].url).toBe(`${PRODUCTION}?forceFunctionRegion=eu-central-1`);
    expect(seen[0].method).toBe('POST');
    expect(await seen[0].text()).toBe(BODY);
    expect(seen[0].headers.get('authorization')).toBe('Bearer abc');
    expect(seen[0].headers.get('apikey')).toBe('pk');
    expect(seen[0].headers.get('x-madar-build')).toBe('2026.10.8');
    expect(seen[0].headers.get('content-type')).toBe('application/json');
    expect(seen[0].headers.get('x-region')).toBe('eu-central-1');

    await proxyBatch(batch('https://preview.madar-46r.pages.dev/api/batch'), fetcher);
    expect(seen[1].url).toBe(TEST);
  });

  it('drops the headers of Cloudflare, of the client address and the cookies of the page host', async () => {
    const { seen, fetcher } = recorder();
    await proxyBatch(batch('https://madar.vado.sa/api/batch', {
      'cf-connecting-ip': '1.2.3.4', 'cf-ray': 'x', 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '1.2.3.4', 'true-client-ip': '1.2.3.4',
      'x-madar-hop': 'forged', 'accept-encoding': 'gzip', cookie: 'a=b',
    }), fetcher);
    for (const name of ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-real-ip', 'true-client-ip', 'x-madar-hop', 'accept-encoding', 'cookie']) {
      expect(seen[0].headers.has(name), name).toBe(false);
    }
  });

  it('gives back the status, Retry-After and the body of Supabase, without encoding headers or cookies', async () => {
    const { fetcher } = recorder(new Response('{"error":"rate_limited"}', {
      status: 429,
      headers: { 'retry-after': '30', 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '24', 'set-cookie': 'x=y' },
    }));
    const answer = await proxyBatch(batch('https://madar.vado.sa/api/batch'), fetcher);
    expect(answer.status).toBe(429);
    expect(answer.headers.get('retry-after')).toBe('30');
    expect(answer.headers.has('content-encoding')).toBe(false);
    expect(answer.headers.has('set-cookie')).toBe(false);
    expect(await answer.text()).toBe('{"error":"rate_limited"}');
  });

  it('refuses any other host or path with 404, and any other method with 405, so it never forwards for a stranger', async () => {
    const { seen, fetcher } = recorder();
    expect((await proxyBatch(batch('https://abc123.madar-46r.pages.dev/api/batch'), fetcher)).status).toBe(404);
    expect((await proxyBatch(batch('https://evil.example/api/batch'), fetcher)).status).toBe(404);
    for (const path of ['/api/batchx', '/api/batch/', '/api/auth/forgot', '/api/auth/renew-invite', '/api/health', '/api/batch/%2e%2e/auth/forgot']) {
      expect((await proxyBatch(batch(`https://madar.vado.sa${path}`), fetcher)).status, path).toBe(404);
    }
    const get = await proxyBatch(new Request('https://madar.vado.sa/api/batch'), fetcher);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect((await proxyBatch(new Request('https://madar.vado.sa/api/batch', { method: 'OPTIONS' }), fetcher)).status).toBe(405);
    expect(seen).toHaveLength(0);
  });
});
