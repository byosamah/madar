import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ServerHostSetting } from '../core/serverHost';
import { proxyApi } from './pagesApiProxy';

/** The page's own /api (owner, 2026-10-16): a Pages Function hands each call to the Worker of its copy through a service binding. */
const TEST_API = 'https://qdgwpnesxppnqsaabqzd.supabase.co/functions/v1/api';
const PRODUCTION_API = 'https://oprkvdjudjxxhvodkzgs.supabase.co/functions/v1/api';
const WORKERS: ServerHostSetting = { test: 'workers', production: 'workers' };
const SUPABASE: ServerHostSetting = { test: 'supabase', production: 'supabase' };

/** A fetch or a service binding that records the requests it gets and answers with the given response. */
function recorder(answer: () => Response = () => Response.json({ v: 1, results: [] }, { headers: { 'x-madar-server': 'workers;colo=FRA' } })) {
  const seen: Request[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init));
    return answer();
  }) as typeof globalThis.fetch;
  return { seen, fetch, binding: { fetch: (request: Request) => fetch(request) } };
}

function setup(o: { setting?: ServerHostSetting; env?: (b: { test: ReturnType<typeof recorder>; production: ReturnType<typeof recorder> }) => Record<string, unknown> } = {}) {
  const test = recorder();
  const production = recorder();
  const supabase = recorder(() => new Response('{"v":1}', { status: 401, headers: { 'x-madar-server': 'supabase', 'content-encoding': 'gzip', 'content-length': '7' } }));
  const lines: string[] = [];
  const env = o.env ? o.env({ test, production }) : { MADAR_SERVER_TEST: test.binding, MADAR_SERVER_PRODUCTION: production.binding };
  const call = (request: Request) => proxyApi(request, env, { fetch: supabase.fetch, setting: o.setting ?? WORKERS, log: (line) => void lines.push(line) });
  return { test, production, supabase, lines, call };
}

const batch = (host: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request(`https://${host}/api/batch?x=1`, { method: 'POST', body: '{"v":1,"calls":[]}', ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });

describe('the page api on the Worker (owner, 2026-10-16)', () => {
  it('hands each call to the Worker of its copy through the binding, with the path, the query, the method, the headers and the body', async () => {
    const h = setup();
    const answer = await h.call(batch('preview.madar-46r.pages.dev', { headers: { Authorization: 'Bearer abc', apikey: 'sb_publishable_x', 'X-Madar-Build': '2026.10.16', Origin: 'https://preview.madar-46r.pages.dev' } }));
    expect(answer.status).toBe(200);
    expect(answer.headers.get('x-madar-server')).toBe('workers;colo=FRA');
    expect(await answer.json()).toEqual({ v: 1, results: [] });
    const [seen] = h.test.seen;
    expect(seen.url).toBe('https://madar-server.internal/api/batch?x=1');
    expect(seen.method).toBe('POST');
    expect(await seen.text()).toBe('{"v":1,"calls":[]}');
    expect(seen.headers.get('authorization')).toBe('Bearer abc');
    expect(seen.headers.get('apikey')).toBe('sb_publishable_x');
    expect(seen.headers.get('x-madar-build')).toBe('2026.10.16');
    expect(seen.headers.get('origin')).toBe('https://preview.madar-46r.pages.dev');
    expect(seen.headers.has('x-region')).toBe(false);
    expect([h.production.seen, h.supabase.seen]).toEqual([[], []]);
  });

  it('forwards a GET with no body, and an OPTIONS preflight, also on the bare /api path', async () => {
    const h = setup();
    await h.call(new Request('https://madar.vado.sa/api/health'));
    await h.call(new Request('https://madar.vado.sa/api/batch', { method: 'OPTIONS', headers: { Origin: 'https://madar.vado.sa', 'Access-Control-Request-Method': 'POST' } }));
    await h.call(new Request('https://madar.vado.sa/api'));
    expect(h.production.seen.map((r) => [r.method, r.url])).toEqual([
      ['GET', 'https://madar-server.internal/api/health'],
      ['OPTIONS', 'https://madar-server.internal/api/batch'],
      ['GET', 'https://madar-server.internal/api'],
    ]);
    expect(h.production.seen[1].headers.get('access-control-request-method')).toBe('POST');
  });

  it('writes x-madar-client-address from cf-connecting-ip, and always replaces a value that the client sent', async () => {
    const h = setup();
    await h.call(batch('madar.vado.sa', { headers: { 'cf-connecting-ip': '203.0.113.7', 'x-madar-client-address': '10.0.0.1' } }));
    await h.call(batch('madar.vado.sa', { headers: { 'x-madar-client-address': '10.0.0.1' } }));
    expect(h.production.seen[0].headers.get('x-madar-client-address')).toBe('203.0.113.7');
    expect(h.production.seen[1].headers.has('x-madar-client-address')).toBe(false);
  });

  it('drops the headers of Cloudflare, of one connection and of other client addresses', async () => {
    const h = setup();
    await h.call(batch('madar.vado.sa', {
      headers: { 'cf-connecting-ip': '203.0.113.7', 'cf-ray': 'x', 'cf-ipcountry': 'SA', 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '1.2.3.4', 'true-client-ip': '1.2.3.4', 'x-madar-hop': 'forged', 'accept-encoding': 'gzip' },
    }));
    for (const name of ['cf-connecting-ip', 'cf-ray', 'cf-ipcountry', 'x-forwarded-for', 'x-real-ip', 'true-client-ip', 'x-madar-hop', 'accept-encoding']) {
      expect(h.production.seen[0].headers.has(name), name).toBe(false);
    }
  });

  it('sends each production host to the production Worker, and the test copy to the test Worker only', async () => {
    const h = setup();
    for (const host of ['madar.vado.sa', 'www.madar.vado.sa', 'madar-46r.pages.dev']) await h.call(batch(host));
    expect(h.production.seen).toHaveLength(3);
    expect(h.test.seen).toHaveLength(0);
    await h.call(batch('preview.madar-46r.pages.dev'));
    expect(h.test.seen).toHaveLength(1);
    expect(h.production.seen).toHaveLength(3);
  });

  it('never sends a production host to the test binding, also when the production binding is missing', async () => {
    const h = setup({ env: ({ test }) => ({ MADAR_SERVER_TEST: test.binding }) });
    await h.call(batch('madar.vado.sa'));
    expect(h.test.seen).toHaveLength(0);
    expect(h.supabase.seen.map((r) => new URL(r.url).origin)).toEqual(['https://oprkvdjudjxxhvodkzgs.supabase.co']);
  });

  it('gives back the answer as a stream, without the encoding headers that fetch already undid', async () => {
    const h = setup({ env: () => ({ MADAR_SERVER_PRODUCTION: { fetch: async () => new Response('done', { status: 202, headers: { 'content-encoding': 'gzip', 'content-length': '4', 'x-madar-server': 'workers;colo=FRA' } }) } }) });
    const answer = await h.call(batch('madar.vado.sa'));
    expect(answer.status).toBe(202);
    expect(answer.headers.has('content-encoding')).toBe(false);
    expect(answer.headers.has('content-length')).toBe(false);
    expect(await answer.text()).toBe('done');
  });

  it('gives the socket answer of the Worker back as it is, with the upgrade header passed on (exit wave 3)', async () => {
    const seen: Request[] = [];
    const upgraded = { status: 101, webSocket: {}, headers: new Headers() } as unknown as Response;
    const binding = { fetch: async (request: Request) => (seen.push(request), upgraded) };
    const request = new Request(`https://preview.madar-46r.pages.dev/api/live?ticket=${'a'.repeat(64)}`, { headers: { upgrade: 'websocket' } });
    const answer = await proxyApi(request, { MADAR_SERVER_TEST: binding }, { setting: { test: 'workers', production: 'supabase' } });
    expect(answer).toBe(upgraded);
    expect(seen[0].headers.get('upgrade')).toBe('websocket');
    expect(new URL(seen[0].url).pathname).toBe('/api/live');
  });
});

describe('the callback of Google Calendar (fbk_022)', () => {
  const callback = (host: string) => new Request(`https://${host}/api/google/callback?code=4%2F0AbC&state=signed.state`);
  const redirect = () => new Response(null, { status: 302, headers: { Location: 'https://madar.vado.sa/settings#google=finish&code=x', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });

  it('hands GET /api/google/callback to the Worker with its query, and gives the 302 and its Location back as they are', async () => {
    const production = recorder(redirect);
    const call = (request: Request) => proxyApi(request, { MADAR_SERVER_PRODUCTION: production.binding }, { setting: WORKERS });
    const answer = await call(callback('madar.vado.sa'));
    expect(answer.status).toBe(302);
    expect(answer.headers.get('location')).toBe('https://madar.vado.sa/settings#google=finish&code=x');
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(answer.headers.get('referrer-policy')).toBe('no-referrer');
    expect(production.seen[0].url).toBe('https://madar-server.internal/api/google/callback?code=4%2F0AbC&state=signed.state');
    expect(production.seen[0].method).toBe('GET');
  });

  it('hands it to the Supabase api function with its query and the region, and gives the 302 back, when the setting says supabase', async () => {
    const supabase = recorder(redirect);
    const answer = await proxyApi(callback('preview.madar-46r.pages.dev'), {}, { setting: SUPABASE, fetch: supabase.fetch, log: () => undefined });
    expect(answer.status).toBe(302);
    expect(answer.headers.get('location')).toContain('#google=finish');
    expect(supabase.seen[0].url).toBe(`${TEST_API}/google/callback?code=4%2F0AbC&state=signed.state&forceFunctionRegion=eu-central-1`);
    expect(supabase.seen[0].redirect).toBe('manual');
  });
});

describe('the way back to the Supabase api function', () => {
  it('forwards to the api function of the copy in Frankfurt when the setting says supabase, and logs it', async () => {
    const h = setup({ setting: SUPABASE });
    const answer = await h.call(batch('preview.madar-46r.pages.dev', { headers: { Authorization: 'Bearer abc' } }));
    expect(answer.status).toBe(401);
    expect(answer.headers.get('x-madar-server')).toBe('supabase');
    expect(answer.headers.has('content-encoding')).toBe(false);
    const [seen] = h.supabase.seen;
    expect(seen.url).toBe(`${TEST_API}/batch?x=1&forceFunctionRegion=eu-central-1`);
    expect(seen.headers.get('authorization')).toBe('Bearer abc');
    expect(await seen.text()).toBe('{"v":1,"calls":[]}');
    expect(h.test.seen).toEqual([]);
    expect(h.lines.map((line) => JSON.parse(line))).toEqual([{ level: 'info', message: 'The page api went to the Supabase api function.', copy: 'test', reason: 'setting' }]);
  });

  it('forwards to Supabase when the setting says workers but the binding is missing, and logs a warning', async () => {
    const h = setup({ env: () => ({}) });
    await h.call(batch('madar.vado.sa'));
    expect(h.supabase.seen[0].url).toBe(`${PRODUCTION_API}/batch?x=1&forceFunctionRegion=eu-central-1`);
    expect(JSON.parse(h.lines[0])).toEqual({ level: 'warn', message: 'The page api went to the Supabase api function.', copy: 'production', reason: 'binding_missing' });
  });

  it('counts a binding without fetch as missing', async () => {
    const h = setup({ env: () => ({ MADAR_SERVER_PRODUCTION: 'not a binding' }) });
    await h.call(batch('madar.vado.sa'));
    expect(h.supabase.seen).toHaveLength(1);
  });

  it('keeps a forceFunctionRegion that the screens sent, once', async () => {
    const h = setup({ setting: SUPABASE });
    await h.call(new Request('https://madar.vado.sa/api/batch?forceFunctionRegion=eu-central-1', { method: 'POST', body: '{}' }));
    expect(h.supabase.seen[0].url).toBe(`${PRODUCTION_API}/batch?forceFunctionRegion=eu-central-1`);
  });

  it('sends Supabase no client address header and no Cloudflare header, so Supabase (behind Cloudflare too) never refuses the call', async () => {
    const h = setup({ setting: SUPABASE });
    await h.call(batch('madar.vado.sa', { headers: { 'cf-connecting-ip': '203.0.113.7', 'x-madar-client-address': '10.0.0.1', 'cf-ray': 'x' } }));
    for (const name of ['cf-connecting-ip', 'x-madar-client-address', 'cf-ray']) expect(h.supabase.seen[0].headers.has(name), name).toBe(false);
  });
});

describe('the refusals of the page api', () => {
  it('refuses any other host and any path outside /api with 404, and calls nothing', async () => {
    const h = setup();
    for (const url of ['https://abc123.madar-46r.pages.dev/api/batch', 'https://evil.example/api/batch', 'https://madar.vado.sa/apix', 'https://madar.vado.sa/mcp', 'https://madar.vado.sa/']) {
      expect((await h.call(new Request(url, { method: 'POST', body: '{}' }))).status, url).toBe(404);
    }
    expect([h.test.seen, h.production.seen, h.supabase.seen]).toEqual([[], [], []]);
  });

  it('refuses encoded dots, encoded slashes and backslashes after /api, on both paths', async () => {
    for (const setting of [WORKERS, SUPABASE]) {
      const h = setup({ setting });
      for (const path of ['/api/%2e%2e%2fmcp', '/api/x%2Fy', '/api/x%5Cy', '/api/%2e%2e']) {
        expect((await h.call(new Request(`https://madar.vado.sa${path}`, { method: 'POST', body: '{}' }))).status, path).toBe(404);
      }
      expect([h.production.seen, h.supabase.seen]).toEqual([[], []]);
    }
  });
});

describe('functions/api/[[path]].ts', () => {
  it('is a one-line wrapper that passes the request and the Pages env', () => {
    const text = readFileSync(new URL('../../functions/api/[[path]].ts', import.meta.url), 'utf8');
    expect(text).toContain("import { proxyApi } from '../../server/http/pagesApiProxy';");
    expect(text).toMatch(/export const onRequest = \(\{ request, env \}[^\n]*=> proxyApi\(request, env\);/);
  });
});

describe('the office ops and the word office (exit wave 4)', () => {
  const binding = () => {
    const seen: string[] = [];
    return { seen, env: { MADAR_SERVER_TEST: { fetch: async (request: Request) => (seen.push(new URL(request.url).pathname), new Response('ok')) } } };
  };
  // A fetch that refuses, so a test that fails never reaches a real Supabase function.
  const noFetch = (async () => {
    throw new Error('This test sends nothing to a Supabase function.');
  }) as unknown as typeof fetch;

  it('sends /api to the Worker binding when the word is office', async () => {
    const b = binding();
    await proxyApi(new Request('https://preview.madar-46r.pages.dev/api/batch', { method: 'POST', body: '{}' }), b.env, { setting: { test: 'office', production: 'supabase' }, log: () => undefined, fetch: noFetch });
    expect(b.seen).toEqual(['/api/batch']);
  });

  it('sends /api/office/* to the Worker binding also when the word is supabase', async () => {
    const b = binding();
    await proxyApi(new Request('https://preview.madar-46r.pages.dev/api/office/export', { method: 'POST', body: '{}' }), b.env, { setting: { test: 'supabase', production: 'supabase' }, log: () => undefined, fetch: noFetch });
    expect(b.seen).toEqual(['/api/office/export']);
  });

  it('answers 404 for /api/office/* with no binding, and never sends it to the Supabase function', async () => {
    const calls: string[] = [];
    const response = await proxyApi(new Request('https://madar.vado.sa/api/office/export', { method: 'POST', body: '{}' }), {}, {
      setting: { test: 'supabase', production: 'supabase' }, log: () => undefined, fetch: (async (url: string) => (calls.push(url), new Response('x'))) as typeof fetch,
    });
    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it('keeps /api/officers and /api/office-x on the normal path: only /api/office and paths under it are ops', async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string) => (calls.push(new URL(url).pathname), new Response('x'))) as typeof fetch;
    for (const path of ['/api/officers', '/api/office-x']) {
      const response = await proxyApi(new Request(`https://madar.vado.sa${path}`, { method: 'POST', body: '{}' }), {}, { setting: { test: 'supabase', production: 'supabase' }, log: () => undefined, fetch: fetcher });
      expect(response.status).toBe(200);
    }
    expect(calls).toEqual(['/functions/v1/api/officers', '/functions/v1/api/office-x']);
  });
});
