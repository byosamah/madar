import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import { signAgentToken, signBrowserToken, signingKeysOf, signPlatformToken } from './own/keys';
import { testPrivateJwk } from './own/testKeys';
import { ownIssuer, ownKeySet } from './ownKeys';
import { isPlatformBearer, platformTokenChecker, browserTokenChecker } from './verify';

const MCP = 'https://madar.test/mcp';

async function setup() {
  const jwk = await testPrivateJwk();
  const keys = await signingKeysOf(jwk, MCP);
  const platform = platformTokenChecker({ issuer: ownIssuer(MCP), jwks: ownKeySet(jwk) });
  const company = browserTokenChecker({ issuer: ownIssuer(MCP), jwks: ownKeySet(jwk), requireEnt: true });
  return { keys, platform, company, now: new Date() };
}
const bearer = (token: string) => `Bearer ${token}`;
const refusal = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return error as { code: string; message: string };
  }
  throw new Error('The check did not refuse.');
};

describe('the platform token', () => {
  it('has the audience madar-platform, the account as sub, the session as sid, no ent and a life of 900 s', async () => {
    const { keys, now } = await setup();
    const claims = decodeJwt(await signPlatformToken(keys, { accountId: 'pla_001', sessionId: 's-1', now }));
    expect(claims).toMatchObject({ aud: 'madar-platform', sub: 'pla_001', sid: 's-1', iss: ownIssuer(MCP) });
    expect(claims.ent).toBeUndefined();
    expect((claims.exp as number) - (claims.iat as number)).toBe(900);
  });

  it('passes the platform check and gives the account and the session', async () => {
    const { keys, platform, now } = await setup();
    expect(await platform(bearer(await signPlatformToken(keys, { accountId: 'pla_007', sessionId: 's-9', now })))).toEqual({ accountId: 'pla_007', sessionId: 's-9' });
  });

  it('the platform check refuses a company token, an agent token, no token, and an expired token, all with the 401 of a bad token', async () => {
    const { keys, platform, now } = await setup();
    const browser = await signBrowserToken(keys, { authId: 'a-1', sessionId: 's-1', now, ent: 'ent_001' });
    const agent = await signAgentToken(keys, { authId: 'a-1', sessionId: 's-1', clientId: 'c-1', now, ent: 'ent_001' });
    const old = await signPlatformToken(keys, { accountId: 'pla_001', sessionId: 's-1', now: new Date(now.getTime() - 3_600_000) });
    for (const header of [bearer(browser), bearer(agent), null, 'Bearer nope', bearer(old)]) {
      expect(await refusal(platform(header))).toMatchObject({ code: 'unauthenticated' });
    }
    expect(await refusal(platform(bearer(browser)))).toMatchObject({ message: 'Sign in to continue.' });
  });

  it('the company check refuses a platform token', async () => {
    const { keys, company, now } = await setup();
    expect(await refusal(company(bearer(await signPlatformToken(keys, { accountId: 'pla_001', sessionId: 's-1', now }))))).toMatchObject({ code: 'unauthenticated' });
  });

  it('isPlatformBearer reads the audience only', async () => {
    const { keys, now } = await setup();
    expect(isPlatformBearer(bearer(await signPlatformToken(keys, { accountId: 'pla_001', sessionId: 's-1', now })))).toBe(true);
    expect(isPlatformBearer(bearer(await signBrowserToken(keys, { authId: 'a-1', sessionId: 's-1', now, ent: 'ent_001' })))).toBe(false);
    expect(isPlatformBearer(null)).toBe(false);
    expect(isPlatformBearer('Bearer a.b.c')).toBe(false);
  });
});
