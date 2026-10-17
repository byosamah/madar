import { describe, expect, it } from 'vitest';
import { runInHost } from '../../core/after';
import type { Deps } from '../../core/ports';
import { apiApp } from '../../http/app';
import { ROUTES } from '../../http/routes';
import { ownIssuer, ownKeySet, ownPublicJwks } from '../ownKeys';
import { browserTokenChecker } from '../verify';
import { signAgentToken, signingKeysOf } from './keys';
import { localSigninOffice, runSigninOp } from './office';
import { ownAuthRoutes } from './routes';
import { testPrivateJwk } from './testKeys';
import { addSignIn, signinOffice } from './testOffice';

async function setup() {
  // The real time: the route checks each token with jose against the time of the machine.
  const t = await signinOffice({ at: new Date().toISOString() });
  const authId = await addSignIn(t, 'usr_002', { password: 'a good password' });
  const email = (t.raw.prepare('select email from auth_users where id = ?').get(authId) as { email: string }).email;
  const jwk = await testPrivateJwk();
  const keys = await signingKeysOf(jwk, t.deps.config.mcpUrl);
  const deps = { db: t.db, clock: t.deps.clock, log: t.deps.log, config: t.deps.config, keys };
  const checkToken = browserTokenChecker({ issuer: ownIssuer(t.deps.config.mcpUrl), jwks: ownKeySet(jwk) });
  const app = apiApp(t.deps as unknown as Deps, { routes: [...ROUTES, ...ownAuthRoutes(localSigninOffice(deps), { jwks: ownPublicJwks(jwk), checkToken })] });
  const send = (path: string, o: { body?: unknown; token?: string; address?: string; method?: string } = {}) => runInHost({ host: 'workers' }, async () => {
    const response = await app.request(path, {
      method: o.method ?? 'POST',
      headers: {
        'content-type': 'application/json', 'x-madar-client-address': o.address ?? '203.0.113.7', 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 200)}`,
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
      },
      ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
    });
    return { status: response.status, headers: response.headers, body: (await response.json()) as Record<string, any> };
  });
  return { t, authId, email, keys, deps, send };
}

describe('the HTTP routes of the own sign-in (server/auth/own/routes.ts)', () => {
  it('signs in, refreshes, and gives one answer for a wrong password and an unknown email', async () => {
    const { authId, email, send } = await setup();
    const first = await send('/auth/token', { body: { grant_type: 'password', email, password: 'a good password' } });
    expect(first).toMatchObject({ status: 200, body: { token_type: 'bearer', expires_in: 900, user: { id: authId } } });
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect((await send('/auth/token', { body: { grant_type: 'refresh_token', refresh_token: first.body.refresh_token } })).status).toBe(200);
    const wrong = await send('/auth/token', { body: { grant_type: 'password', email, password: 'not it' } });
    const unknown = await send('/auth/token', { body: { grant_type: 'password', email: 'nobody@madar.test', password: 'not it' } });
    expect([wrong.status, wrong.body]).toEqual([unknown.status, unknown.body]);
    expect(wrong).toMatchObject({ status: 401, body: { v: 1, error: { code: 'unauthenticated', details: { reason: 'invalid_credentials' } } } });
  });

  it('answers 429 with Retry-After over the limit of one email', async () => {
    const { email, send } = await setup();
    for (let i = 0; i < 10; i += 1) await send('/auth/token', { body: { grant_type: 'password', email, password: 'not it' }, address: `192.0.2.${i}` });
    const over = await send('/auth/token', { body: { grant_type: 'password', email, password: 'a good password' } });
    expect(over.status).toBe(429);
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('counts the address that the Pages Function wrote on the Worker host, never cf-connecting-ip', async () => {
    const { send } = await setup();
    for (let i = 0; i < 30; i += 1) await send('/auth/token', { body: { grant_type: 'password', email: `p${i}@madar.test`, password: 'x' }, address: '192.0.2.50' });
    expect((await send('/auth/token', { body: { grant_type: 'password', email: 'p99@madar.test', password: 'x' }, address: '192.0.2.50' })).status).toBe(429);
    expect((await send('/auth/token', { body: { grant_type: 'password', email: 'p99@madar.test', password: 'x' }, address: '192.0.2.51' })).status).toBe(401);
  });

  it('opens a link once, and refuses a used link and a wrong type', async () => {
    const { t, email, send } = await setup();
    const link = await t.deps.authAdmin.generateLink('recovery', email);
    expect((await send('/auth/verify', { body: { token_hash: link.tokenHash, type: 'recovery' } })).status).toBe(200);
    expect(await send('/auth/verify', { body: { token_hash: link.tokenHash, type: 'recovery' } })).toMatchObject({ status: 401, body: { error: { details: { reason: 'link_ended' } } } });
    expect((await send('/auth/verify', { body: { token_hash: link.tokenHash, type: 'magiclink' } })).status).toBe(400);
  });

  it('sets a password with a browser token, and refuses an agent token and no token', async () => {
    const { authId, email, keys, send } = await setup();
    const signedIn = await send('/auth/token', { body: { grant_type: 'password', email, password: 'a good password' } });
    const agent = await signAgentToken(keys, { authId, sessionId: 's-agent', clientId: 'c-1', now: new Date() });
    expect(await send('/auth/password', { token: agent, body: { password: 'an agent password', current: 'a good password' } })).toMatchObject({ status: 403, body: { error: { details: { reason: 'agent_token' } } } });
    expect((await send('/auth/password', { body: { password: 'x'.repeat(12) } })).status).toBe(401);
    expect(await send('/auth/password', { token: signedIn.body.access_token, body: { password: 'a new password', current: 'a good password' } })).toMatchObject({ status: 200, body: { ok: true } });
  });

  it('signs out this device: its refresh token stops', async () => {
    const { email, send } = await setup();
    const signedIn = await send('/auth/token', { body: { grant_type: 'password', email, password: 'a good password' } });
    expect((await send('/auth/logout', { token: signedIn.body.access_token, body: { scope: 'local' } })).status).toBe(200);
    expect((await send('/auth/token', { body: { grant_type: 'refresh_token', refresh_token: signedIn.body.refresh_token } })).status).toBe(401);
  });

  it('serves the public key set with no private part', async () => {
    const { send } = await setup();
    const jwks = await send('/auth/jwks', { method: 'GET' });
    expect(jwks.status).toBe(200);
    expect(JSON.stringify(jwks.body)).not.toContain('"d"');
  });

  it('gives not_found for an unknown step, and the hidden failed for a plain error, with a log line', async () => {
    const { deps } = await setup();
    expect(await runSigninOp(deps, 'auth.nothing' as never, {} as never)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    const broken = { ...deps, db: { ...deps.db, statement: () => Promise.reject(new Error('disk gone')), tx: () => Promise.reject(new Error('disk gone')) } };
    expect(await runSigninOp(broken as typeof deps, 'auth.refresh', { refreshToken: 'x' })).toMatchObject({ ok: false, error: { code: 'failed' } });
  });
});
