import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from 'jose';
import { COPY_HOSTS, type Copy } from '../core/serverHost';
import { ESRI_REFERER, IMAGERY, ownIssuerOf, satelliteTile } from './pagesSatellite';

const KEY = 'AAPTxy_test-key.0123456789abcdefghij';
const PICTURE = new Uint8Array([255, 216, 255, 1, 2, 3]);
let keySet: JWTVerifyGetKey;
let signer: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  signer = pair.privateKey;
  keySet = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'k1' }] });
});

/** A token of Supabase Auth of one copy, as the browser holds it. */
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

/** A fake Esri: each call takes the next answer of the list. */
function esri(...answers: (Response | Error)[]) {
  const run = vi.fn(async () => {
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    return next;
  });
  return run as unknown as typeof fetch & typeof run;
}
const picture = () => new Response(PICTURE, { status: 200, headers: { 'content-type': 'image/jpeg' } });

async function ask(path: string, o: { host?: string; bearer?: string | null; env?: Record<string, unknown>; run?: typeof fetch; method?: string; own?: (copy: Copy) => JWTVerifyGetKey | undefined } = {}) {
  const run = o.run ?? esri(picture());
  const headers: Record<string, string> = {};
  if (o.bearer) headers.authorization = `Bearer ${o.bearer}`;
  const request = new Request(`https://${o.host ?? 'madar.vado.sa'}${path}`, { method: o.method ?? 'GET', headers });
  const response = await satelliteTile(request, o.env ?? { ESRI_KEY: KEY }, { fetch: run, keySet: () => keySet, ...(o.own ? { ownKeySet: o.own } : {}) });
  return { response, run: run as unknown as ReturnType<typeof vi.fn> };
}

describe('the satellite tile route (owner, 2026-10-20)', () => {
  it('gives a signed-in person one Esri tile: the server adds the key and the referrer, and the browser keeps the tile for a day', async () => {
    const { response, run } = await ask('/satellite/16/27610/43530', { bearer: await token('production') });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PICTURE);
    expect(run).toHaveBeenCalledTimes(1);
    const [url, init] = run.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${IMAGERY}/tile/16/27610/43530?token=${KEY}`);
    expect(new Headers(init.headers).get('referer')).toBe(ESRI_REFERER);
  });

  it('serves the test copy with a token of the test copy', async () => {
    const { response } = await ask('/satellite/3/2/5', { host: 'preview.madar-46r.pages.dev', bearer: await token('test') });
    expect(response.status).toBe(200);
  });

  it('answers 404 on any other host, so it is never an open way to Esri', async () => {
    const { response, run } = await ask('/satellite/3/2/5', { host: 'evil.example', bearer: await token('production') });
    expect(response.status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a request with no token, a bad token, a token of the other copy or an agent token, and asks Esri nothing', async () => {
    const cases = [null, 'not.a.token', await token('test'), await token('production', { client_id: 'agent-1' }), await token('production', { role: 'anon' })];
    for (const bearer of cases) {
      const { response, run } = await ask('/satellite/3/2/5', { bearer });
      expect(response.status).toBe(401);
      expect(run).not.toHaveBeenCalled();
    }
  });

  it('refuses a tile outside the map, a zoom over 19, a path with more parts and every method but GET', async () => {
    const bearer = await token('production');
    for (const path of ['/satellite/20/1/1', '/satellite/3/8/1', '/satellite/3/1/8', '/satellite/a/1/1', '/satellite/3/1/1/2', '/satellite/3/1/1?x=1']) {
      const { response, run } = await ask(path, { bearer });
      expect([400, 404]).toContain(response.status);
      expect(run).not.toHaveBeenCalled();
    }
    expect((await ask('/satellite/3/1/1', { bearer, method: 'POST' })).response.status).toBe(405);
  });

  it('says no_map with no key or a key of a wrong shape, and asks Esri nothing', async () => {
    const bearer = await token('production');
    for (const env of [{}, { ESRI_KEY: 'short' }, { ESRI_KEY: `${KEY}&f=json` }]) {
      const { response, run } = await ask('/satellite/3/1/1', { bearer, env });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'no_map' });
      expect(run).not.toHaveBeenCalled();
    }
  });

  it('never passes an Esri error on: a JSON answer with status 200 (a bad key) is a 502 that does not name the key', async () => {
    const run = esri(new Response(`{"error":{"code":498,"message":"Invalid token ${KEY}"}}`, { status: 200, headers: { 'content-type': 'application/json' } }));
    const { response } = await ask('/satellite/3/1/1', { bearer: await token('production'), run });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(KEY);
  });

  it('gives a 5xx or a broken connection one more try, and passes a 404 of Esri on as no_tile', async () => {
    const bearer = await token('production');
    const retried = await ask('/satellite/3/1/1', { bearer, run: esri(new Response('', { status: 503 }), picture()) });
    expect(retried.response.status).toBe(200);
    expect(retried.run).toHaveBeenCalledTimes(2);
    const broken = await ask('/satellite/3/1/1', { bearer, run: esri(new Error('reset'), new Error('reset')) });
    expect(broken.response.status).toBe(502);
    expect(broken.run).toHaveBeenCalledTimes(2);
    const none = await ask('/satellite/3/1/1', { bearer, run: esri(new Response('', { status: 404 })) });
    expect(none.response.status).toBe(404);
    expect(await none.response.json()).toEqual({ error: 'no_tile' });
  });
});

describe('the satellite tile route with the own key (a copy on the office object)', () => {
  let ownSigner: CryptoKey;
  let ownSet: JWTVerifyGetKey;
  let otherSigner: CryptoKey;

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256');
    ownSigner = pair.privateKey;
    ownSet = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'own1' }] });
    otherSigner = (await generateKeyPair('ES256')).privateKey;
  });

  /** An own token as the office object signs it: the issuer is the MCP address of the page host of the copy. */
  async function own(copy: Copy, o: { claims?: Record<string, unknown>; audience?: string; expires?: string; signer?: CryptoKey; role?: string | null } = {}): Promise<string> {
    const claims: Record<string, unknown> = { ...(o.role === null ? {} : { role: o.role ?? 'authenticated' }), ...o.claims };
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: 'own1' })
      .setIssuer(ownIssuerOf(copy))
      .setAudience(o.audience ?? 'authenticated')
      .setSubject('auth-user-1')
      .setIssuedAt(o.expires === '-1m' ? Math.floor(Date.now() / 1000) - 3600 : undefined)
      .setExpirationTime(o.expires ?? '10m')
      .sign(o.signer ?? ownSigner);
  }
  const withOwn = (copy: Copy) => (c: Copy) => (c === copy ? ownSet : undefined);

  it('uses the page host of the copy for the own issuer', () => {
    expect(ownIssuerOf('production')).toBe('https://madar.vado.sa/mcp');
    expect(ownIssuerOf('test')).toBe('https://preview.madar-46r.pages.dev/mcp');
  });

  it('gives a signed-in person of an office copy one tile', async () => {
    const { response, run } = await ask('/satellite/16/27610/43530', { bearer: await own('production'), own: withOwn('production') });
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses an own token when the copy does not run on its office object, and asks Esri nothing', async () => {
    const { response, run } = await ask('/satellite/3/2/5', { bearer: await own('production'), own: () => undefined });
    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
    // With no ownKeySet in the deps the own issuer has no key set either.
    const none = await ask('/satellite/3/2/5', { bearer: await own('production') });
    expect(none.response.status).toBe(401);
  });

  it('refuses an agent token, a token of the other copy, an expired token, a wrong audience, no role, and a token of another key', async () => {
    const cases = [
      await own('production', { claims: { client_id: 'agent-1' } }),
      await own('test'),
      await own('production', { expires: '-1m' }),
      await own('production', { audience: 'https://madar.vado.sa/mcp' }),
      await own('production', { role: null }),
      await own('production', { signer: otherSigner }),
    ];
    for (const bearer of cases) {
      const { response, run } = await ask('/satellite/3/2/5', { bearer, own: withOwn('production') });
      expect(response.status).toBe(401);
      expect(run).not.toHaveBeenCalled();
    }
  });

  it('refuses a token with another issuer, even a good signature of the own key', async () => {
    const token = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: 'own1' }).setIssuer('https://evil.example/mcp')
      .setAudience('authenticated').setSubject('auth-user-1').setIssuedAt().setExpirationTime('10m').sign(ownSigner);
    const { response, run } = await ask('/satellite/3/2/5', { bearer: token, own: withOwn('production') });
    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('answers 503 when the own key set does not load, and asks Esri nothing', async () => {
    const broken = (() => { throw new Error('The own key set of the Worker did not load.'); }) as unknown as JWTVerifyGetKey;
    const { response, run } = await ask('/satellite/3/2/5', { bearer: await own('production'), own: () => broken });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'sign_in_check_failed' });
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps the Supabase token working on the same route', async () => {
    const { response } = await ask('/satellite/3/2/5', { bearer: await token('production'), own: withOwn('production') });
    expect(response.status).toBe(200);
  });
});
