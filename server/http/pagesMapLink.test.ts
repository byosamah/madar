import { readFileSync } from 'node:fs';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { COPY_HOSTS, type Copy } from '../core/serverHost';
import { followShortLink, resolveMapLink } from './pagesMapLink';

/** A fake fetch. Each address answers a redirect to the next address, or a plain 200. */
function fakeFetch(chain: Record<string, string | number>) {
  const calls: string[] = [];
  const run = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const next = chain[url];
    if (typeof next === 'string') return new Response(null, { status: 302, headers: { location: next } });
    return new Response('page', { status: typeof next === 'number' ? next : 404 });
  });
  return { run: run as unknown as typeof fetch, calls };
}

const SHORT = 'https://maps.app.goo.gl/AbC123';
const LONG = 'https://www.google.com/maps/place/Corniche/@26.2834,50.2105,17z/data=!3d26.2834!4d50.2105';
const HOST = 'madar.vado.sa';

let keySet: JWTVerifyGetKey;
let signer: CryptoKey;
let good: string;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  signer = pair.privateKey;
  keySet = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'k1' }] });
  good = await token('production');
});

/** A token of Supabase Auth of one copy, as the browser holds it (the same check as the satellite tiles). */
async function token(copy: Copy, claims: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ role: 'authenticated', ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setIssuer(`${COPY_HOSTS[copy].supabaseUrl}/auth/v1`)
    .setAudience('authenticated')
    .setSubject('auth-user-1')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(signer);
}

/** A POST of the pin picker. bearer null sends no token. */
function post(body: unknown, headers: Record<string, string> = {}, o: { bearer?: string | null; host?: string } = {}): Request {
  const bearer = o.bearer === undefined ? good : o.bearer;
  return new Request(`https://${o.host ?? HOST}/maplink`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers },
  });
}

const resolve = (request: Request, run: typeof fetch, set: () => JWTVerifyGetKey = () => keySet) => resolveMapLink(request, {}, { fetch: run, keySet: set });

describe('followShortLink (PRJ-03)', () => {
  it('follows the redirect of a short link and stops at the Google Maps address, without opening it', async () => {
    const { run, calls } = fakeFetch({ [SHORT]: LONG });
    expect(await followShortLink(SHORT, run)).toBe(LONG);
    expect(calls).toEqual([SHORT]);
  });

  it('follows more than one redirect, and reads the address inside a consent page', async () => {
    const consent = `https://consent.google.com/m?continue=${encodeURIComponent(LONG)}&gl=NL`;
    const { run } = fakeFetch({ [SHORT]: 'https://goo.gl/maps/Zz9', 'https://goo.gl/maps/Zz9': consent });
    expect(await followShortLink(SHORT, run)).toBe(LONG);
  });

  it('refuses a redirect to a host outside the Google list, and never calls it', async () => {
    const { run, calls } = fakeFetch({ [SHORT]: 'https://evil.example/steal' });
    expect(await followShortLink(SHORT, run)).toBeNull();
    expect(calls).toEqual([SHORT]);
  });

  it('gives null after four redirects without an end, or when the link answers with no redirect', async () => {
    const loop = fakeFetch({ [SHORT]: 'https://goo.gl/maps/a', 'https://goo.gl/maps/a': 'https://goo.gl/maps/b', 'https://goo.gl/maps/b': 'https://goo.gl/maps/c', 'https://goo.gl/maps/c': 'https://goo.gl/maps/d', 'https://goo.gl/maps/d': 'https://goo.gl/maps/e' });
    expect(await followShortLink(SHORT, loop.run)).toBeNull();
    expect(await followShortLink(SHORT, fakeFetch({ [SHORT]: 200 }).run)).toBeNull();
  });

  it('gives null when the request fails', async () => {
    const run = (async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    expect(await followShortLink(SHORT, run)).toBeNull();
  });
});

// Review 2026-11-10 (finding 4): every request below carries the token of a signed-in person and a page host, as the pin picker sends it.
describe('resolveMapLink (PRJ-03)', () => {
  it('answers the long address of a short link, and never keeps the answer', async () => {
    const { run } = fakeFetch({ [SHORT]: LONG });
    const response = await resolve(post({ url: SHORT }, { 'sec-fetch-site': 'same-origin' }), run);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: LONG });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('accepts the old goo.gl/maps form', async () => {
    const { run } = fakeFetch({ 'https://goo.gl/maps/Zz9': LONG });
    expect((await resolve(post({ url: 'https://goo.gl/maps/Zz9' }), run)).status).toBe(200);
  });

  it('refuses any address that is not a short Google Maps link, and calls nothing', async () => {
    const { run, calls } = fakeFetch({});
    for (const url of ['https://evil.example/x', 'http://maps.app.goo.gl/AbC', 'https://maps.app.goo.gl.evil.example/AbC', 'https://goo.gl/other/Zz9', 'file:///etc/passwd', 'not a url', 42]) {
      const response = await resolve(post({ url }), run);
      expect(response.status, String(url)).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('answers only POST, and refuses a request from another site', async () => {
    const { run, calls } = fakeFetch({ [SHORT]: LONG });
    expect((await resolve(new Request(`https://${HOST}/maplink`), run)).status).toBe(405);
    expect((await resolve(post({ url: SHORT }, { 'sec-fetch-site': 'cross-site' }), run)).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('answers 502 when the link cannot be followed', async () => {
    const { run } = fakeFetch({ [SHORT]: 200 });
    const response = await resolve(post({ url: SHORT }), run);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'unreachable' });
  });

  it('refuses a body that is not JSON', async () => {
    const { run } = fakeFetch({});
    const bad = new Request(`https://${HOST}/maplink`, { method: 'POST', body: 'x{', headers: { authorization: `Bearer ${good}` } });
    expect((await resolve(bad, run)).status).toBe(400);
  });
});

describe('resolveMapLink answers only a signed-in person (review 2026-11-10, finding 4)', () => {
  it('a POST with no sec-fetch-site and no token gets 401, and opens no outside address', async () => {
    const { run, calls } = fakeFetch({ [SHORT]: LONG });
    const response = await resolve(post({ url: SHORT }, {}, { bearer: null }), run);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthenticated' });
    expect(calls).toEqual([]);
  });

  it('an old Safari with no sec-fetch-site and a good token still gets its long address', async () => {
    const { run } = fakeFetch({ [SHORT]: LONG });
    const response = await resolve(post({ url: SHORT }), run);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: LONG });
  });

  it('a good token from another site still gets 403', async () => {
    const { run, calls } = fakeFetch({ [SHORT]: LONG });
    expect((await resolve(post({ url: SHORT }, { 'sec-fetch-site': 'cross-site' }), run)).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('refuses a bad token, a token of the other copy, an agent token and a token with no person role, and opens nothing', async () => {
    const { run, calls } = fakeFetch({ [SHORT]: LONG });
    for (const bearer of ['not.a.token', await token('test'), await token('production', { client_id: 'agent-1' }), await token('production', { role: 'anon' })]) {
      expect((await resolve(post({ url: SHORT }, {}, { bearer }), run)).status).toBe(401);
    }
    expect(calls).toEqual([]);
  });

  it('answers 404 on a host that is not a page host of a copy, and 503 when the key set does not load', async () => {
    const { run, calls } = fakeFetch({ [SHORT]: LONG });
    expect((await resolve(post({ url: SHORT }, {}, { host: 'evil.example' }), run)).status).toBe(404);
    const down = (() => {
      throw new Error('the key set did not load');
    }) as unknown as () => JWTVerifyGetKey;
    const failed = await resolve(post({ url: SHORT }), run, down);
    expect([failed.status, await failed.json()]).toEqual([503, { error: 'sign_in_check_failed' }]);
    expect(calls).toEqual([]);
  });
});

describe('functions/maplink.ts', () => {
  it('is a one-line wrapper that passes the request and the Pages env', () => {
    const text = readFileSync(new URL('../../functions/maplink.ts', import.meta.url), 'utf8');
    expect(text).toContain("import { resolveMapLink } from '../server/http/pagesMapLink';");
    expect(text).toMatch(/export const onRequest = \(\{ request, env \}[^\n]*=> resolveMapLink\(request, env\);/);
  });
});
