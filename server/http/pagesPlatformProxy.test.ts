import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COPY_HOSTS, PAGE_HOSTS, PLATFORM_HOSTS, copyOfPageHost, copyOfPlatformHost } from '../core/serverHost';
import { proxyApi } from './pagesApiProxy';
import { proxyPlatform } from './pagesPlatformProxy';

/** The Pages project madar-platform (design 12, D7): the site Madar enterprises hands its /api/platform calls to the Worker of its copy. */
function recorder(answer: () => Response = () => Response.json({ v: 1, results: [] }, { headers: { 'x-madar-server': 'office' } })) {
  const seen: Request[] = [];
  return { seen, binding: { fetch: async (request: Request) => { seen.push(new Request(request)); return answer(); } } };
}

function setup() {
  const test = recorder();
  const production = recorder();
  const lines: string[] = [];
  const env = { MADAR_SERVER_TEST: test.binding, MADAR_SERVER_PRODUCTION: production.binding };
  return { test, production, lines, env, call: (request: Request, e: Record<string, unknown> = env) => proxyPlatform(request, e, { log: (line) => void lines.push(line) }) };
}

const post = (host: string, path = '/api/platform', init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request(`https://${host}${path}`, { method: 'POST', body: '{"v":1,"calls":[]}', ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });

describe('the hosts of the platform site', () => {
  it('are the three addresses of design 12 (D7), each with its copy', () => {
    expect(PLATFORM_HOSTS).toEqual({ 'preview.madar-platform-d6c.pages.dev': 'test', 'madar-platform-d6c.pages.dev': 'production', 'platform.madar.vado.sa': 'production', 'www.platform.madar.vado.sa': 'production' });
  });

  it('are not hosts of a company page, and a company host is not a platform host', () => {
    for (const host of Object.keys(PLATFORM_HOSTS)) expect(copyOfPageHost(host), host).toBeUndefined();
    for (const host of Object.keys(PAGE_HOSTS)) expect(copyOfPlatformHost(host), host).toBeUndefined();
    expect(Object.keys(PLATFORM_HOSTS).filter((host) => host in PAGE_HOSTS)).toEqual([]);
  });

  it('know only an exact host: no look-alike, no deployment hash, no inherited name', () => {
    for (const host of ['evil.madar-platform-d6c.pages.dev', 'abc123.madar-platform-d6c.pages.dev', 'madar-platform-d6c.pages.dev.evil.test', 'toString', '__proto__', '', 'constructor']) {
      expect(copyOfPlatformHost(host), host).toBeUndefined();
    }
  });
});

describe('the platform forwarder', () => {
  it('hands the call to the Worker of its copy through the binding, with the path, the query, the method, the headers and the body', async () => {
    const h = setup();
    const answer = await h.call(post('preview.madar-platform-d6c.pages.dev', '/api/platform?x=1', { headers: { Authorization: 'Bearer abc', 'X-Madar-Build': '2026.11.8', 'cf-connecting-ip': '203.0.113.5' } }));
    expect(answer.status).toBe(200);
    expect(answer.headers.get('x-madar-server')).toBe('office');
    expect(await answer.json()).toEqual({ v: 1, results: [] });
    expect(h.production.seen).toEqual([]);
    const [seen] = h.test.seen;
    expect(seen.url).toBe('https://madar-server.internal/api/platform?x=1');
    expect(seen.method).toBe('POST');
    expect(await seen.text()).toBe('{"v":1,"calls":[]}');
    expect(seen.headers.get('authorization')).toBe('Bearer abc');
    expect(seen.headers.get('x-madar-build')).toBe('2026.11.8');
    expect(seen.headers.get('x-madar-client-address')).toBe('203.0.113.5');
  });

  it('hands the sign-in, refresh and logout routes under /api/platform/auth on to the Worker', async () => {
    const h = setup();
    for (const path of ['/api/platform/auth/token', '/api/platform/auth/logout']) {
      expect((await h.call(post('preview.madar-platform-d6c.pages.dev', path))).status, path).toBe(200);
    }
    expect(h.test.seen.map((request) => new URL(request.url).pathname)).toEqual(['/api/platform/auth/token', '/api/platform/auth/logout']);
  });

  it('sends a production host to the production binding and never to the test binding', async () => {
    const h = setup();
    for (const host of ['madar-platform-d6c.pages.dev', 'platform.madar.vado.sa', 'www.platform.madar.vado.sa']) expect((await h.call(post(host))).status, host).toBe(200);
    expect(h.production.seen).toHaveLength(3);
    expect(h.test.seen).toEqual([]);
  });

  it('writes the client address from cf-connecting-ip only: a header from the client is dropped, and so are the cf-* and forwarded headers', async () => {
    const h = setup();
    await h.call(post('madar-platform-d6c.pages.dev', '/api/platform', { headers: { 'x-madar-client-address': '10.0.0.1', 'x-forwarded-for': '10.0.0.2', 'cf-ray': 'abc', 'true-client-ip': '10.0.0.3', 'x-real-ip': '10.0.0.4' } }));
    const [seen] = h.production.seen;
    expect(seen.headers.has('x-madar-client-address')).toBe(false);
    for (const name of ['x-forwarded-for', 'cf-ray', 'true-client-ip', 'x-real-ip', 'host']) expect(seen.headers.has(name), name).toBe(false);
  });

  it('answers 404 for a company path: only /api/platform and the paths under it pass, and the Worker is never called', async () => {
    const h = setup();
    for (const path of ['/api/batch', '/api/office/export', '/api/live', '/api/auth/jwks', '/api', '/api/', '/mcp', '/mcp/vados', '/api/platformx', '/api/platform-x/y', '/', '/index.html', '/.well-known/oauth-authorization-server']) {
      const answer = await h.call(post('preview.madar-platform-d6c.pages.dev', path));
      expect(answer.status, path).toBe(404);
    }
    expect(h.test.seen).toEqual([]);
    expect(h.production.seen).toEqual([]);
  });

  it('answers 404 for a company host and for any other host, and the Worker is never called', async () => {
    const h = setup();
    for (const host of ['madar.vado.sa', 'www.madar.vado.sa', 'madar-46r.pages.dev', 'preview.madar-46r.pages.dev', 'workers.dev', 'evil.test', 'abc123.madar-platform-d6c.pages.dev']) {
      expect((await h.call(post(host))).status, host).toBe(404);
    }
    expect(h.test.seen).toEqual([]);
    expect(h.production.seen).toEqual([]);
  });

  it('answers 404 for an encoded dot, an encoded slash and an encoded backslash (a raw backslash becomes a slash in the URL parser)', async () => {
    const h = setup();
    for (const path of ['/api/platform/%2e%2e/batch', '/api/platform/%2E%2e/x', '/api/platform/a%2fb', '/api/platform/a%5Cb']) {
      expect((await h.call(post('preview.madar-platform-d6c.pages.dev', path))).status, path).toBe(404);
    }
    expect(h.test.seen).toEqual([]);
  });

  it('answers 404 and logs one warning when the binding is missing, and never goes to Supabase', async () => {
    const h = setup();
    const answer = await h.call(post('preview.madar-platform-d6c.pages.dev'), {});
    expect(answer.status).toBe(404);
    expect(h.lines).toHaveLength(1);
    expect(JSON.parse(h.lines[0])).toMatchObject({ level: 'warn', copy: 'test', reason: 'binding_missing' });
    expect(h.lines[0]).not.toContain('supabase.co');
  });

  it('gives the status, the body and the headers of the Worker back, without the encoding headers', async () => {
    const wrong = recorder(() => new Response('{"error":{"code":"unauthenticated","reason":"invalid_credentials"}}', { status: 401, headers: { 'content-encoding': 'gzip', 'content-length': '9', 'retry-after': '30', 'x-madar-server': 'office' } }));
    const answer = await proxyPlatform(post('preview.madar-platform-d6c.pages.dev', '/api/platform/auth/token'), { MADAR_SERVER_TEST: wrong.binding }, { log: () => undefined });
    expect(answer.status).toBe(401);
    expect(answer.headers.get('retry-after')).toBe('30');
    expect(answer.headers.has('content-encoding')).toBe(false);
    expect(answer.headers.has('content-length')).toBe(false);
    expect(await answer.text()).toContain('invalid_credentials');
  });

  it('uses the binding name of the copy that the host table names', () => {
    expect(COPY_HOSTS.test.workers.binding).toBe('MADAR_SERVER_TEST');
    expect(COPY_HOSTS.production.workers.binding).toBe('MADAR_SERVER_PRODUCTION');
  });
});

describe('the company forwarder holds no door to the platform (design 12, D9)', () => {
  it('answers 404 for /api/platform and the paths under it on every company host, and never calls the Worker', async () => {
    const seen: Request[] = [];
    const binding = { fetch: async (request: Request) => { seen.push(request); return new Response('{}'); } };
    for (const host of Object.keys(PAGE_HOSTS)) {
      for (const path of ['/api/platform', '/api/platform/auth/token', '/api/platform/auth/logout']) {
        const answer = await proxyApi(new Request(`https://${host}${path}`, { method: 'POST', body: '{}' }), { MADAR_SERVER_TEST: binding, MADAR_SERVER_PRODUCTION: binding }, { setting: { test: 'office', production: 'office' }, log: () => undefined });
        expect(answer.status, `${host}${path}`).toBe(404);
      }
    }
    expect(seen).toEqual([]);
  });

  it('still hands a company path to the Worker', async () => {
    const seen: Request[] = [];
    const binding = { fetch: async (request: Request) => { seen.push(request); return new Response('{}'); } };
    await proxyApi(new Request('https://madar.vado.sa/api/batch', { method: 'POST', body: '{}' }), { MADAR_SERVER_PRODUCTION: binding }, { setting: { test: 'office', production: 'office' }, log: () => undefined });
    expect(seen).toHaveLength(1);
  });
});

describe('the Pages Function of the platform project', () => {
  it('is a one-line wrapper that passes the request and the env to the proxy', () => {
    const file = readFileSync(new URL('../../functions-platform/api/platform/[[path]].ts', import.meta.url), 'utf8');
    expect(file).toContain("from '../../../server/http/pagesPlatformProxy'");
    expect(file).toContain('proxyPlatform(request, env)');
    expect(file.split('\n').filter((line) => line.trim() !== '' && !line.trim().startsWith('//')).length).toBeLessThanOrEqual(3);
  });
});
