import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api/errors';
import { setEnvSource } from '../env';
import { browserTokenChecker, verifyBrowserToken } from './verify';

/**
 * The browser token check (plan 5.1; plan section 2, change 6; proof.md Z0a item 2). Real ES256 keys and real tokens,
 * checked by jose against a key set, as the api function does against the JWKS of Supabase Auth.
 */

const SUPABASE_URL = 'https://ref.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const MCP_AUD = `${SUPABASE_URL}/functions/v1/mcp`;
const SUB = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

type Key = { privateKey: CryptoKey; jwk: JWK };
let good: Key;
let other: Key;
let jwks: { keys: JWK[] };

async function makeKey(kid: string): Promise<Key> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  return { privateKey, jwk };
}

beforeAll(async () => {
  good = await makeKey('key-good');
  other = await makeKey('key-other');
  jwks = { keys: [good.jwk] };
});

afterEach(() => {
  setEnvSource(undefined);
  vi.unstubAllGlobals();
});

/** The claims of a person's token, as Supabase Auth gives them after a password sign-in (aud is an array there). */
function claims(extra: JWTPayload = {}): JWTPayload {
  return { sub: SUB, role: 'authenticated', aud: ['authenticated'], email: 'sara@madar.test', session_id: 's1', ...extra };
}

async function token(payload: JWTPayload = claims(), o: { key?: Key; iss?: string; exp?: number | string } = {}): Promise<string> {
  const key = o.key ?? good;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', kid: key.jwk.kid, typ: 'JWT' })
    .setIssuer(o.iss ?? ISSUER)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? '1h')
    .sign(key.privateKey);
}

/** An HS256 token, as the legacy JWT secret signs it: never accepted, whatever its claims. */
async function hsToken(payload: JWTPayload = claims()): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode('super-secret-jwt-token-with-at-least-32-characters-long'));
}

const check = () => browserTokenChecker({ issuer: ISSUER, jwks: createLocalJWKSet(jwks) });

async function refusal(work: Promise<unknown>): Promise<ApiError> {
  const error = await work.then(() => null, (e: unknown) => e);
  if (!(error instanceof ApiError)) throw new Error(`It did not refuse with an ApiError: ${String(error)}`);
  return error;
}

describe('browserTokenChecker (plan 5.1)', () => {
  it('passes a good token after a password sign-in, where aud is an array', async () => {
    await expect(check()(`Bearer ${await token()}`)).resolves.toEqual({ authUserId: SUB });
  });

  it('passes a good token after a refresh, where aud is a string (proof.md Z0a item 2)', async () => {
    await expect(check()(`Bearer ${await token(claims({ aud: 'authenticated' }))}`)).resolves.toEqual({ authUserId: SUB });
  });

  it('accepts the scheme in any letter case', async () => {
    await expect(check()(`bearer ${await token()}`)).resolves.toEqual({ authUserId: SUB });
  });

  it('refuses a token with the wrong issuer', async () => {
    const error = await refusal(check()(`Bearer ${await token(claims(), { iss: 'https://other.supabase.co/auth/v1' })}`));
    expect(error.code).toBe('unauthenticated');
  });

  it('refuses an expired token', async () => {
    const error = await refusal(check()(`Bearer ${await token(claims(), { exp: Math.floor(Date.now() / 1000) - 60 })}`));
    expect(error.code).toBe('unauthenticated');
    expect(error.details).toMatchObject({ reason: 'token_expired' });
  });

  it('refuses an agent token (client_id) with 403, also when its aud is still "authenticated"', async () => {
    for (const aud of [['authenticated'], 'authenticated', MCP_AUD]) {
      const error = await refusal(check()(`Bearer ${await token(claims({ aud, client_id: 'client-1' }))}`));
      expect(error.code).toBe('forbidden');
      expect(error.details).toMatchObject({ reason: 'agent_token' });
    }
  });

  it('refuses a token for another audience', async () => {
    for (const aud of [MCP_AUD, ['other'], 'authenticated-not']) {
      const error = await refusal(check()(`Bearer ${await token(claims({ aud }))}`));
      expect(error.code).toBe('unauthenticated');
    }
  });

  it('refuses a token that a key outside the key set signed', async () => {
    const error = await refusal(check()(`Bearer ${await token(claims(), { key: other })}`));
    expect(error.code).toBe('unauthenticated');
  });

  it('refuses an HS256 token, so the legacy JWT secret never signs a sign-in (proof.md Z0a item 1)', async () => {
    const error = await refusal(check()(`Bearer ${await hsToken()}`));
    expect(error.code).toBe('unauthenticated');
  });

  it('refuses a token whose role is not "authenticated", or that has no sub', async () => {
    for (const payload of [claims({ role: 'service_role' }), claims({ role: 'anon' }), claims({ sub: undefined }), claims({ sub: '' })]) {
      const error = await refusal(check()(`Bearer ${await token(payload)}`));
      expect(error.code).toBe('unauthenticated');
    }
  });

  it('refuses a missing or broken header before any key lookup', async () => {
    const lookup = vi.fn(createLocalJWKSet(jwks));
    const checker = browserTokenChecker({ issuer: ISSUER, jwks: lookup });
    for (const header of [null, '', 'Bearer', 'Bearer ', 'Basic abc', `Token ${await token()}`, 'Bearer not.a.token', 'Bearer a b']) {
      const error = await refusal(checker(header));
      expect(error.code).toBe('unauthenticated');
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('gives failed, not unauthenticated, when the key set cannot load, so a JWKS outage never signs a person out', async () => {
    const down = browserTokenChecker({ issuer: ISSUER, jwks: async () => { throw new TypeError('fetch failed'); } });
    const error = await refusal(down(`Bearer ${await token()}`));
    expect(error.code).toBe('failed');
    expect(error.details).toMatchObject({ reason: 'token_check_unavailable' });
  });
});

describe('verifyBrowserToken (the api function: the JWKS of SUPABASE_URL)', () => {
  function serveJwks() {
    const fetchJwks = vi.fn(async (_url: string | URL | Request) => Response.json(jwks));
    vi.stubGlobal('fetch', fetchJwks);
    return fetchJwks;
  }

  it('checks against the JWKS and the issuer of SUPABASE_URL', async () => {
    const fetchJwks = serveJwks();
    setEnvSource({ SUPABASE_URL: `${SUPABASE_URL}/` });
    await expect(verifyBrowserToken(`Bearer ${await token()}`)).resolves.toEqual({ authUserId: SUB });
    expect(String(fetchJwks.mock.calls[0][0])).toBe(`${ISSUER}/.well-known/jwks.json`);
    const error = await refusal(verifyBrowserToken(`Bearer ${await token(claims(), { iss: 'http://127.0.0.1:54321/auth/v1' })}`));
    expect(error.code).toBe('unauthenticated');
  });

  it('takes the issuer from AUTH_ISSUER when set (a local function sees SUPABASE_URL http://kong:8000)', async () => {
    const fetchJwks = serveJwks();
    setEnvSource({ SUPABASE_URL: 'http://kong:8000', AUTH_ISSUER: 'http://127.0.0.1:54321/auth/v1' });
    await expect(verifyBrowserToken(`Bearer ${await token(claims(), { iss: 'http://127.0.0.1:54321/auth/v1' })}`)).resolves.toEqual({ authUserId: SUB });
    expect(String(fetchJwks.mock.calls[0][0])).toBe('http://kong:8000/auth/v1/.well-known/jwks.json');
  });

  it('stops with a plain error that names SUPABASE_URL when it is missing', async () => {
    setEnvSource({});
    const proc = process.env.SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    try {
      const error = await verifyBrowserToken(`Bearer ${await token()}`).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ApiError);
      expect((error as Error).message).toContain('SUPABASE_URL');
    } finally {
      if (proc !== undefined) process.env.SUPABASE_URL = proc;
    }
  });
});
