import { describe, expect, it } from 'vitest';
import { APPROVE_PATH } from '../mcp/approval';
import type { OfficeMailAnswer, OfficeMailInput, OfficeMailWork, OfficeSigninInput } from '../office/parts';
import { recordingNet } from '../office/test/fakes';
import type { TokenChecker } from '../auth/verify';
import { fakeDeps } from '../test/fakes/deps';
import { officeSigninRoutes } from './officeSignin';
import { officeRoutes, type OfficeStub } from './officeWorker';

const JWKS = { keys: [{ kty: 'EC', crv: 'P-256', x: 'x', y: 'y', kid: 'k1', alg: 'ES256', use: 'sig' }] };
const ADDRESS = '203.0.113.7';
/** The directory of the fake platform object: which email belongs to which enterprise. */
const EMAILS: Record<string, string> = { 'hala@madar.test': 'ent_001', 'sara@globex.test': 'ent_002' };
const INVALID = { ok: false as const, error: { code: 'unauthenticated' as const, message: 'The email or the password is not right.', details: { reason: 'invalid_credentials' } } };

function setup(o: { mail?: OfficeMailAnswer; checkToken?: TokenChecker } = {}) {
  const deps = fakeDeps();
  const seen = {
    signins: [] as (OfficeSigninInput & { object: string })[], mailRoutes: [] as OfficeMailInput[], mailWorks: [] as OfficeMailWork[], sleeps: [] as number[],
    created: [] as string[], resolved: [] as string[], refused: [] as { signin: string; input: unknown }[], refusedMail: [] as { route: string; body: string; address: string }[],
  };
  const stubOf = (object: string) => ({
    signin: async (body: OfficeSigninInput) => (
      seen.signins.push({ ...body, object }),
      (body.input as { password?: string }).password === 'a wrong password' ? INVALID : { ok: true as const, value: { access_token: 't', step: body.signin } }
    ),
    mailRoute: async (input: OfficeMailInput) => (seen.mailRoutes.push(input), o.mail ?? { status: 200, body: '{"v":1,"ok":true}', work: 'value-1' }),
    mailWork: async (input: OfficeMailWork) => void seen.mailWorks.push(input),
  } as unknown as OfficeStub);
  const platform = {
    resolveEmail: async ({ email }: { email: string }) => (seen.resolved.push(email), EMAILS[email] ? { ent: EMAILS[email] } : null),
    listed: async () => ['ent_001', 'ent_002'],
    resolveAddress: async () => null,
    refuseSignin: async (input: { signin: string; input: unknown }) => (seen.refused.push(input), INVALID),
    refuseMail: async (input: { route: string; body: string; address: string }) => (seen.refusedMail.push(input), { status: 200, body: '{"v":1,"ok":true}' }),
  };
  const net = recordingNet();
  const routes = officeRoutes({
    deps,
    verifyToken: async () => ({ authUserId: 'auth-1' }),
    stubFor: (_env, ent) => (seen.created.push(ent), stubOf(ent)),
    platform: () => platform as never,
    net: () => net,
    jobsSecret: () => undefined,
    routes: officeSigninRoutes({ jwks: JWKS, deps, minMs: { forgot: 1500, renew: 1500 }, sleep: async (ms) => void seen.sleeps.push(ms), ...(o.checkToken ? { checkToken: o.checkToken } : {}) }),
  });
  const post = (path: string, body: unknown, ctx?: { waitUntil(work: Promise<unknown>): void }, headers: Record<string, string> = {}) =>
    routes.fetch(new Request(`https://madar-server.internal/api${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-madar-client-address': ADDRESS, ...headers }, body: JSON.stringify(body),
    }), {}, ctx);
  return { deps, seen, routes, post, net };
}

const password = (email: string, pass = 'a good password') => ({ grant_type: 'password', email, password: pass });

describe('the own sign-in routes of the office path (server/entries/officeSignin.ts)', () => {
  it('sends a password sign-in to the object of the enterprise of the email, with the address that the Pages Function wrote', async () => {
    const { seen, post } = setup();
    const answer = await post('/auth/token', password('hala@madar.test'));
    expect([answer.status, answer.headers.get('cache-control'), await answer.json()]).toEqual([200, 'no-store', { access_token: 't', step: 'auth.password' }]);
    expect(seen.signins).toEqual([{ object: 'ent_001', ent: 'ent_001', signin: 'auth.password', input: { email: 'hala@madar.test', password: 'a good password', address: ADDRESS } }]);
    await post('/auth/token', password('sara@globex.test'));
    expect(seen.signins.at(-1)).toMatchObject({ object: 'ent_002', ent: 'ent_002' });
  });

  it('normalizes "  Hala@Madar.TEST " before the directory read', async () => {
    const { seen, post } = setup();
    await post('/auth/token', password('  Hala@Madar.TEST '));
    expect(seen.resolved).toEqual(['hala@madar.test']);
    expect(seen.signins.map((one) => one.object)).toEqual(['ent_001']);
  });

  it('sends an unknown email to refuseSignin, calls no object, and gives the same status and body as a wrong password', async () => {
    const { seen, post } = setup();
    const unknown = await post('/auth/token', password('nobody@nowhere.test'));
    expect(seen.created).toEqual([]);
    expect(seen.signins).toEqual([]);
    expect(seen.refused).toEqual([{ signin: 'auth.password', input: { email: 'nobody@nowhere.test', password: 'a good password', address: ADDRESS } }]);
    const wrong = await post('/auth/token', password('hala@madar.test', 'a wrong password'));
    expect([unknown.status, await unknown.text()]).toEqual([wrong.status, await wrong.text()]);
    expect(unknown.status).toBe(401);
  });

  it('sends a refresh token tagged ent_002 to ent_002 with the bare secret', async () => {
    const { seen, post } = setup();
    await post('/auth/token', { grant_type: 'refresh_token', refresh_token: 'ent_002.abc_DEF-123' });
    expect(seen.signins).toEqual([{ object: 'ent_002', ent: 'ent_002', signin: 'auth.refresh', input: { refreshToken: 'abc_DEF-123' } }]);
  });

  it('sends an untagged refresh token, an unlisted tag, ENT_001.abc, ent_001.a.b and a tag of 5,000 characters to refuseSignin and makes no object', async () => {
    const { seen, post } = setup();
    const bad = ['abc_DEF-123', 'ent_009.abc', 'ENT_001.abc', 'ent_001.a.b', `ent_001.${'a'.repeat(5000)}`, 'ent_01.abc', ''];
    for (const refresh_token of bad) await post('/auth/token', { grant_type: 'refresh_token', refresh_token });
    expect(seen.refused.map((one) => one.signin)).toEqual(bad.map(() => 'auth.refresh'));
    expect(seen.refused.map((one) => (one.input as { refreshToken: string }).refreshToken)).toEqual(bad);
    expect(seen.signins).toEqual([]);
    // Only the listed id of the shape check reaches the router; the object of ent_009 is never made.
    expect(seen.created).toEqual([]);
  });

  it('does the same for auth.verify: a tagged link reaches its object with the bare token, every other text is refused', async () => {
    const { seen, post } = setup();
    await post('/auth/verify', { token_hash: 'ent_002.tok-123', type: 'invite' });
    expect(seen.signins).toEqual([{ object: 'ent_002', ent: 'ent_002', signin: 'auth.verify', input: { token: 'tok-123', type: 'invite', address: ADDRESS } }]);
    for (const token_hash of ['tok-123', 'ent_009.tok', 'ent_001.a.b', `ent_001.${'a'.repeat(5000)}`]) await post('/auth/verify', { token_hash, type: 'invite' });
    expect(seen.refused.map((one) => one.signin)).toEqual(['auth.verify', 'auth.verify', 'auth.verify', 'auth.verify']);
    expect(seen.created).toEqual(['ent_002']);
  });

  it('gives a step of a signed-in person the ent of the token', async () => {
    const { seen, post } = setup({ checkToken: async () => ({ authUserId: 'auth-2', sessionId: 's-2', ent: 'ent_002' }) });
    const answer = await post('/auth/logout', { scope: 'others' }, undefined, { authorization: 'Bearer x' });
    expect(answer.status).toBe(200);
    expect(seen.signins).toEqual([{ object: 'ent_002', ent: 'ent_002', signin: 'auth.logout', input: { authId: 'auth-2', sessionId: 's-2', scope: 'others' } }]);
  });

  it('refuses a step of a signed-in person whose token has no ent, and calls no object', async () => {
    const { seen, post } = setup({ checkToken: async () => ({ authUserId: 'auth-2', sessionId: 's-2' }) });
    const answer = await post('/auth/logout', {}, undefined, { authorization: 'Bearer x' });
    expect(answer.status).toBe(401);
    expect(seen.created).toEqual([]);
  });

  it('answers the public key set with no office object call', async () => {
    const { seen, routes } = setup();
    const answer = await routes.fetch(new Request('https://madar-server.internal/api/auth/jwks'), {});
    expect(await answer.json()).toEqual(JWKS);
    expect(seen.signins).toEqual([]);
  });

  it('has the own approve route of the Madar consent, and no route of Supabase', async () => {
    const paths = officeSigninRoutes({ jwks: JWKS, deps: fakeDeps() }).map((route) => `${route.method} ${route.path}`);
    expect(paths).toContain(`POST ${APPROVE_PATH}`);
    expect(paths).toEqual(expect.arrayContaining(['POST /auth/forgot', 'POST /auth/renew-invite', 'POST /auth/token', 'POST /auth/verify', 'GET /auth/jwks']));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('answers the Google callback with #google=not_ready and calls no object (the office path has no Google yet, fbk_022)', async () => {
    const { seen, routes, net } = setup();
    const answer = await routes.fetch(new Request('https://madar-server.internal/api/google/callback?code=code-SECRET&state=state-made-up'), {});
    expect([answer.status, answer.headers.get('location'), answer.headers.get('cache-control'), answer.headers.get('referrer-policy')]).toEqual([
      302, 'http://127.0.0.1:5173/settings#google=not_ready', 'no-store', 'no-referrer',
    ]);
    expect(seen.signins).toEqual([]);
    expect(seen.mailRoutes).toEqual([]);
    expect(net.calls ?? []).toEqual([]);
  });

  it('answers a reset request from the limits of the office object, pads it to the minimum time, and sends the mail after the answer', async () => {
    const { seen, post, net } = setup();
    const waits: Promise<unknown>[] = [];
    const answer = await post('/auth/forgot', { email: 'hala@madar.test' }, { waitUntil: (work) => waits.push(work) });
    expect([answer.status, await answer.json()]).toEqual([200, { v: 1, ok: true }]);
    expect(seen.mailRoutes).toEqual([{ ent: 'ent_001', route: 'forgot', body: JSON.stringify({ email: 'hala@madar.test' }), address: ADDRESS }]);
    expect(seen.sleeps).toHaveLength(1);
    expect(seen.sleeps[0]).toBeGreaterThan(1400);
    expect(waits).toHaveLength(1);
    await Promise.all(waits);
    expect(seen.mailWorks).toEqual([{ ent: 'ent_001', route: 'forgot', value: 'value-1' }]);
    expect(net.calls).toEqual([]);
  });

  it('sends the forgot request of an unknown email to refuseMail: no object, no mail work, the same body and the same minimum time', async () => {
    const { seen, post } = setup();
    const known = await post('/auth/forgot', { email: 'Hala@Madar.TEST' });
    const unknown = await post('/auth/forgot', { email: 'nobody@nowhere.test' });
    expect([unknown.status, await unknown.text()]).toEqual([known.status, await known.text()]);
    expect(seen.mailRoutes).toHaveLength(1);
    expect(seen.mailRoutes[0]).toMatchObject({ ent: 'ent_001', route: 'forgot' });
    expect(seen.refusedMail).toEqual([{ route: 'forgot', body: JSON.stringify({ email: 'nobody@nowhere.test' }), address: ADDRESS }]);
    expect(seen.mailWorks).toHaveLength(1);
    expect(seen.created).toEqual(['ent_001']);
    expect(seen.sleeps).toHaveLength(2);
    for (const wait of seen.sleeps) expect(wait).toBeGreaterThan(1400);
    expect(Math.abs(seen.sleeps[0] - seen.sleeps[1])).toBeLessThan(100);
  });

  it('sends a forgot body that does not parse, and a bad email, to refuseMail', async () => {
    const { seen, routes } = setup();
    const raw = (body: string) => routes.fetch(new Request('https://madar-server.internal/api/auth/forgot', { method: 'POST', headers: { 'content-type': 'application/json', 'x-madar-client-address': ADDRESS }, body }), {});
    await raw('not json');
    await raw('{"email":"nope"}');
    await raw('{}');
    expect(seen.refusedMail.map((one) => one.body)).toEqual(['not json', '{"email":"nope"}', '{}']);
    expect(seen.mailRoutes).toEqual([]);
  });

  it('sends a renew key tagged ent_002 to ent_002 with the bare key, and any other key to refuseMail', async () => {
    const { seen, post } = setup();
    await post('/auth/renew-invite', { key: 'ent_002.the-key-1' });
    expect(seen.mailRoutes).toEqual([{ ent: 'ent_002', route: 'renew', body: JSON.stringify({ key: 'the-key-1' }), address: ADDRESS }]);
    expect(seen.mailWorks).toEqual([{ ent: 'ent_002', route: 'renew', value: 'value-1' }]);
    const bad = ['the-key-1', 'ent_009.k', 'ENT_001.k', 'ent_001.a.b', `ent_001.${'k'.repeat(5000)}`];
    for (const key of bad) await post('/auth/renew-invite', { key });
    expect(seen.refusedMail.map((one) => one.route)).toEqual(bad.map(() => 'renew'));
    expect(seen.mailRoutes).toHaveLength(1);
    expect(seen.created).toEqual(['ent_002']);
  });

  it('answers a refusal of the limits as it is, with no mail work', async () => {
    const refused = '{"v":1,"error":{"code":"conflict","message":"Too many tries. Wait a few minutes, then try again."}}';
    const { seen, post } = setup({ mail: { status: 409, body: refused } });
    const answer = await post('/auth/renew-invite', { key: 'ent_001.k' });
    expect([answer.status, await answer.text()]).toEqual([409, refused]);
    expect(seen.mailRoutes[0].route).toBe('renew');
    expect(seen.mailWorks).toEqual([]);
  });
});
