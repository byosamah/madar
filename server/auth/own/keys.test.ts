import { afterEach, describe, expect, it } from 'vitest';
import { setEnvSource } from '../../env';
import { agentTokenChecker, agentTokenCheckerOf } from '../../mcp/auth';
import { ACCESS_TTL_S, OWN_AUTH_SECRET, ownIssuer, ownKeySet, ownPublicJwks } from '../ownKeys';
import { browserTokenChecker, verifyBrowserToken } from '../verify';
import { signAgentToken, signBrowserToken, signingKeysOf } from './keys';
import { testPrivateJwk } from './testKeys';

const MCP_URL = 'https://madar.test/mcp';
const NOW = new Date('2026-10-17T06:00:00Z');

afterEach(() => setEnvSource(undefined));

describe('the own tokens (server/auth/own/keys.ts, server/auth/ownKeys.ts)', () => {
  it('signs a browser token that the browser check of today accepts, with the own issuer and key set', async () => {
    const jwk = await testPrivateJwk();
    const keys = await signingKeysOf(jwk, `${MCP_URL}/`);
    const token = await signBrowserToken(keys, { authId: 'a-1', sessionId: 's-1', now: new Date() });
    const check = browserTokenChecker({ issuer: ownIssuer(MCP_URL), jwks: ownKeySet(jwk) });
    expect(await check(`Bearer ${token}`)).toEqual({ authUserId: 'a-1', sessionId: 's-1' });
  });

  it('gives a token of 15 minutes', async () => {
    const keys = await signingKeysOf(await testPrivateJwk(), MCP_URL);
    const token = await signBrowserToken(keys, { authId: 'a-1', sessionId: 's-1', now: NOW });
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    expect(claims.exp - claims.iat).toBe(ACCESS_TTL_S);
    expect(ACCESS_TTL_S).toBe(900);
    expect(claims).toMatchObject({ iss: MCP_URL, aud: 'authenticated', sub: 'a-1', role: 'authenticated', session_id: 's-1' });
  });

  it('keeps the two token kinds apart', async () => {
    const jwk = await testPrivateJwk();
    const keys = await signingKeysOf(jwk, MCP_URL);
    const agent = await signAgentToken(keys, { authId: 'a-1', sessionId: 's-2', clientId: 'c-1', now: new Date() });
    const browser = await signBrowserToken(keys, { authId: 'a-1', sessionId: 's-1', now: new Date() });
    await expect(browserTokenChecker({ issuer: MCP_URL, jwks: ownKeySet(jwk) })(`Bearer ${agent}`)).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'agent_token' } });
    const agents = agentTokenChecker({ issuer: MCP_URL, audience: MCP_URL, jwks: ownKeySet(jwk) });
    expect(await agents(`Bearer ${agent}`)).toMatchObject({ authUserId: 'a-1', clientId: 'c-1', sessionId: 's-2' });
    await expect(agents(`Bearer ${browser}`)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('refuses a token of another key', async () => {
    const keys = await signingKeysOf(await testPrivateJwk(), MCP_URL);
    const token = await signBrowserToken(keys, { authId: 'a-1', sessionId: 's-1', now: new Date() });
    await expect(browserTokenChecker({ issuer: MCP_URL, jwks: ownKeySet(await testPrivateJwk()) })(`Bearer ${token}`)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('serves only the public part of the key', async () => {
    const jwks = ownPublicJwks(await testPrivateJwk());
    expect(jwks.keys).toHaveLength(1);
    expect(Object.keys(jwks.keys[0]).sort()).toEqual(['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y']);
    expect(JSON.stringify(jwks)).not.toContain('"d"');
  });

  it('names the secret, never its value, when the key is wrong', () => {
    expect(() => ownPublicJwks('{"kty":"RSA"}')).toThrow(`${OWN_AUTH_SECRET} must be a P-256 private JWK with a kid.`);
    expect(() => ownPublicJwks('not json')).toThrow(`${OWN_AUTH_SECRET} is not JSON.`);
  });

  it('checks a token with the own key when the Worker has the secret, and with Supabase when it has not', async () => {
    const jwk = await testPrivateJwk();
    const keys = await signingKeysOf(jwk, MCP_URL);
    const token = await signBrowserToken(keys, { authId: 'a-9', sessionId: 's-9', now: new Date() });
    setEnvSource({ [OWN_AUTH_SECRET]: jwk, MCP_URL, SUPABASE_URL: 'http://127.0.0.1:54321' });
    expect(await verifyBrowserToken(`Bearer ${token}`)).toEqual({ authUserId: 'a-9', sessionId: 's-9' });
    const agent = await signAgentToken(keys, { authId: 'a-9', sessionId: 's-8', clientId: 'c-9', now: new Date() });
    expect(await agentTokenCheckerOf({ supabaseUrl: 'http://127.0.0.1:54321', mcpUrl: MCP_URL })(`Bearer ${agent}`)).toMatchObject({ clientId: 'c-9' });
  });
});
