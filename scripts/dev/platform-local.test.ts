import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileOf, headersOf, isPlatformRoute, platformLocalServer } from './platform-local';

const HEADERS = '# a comment\n/*\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src \'self\'; connect-src \'self\'\n\n/assets/*\n  Cache-Control: immutable\n';

function site(): string {
  const root = mkdtempSync(join(tmpdir(), 'platform-local-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<html>site</html>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(root, '_headers'), HEADERS);
  return root;
}

describe('the local platform site (scripts/dev/platform-local.ts)', () => {
  let open: ReturnType<typeof platformLocalServer> | null = null;
  afterEach(() => open?.close());
  const start = async (fetchFn: typeof fetch): Promise<string> => {
    open = platformLocalServer({ root: site(), upstream: 'http://office.test:8792', fetch: fetchFn });
    await new Promise<void>((resolve) => open!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(open!.address() as AddressInfo).port}`;
  };

  it('names the platform routes: /api/platform and below, nothing else', () => {
    for (const path of ['/api/platform', '/api/platform/auth/token']) expect(isPlatformRoute(path)).toBe(true);
    for (const path of ['/api/platformx', '/api/batch', '/', '/assets/app.js']) expect(isPlatformRoute(path)).toBe(false);
  });

  it('reads only the /* block of the headers file', () => {
    expect(headersOf(HEADERS)).toEqual([['X-Frame-Options', 'DENY'], ['Content-Security-Policy', "default-src 'self'; connect-src 'self'"]]);
  });

  it('gives no file outside the folder', () => {
    const root = site();
    expect(fileOf(root, '/../../etc/passwd')).toBeNull();
    expect(fileOf(root, '/assets/app.js')).toBe(join(root, 'assets', 'app.js'));
  });

  it('serves the page with the headers, and the page for an unknown path without a dot', async () => {
    const base = await start((() => Promise.reject(new Error('no upstream call'))) as unknown as typeof fetch);
    const home = await fetch(`${base}/`);
    expect(await home.text()).toBe('<html>site</html>');
    expect(home.headers.get('x-frame-options')).toBe('DENY');
    expect(await (await fetch(`${base}/anything`)).text()).toBe('<html>site</html>');
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
  });

  it('hands /api/platform to the upstream with the method, the bearer header, the query and the body, and gives the answer back', async () => {
    const seen: { url: string; method: string; auth: string | null; body: string }[] = [];
    const base = await start((async (input: URL, init: RequestInit) => {
      seen.push({ url: String(input), method: String(init.method), auth: new Headers(init.headers).get('authorization'), body: Buffer.from(init.body as Buffer).toString() });
      return new Response('{"v":1}', { status: 401, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch);
    const answer = await fetch(`${base}/api/platform/auth/token?x=1`, { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: '{"a":1}' });
    expect(answer.status).toBe(401);
    expect(await answer.text()).toBe('{"v":1}');
    expect(seen).toEqual([{ url: 'http://office.test:8792/api/platform/auth/token?x=1', method: 'POST', auth: 'Bearer t', body: '{"a":1}' }]);
  });

  it('answers 502 when the upstream fails', async () => {
    const base = await start((() => Promise.reject(new Error('down'))) as unknown as typeof fetch);
    expect((await fetch(`${base}/api/platform`, { method: 'POST', body: '{}' })).status).toBe(502);
  });
});
