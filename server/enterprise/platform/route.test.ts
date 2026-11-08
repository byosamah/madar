import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../../src/data/seed';
import { importJWK, SignJWT, type JWK } from 'jose';
import { signAgentToken, signingKeysOf, signPlatformToken } from '../../auth/own/keys';
import { hashPassword } from '../../auth/own/password';
import { httpOf, NODE_TODAY, nodeWorld } from '../../office/test/nodeWorld';

const PASSWORD = 'a good password';
const PLATFORM_PASSWORD = 'a long platform password';
const AUTH = { owner: '11111111-1111-4111-8111-111111111111', admin: '22222222-2222-4222-8222-222222222222', member: '33333333-3333-4333-8333-333333333333', other: '44444444-4444-4444-8444-444444444444' };

async function world(env: Record<string, string> = { MADAR_ENTERPRISE_CREATE: 'open', MADAR_OPS_SECRET: 'ops-secret' }) {
  const t = await nodeWorld({
    at: new Date().toISOString(), env, ents: ['ent_001', 'ent_002'],
    seeds: { ent_001: await buildSeed(NODE_TODAY, async () => undefined), ent_002: await buildSeed(NODE_TODAY, async () => undefined) }, sleep: async () => undefined,
  });
  const hash = await hashPassword(PASSWORD);
  const row = (id: string, email: string, userId: string) => ({ id, email, password_hash: hash, email_confirmed: true, banned: false, password_set: true, user_id: userId });
  // usr_001 of ent_001 is a normal VADO Admin; usr_001 of ent_002 is an Admin of another company; usr_002 of ent_001 is another person.
  await t.signins([row(AUTH.owner, 'owner@one.test', 'usr_001'), row(AUTH.member, 'member@one.test', 'usr_002')], 'ent_001');
  await t.signins([row(AUTH.admin, 'admin@two.test', 'usr_001')], 'ent_002');
  // A platform account: it belongs to no company.
  await t.platform.platformAccounts({ action: 'create', email: 'boss@platform.test', name: 'The Boss', password: PLATFORM_PASSWORD });
  return t;
}
type World = Awaited<ReturnType<typeof world>>;
const parse = (body: string) => JSON.parse(body) as Record<string, any>;

async function companyToken(t: World, email: string): Promise<string> {
  const answer = await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email, password: PASSWORD }));
  expect(answer.status, email).toBe(200);
  return parse(answer.body).access_token as string;
}
const platformSignIn = (t: World, email = 'boss@platform.test', password = PLATFORM_PASSWORD) =>
  t.route(httpOf('POST', '/api/platform/auth/token', { grant_type: 'password', email, password }));
async function platformToken(t: World): Promise<string> {
  const answer = await platformSignIn(t);
  expect(answer.status).toBe(200);
  return parse(answer.body).access_token as string;
}
const post = (t: World, token: string, calls: unknown[]) => t.route(httpOf('POST', '/api/platform', { v: 1, calls }, { authorization: `Bearer ${token}` }));
const call = (name: string, input: unknown = {}) => [{ i: 0, name, input }];
const UNAUTH = { code: 'unauthenticated', message: 'Sign in to continue.' };

describe('POST /api/platform/auth/token', () => {
  it('gives a platform token, a refresh token and the account for the right email and password', async () => {
    const t = await world();
    const answer = await platformSignIn(t);
    expect(answer.status).toBe(200);
    expect(parse(answer.body)).toMatchObject({ expires_in: 900, account: { id: 'pla_001', name: 'The Boss', email: 'boss@platform.test' } });
    expect(typeof parse(answer.body).access_token).toBe('string');
    expect(typeof parse(answer.body).refresh_token).toBe('string');
    expect(answer.headers.find(([name]) => name === 'cache-control')?.[1]).toBe('no-store');
  });

  it('gives the same 401 body for a wrong password and an unknown email, and the company password does not work here', async () => {
    const t = await world();
    const wrong = await platformSignIn(t, 'boss@platform.test', 'a wrong long password');
    const unknown = await platformSignIn(t, 'nobody@platform.test', 'a wrong long password');
    expect(wrong.status).toBe(401);
    expect(wrong.body).toBe(unknown.body);
    expect(parse(wrong.body).error).toMatchObject({ code: 'unauthenticated', details: { reason: 'invalid_credentials' } });
    // A company Admin with a good company password fails on the platform sign-in.
    const company = await platformSignIn(t, 'owner@one.test', PASSWORD);
    expect(company.status).toBe(401);
    expect(company.body).toBe(wrong.body);
    // And a platform account cannot sign in to a company.
    const other = await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: 'boss@platform.test', password: PLATFORM_PASSWORD }));
    expect(other.status).toBe(401);
  });

  it('answers 429 with Retry-After after 10 wrong tries for one email', async () => {
    const t = await world();
    for (let i = 0; i < 10; i += 1) await platformSignIn(t, 'boss@platform.test', 'a wrong long password');
    const over = await platformSignIn(t);
    expect(over.status).toBe(429);
    expect(Number(over.headers.find(([name]) => name === 'retry-after')?.[1])).toBeGreaterThan(0);
  });

  it('refreshes with the refresh token, and an ended session gives 401 session_ended', async () => {
    const t = await world();
    const first = parse((await platformSignIn(t)).body);
    const refreshed = await t.route(httpOf('POST', '/api/platform/auth/token', { grant_type: 'refresh_token', refresh_token: first.refresh_token }));
    expect(refreshed.status).toBe(200);
    expect(parse(refreshed.body).refresh_token).not.toBe(first.refresh_token);
    const none = await t.route(httpOf('POST', '/api/platform/auth/token', { grant_type: 'refresh_token', refresh_token: 'nothing' }));
    expect(none.status).toBe(401);
    expect(parse(none.body).error.details).toMatchObject({ reason: 'session_ended' });
  });

  it('gives 400 for a body with no grant_type and 404 to a GET', async () => {
    const t = await world();
    expect((await t.route(httpOf('POST', '/api/platform/auth/token', {}))).status).toBe(400);
    expect((await t.route(httpOf('GET', '/api/platform/auth/token'))).status).toBe(404);
  });

  it('an account that is off gets 401 account_off at sign-in and at refresh', async () => {
    const t = await world();
    const first = parse((await platformSignIn(t)).body);
    await t.platform.platformAccounts({ action: 'off', email: 'boss@platform.test' });
    const signin = await platformSignIn(t);
    expect(signin.status).toBe(401);
    expect(parse(signin.body).error.details).toMatchObject({ reason: 'account_off' });
    const refresh = await t.route(httpOf('POST', '/api/platform/auth/token', { grant_type: 'refresh_token', refresh_token: first.refresh_token }));
    expect(refresh.status).toBe(401);
    expect(parse(refresh.body).error.details).toMatchObject({ reason: 'account_off' });
  });
});

describe('POST /api/platform/auth/logout', () => {
  it('ends the session: 204, and the refresh token fails after it', async () => {
    const t = await world();
    const first = parse((await platformSignIn(t)).body);
    const out = await t.route(httpOf('POST', '/api/platform/auth/logout', {}, { authorization: `Bearer ${first.access_token}` }));
    expect(out.status).toBe(204);
    const refresh = await t.route(httpOf('POST', '/api/platform/auth/token', { grant_type: 'refresh_token', refresh_token: first.refresh_token }));
    expect(refresh.status).toBe(401);
  });

  it('gives 401 for no token and for a company token', async () => {
    const t = await world();
    expect((await t.route(httpOf('POST', '/api/platform/auth/logout', {}))).status).toBe(401);
    expect((await t.route(httpOf('POST', '/api/platform/auth/logout', {}, { authorization: `Bearer ${await companyToken(t, 'owner@one.test')}` }))).status).toBe(401);
  });
});

describe('POST /api/platform', () => {
  it('answers a platform account with the wire entry of platform.me', async () => {
    const t = await world();
    const answer = await post(t, await platformToken(t), call('platform.me'));
    expect(answer.status).toBe(200);
    expect(parse(answer.body)).toMatchObject({ v: 1, results: [{ i: 0, ok: true, output: { owner: true, ent: 'ent_000', createOpen: true } }] });
  });

  it('answers 401 to a company token (an Admin of VADO and of another company, a Member) with the body of a missing token', async () => {
    const t = await world();
    const none = await t.route(httpOf('POST', '/api/platform', { v: 1, calls: call('platform.me') }));
    expect(none.status).toBe(401);
    for (const email of ['owner@one.test', 'admin@two.test', 'member@one.test']) {
      const refused = await post(t, await companyToken(t, email), call('platform.me'));
      expect({ email, status: refused.status }).toEqual({ email, status: 401 });
      expect(parse(refused.body).error).toMatchObject(UNAUTH);
    }
  });

  it('answers invalid_input for a batch of two calls and for a bad input, and not_found for a call that is no platform call', async () => {
    const t = await world();
    const token = await platformToken(t);
    const two = await post(t, token, [{ i: 0, name: 'platform.me', input: {} }, { i: 1, name: 'platform.meter.get', input: {} }]);
    expect(parse(two.body).error).toMatchObject({ code: 'invalid_input' });
    const bad = await post(t, token, call('platform.enterprises.pause', { id: 'nope', confirmName: 'x' }));
    expect(parse(bad.body).error).toMatchObject({ code: 'invalid_input' });
    const other = await post(t, token, call('projects.list'));
    expect(other.status).toBe(404);
    expect(parse(other.body).error).toMatchObject({ code: 'not_found', message: 'This address does not exist.' });
  });

  it('answers 404 to a GET, 401 with no token, and 401 for an agent token', async () => {
    const t = await world();
    expect((await t.route(httpOf('GET', '/api/platform'))).status).toBe(404);
    const keys = await signingKeysOf(t.jwk, t.env.MCP_URL);
    const agent = await signAgentToken(keys, { authId: AUTH.owner, sessionId: 's-1', clientId: 'c-1', now: new Date(), ent: 'ent_001' });
    const refused = await post(t, agent, call('platform.me'));
    expect(refused.status).toBe(401);
    expect(parse(refused.body).error).toMatchObject(UNAUTH);
  });

  it('refuses a platform account that was turned off with a token that is still valid, at once, with account_off', async () => {
    const t = await world();
    const token = await platformToken(t);
    expect((await post(t, token, call('platform.me'))).status).toBe(200);
    await t.platform.platformAccounts({ action: 'off', email: 'boss@platform.test' });
    const refused = await post(t, token, call('platform.me'));
    expect(refused.status).toBe(401);
    expect(parse(refused.body).error.details).toMatchObject({ reason: 'account_off' });
    await t.platform.platformAccounts({ action: 'on', email: 'boss@platform.test' });
    expect((await post(t, token, call('platform.me'))).status).toBe(200);
  });

  it('refuses a token that is expired, one with an ent claim, and one of an account that does not exist', async () => {
    const t = await world();
    const keys = await signingKeysOf(t.jwk, t.env.MCP_URL);
    const old = await signPlatformToken(keys, { accountId: 'pla_001', sessionId: 's-1', now: new Date(Date.now() - 3_600_000) });
    expect((await post(t, old, call('platform.me'))).status).toBe(401);
    // A token with the platform audience that also carries ent is not a platform token.
    const jwk = JSON.parse(t.jwk) as JWK;
    const iat = Math.floor(Date.now() / 1000);
    const withEnt = await new SignJWT({ sid: 's-1', ent: 'ent_001' }).setProtectedHeader({ alg: 'ES256', kid: jwk.kid as string, typ: 'JWT' })
      .setIssuer(keys.issuer).setAudience('madar-platform').setSubject('pla_001').setIssuedAt(iat).setExpirationTime(iat + 900).sign(await importJWK(jwk, 'ES256'));
    expect((await post(t, withEnt, call('platform.me'))).status).toBe(401);
    const ghost = await signPlatformToken(keys, { accountId: 'pla_099', sessionId: 's-1', now: new Date() });
    const ghostAnswer = await post(t, ghost, call('platform.me'));
    expect(ghostAnswer.status).toBe(401);
    expect(parse(ghostAnswer.body).error).toMatchObject(UNAUTH);
  });

  it('lists the enterprises for a platform account, and VADO is one of them', async () => {
    const t = await world();
    const answer = await post(t, await platformToken(t), call('platform.enterprises.list'));
    const rows = parse(answer.body).results[0].output as Record<string, unknown>[];
    expect(rows.map((row) => row.id)).toEqual(['ent_001', 'ent_002']);
  });

  it('touches no company object for a platform call, a refused token or a sign-in', async () => {
    const t = await world();
    t.created.length = 0;
    const token = await platformToken(t);
    await post(t, token, call('platform.me'));
    await post(t, token, call('platform.enterprises.list'));
    await post(t, 'x.y.z', call('platform.me'));
    expect(t.created).toEqual([]);
  });
});

describe('VADO is a normal company (design D11)', () => {
  it('the platform pauses ent_001 like any other company, the company sign-in then answers the paused text, and resume brings it back', async () => {
    const t = await world();
    const token = await platformToken(t);
    const vado = 'VADOs\' Companies';
    const refused = await post(t, token, call('platform.enterprises.pause', { id: 'ent_001', confirmName: 'wrong name' }));
    expect(parse(refused.body).results[0]).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    const paused = await post(t, token, call('platform.enterprises.pause', { id: 'ent_001', confirmName: vado }));
    expect(parse(paused.body).results[0]).toMatchObject({ ok: true, output: { id: 'ent_001', state: 'paused' } });
    const signin = await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: 'owner@one.test', password: PASSWORD }));
    expect(signin.status).toBe(401);
    expect(parse(signin.body).error).toMatchObject({ message: 'Madar is paused for your company. Ask your Admin.', details: { reason: 'enterprise_paused' } });
    const resumed = await post(t, token, call('platform.enterprises.resume', { id: 'ent_001' }));
    expect(parse(resumed.body).results[0]).toMatchObject({ ok: true, output: { id: 'ent_001', state: 'active' } });
    expect((await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: 'owner@one.test', password: PASSWORD }))).status).toBe(200);
  });
});

describe('the Postgres path', () => {
  it('has no platform route: the api app answers 404 for the call and for both sign-in routes', async () => {
    const { setEnvSource } = await import('../../env');
    const denoApi = (await import('../../entries/deno-api')).default;
    setEnvSource({
      DATABASE_URL: 'postgres://postgres.pooler-dev:postgres@127.0.0.1:54329/postgres', SUPABASE_URL: 'http://127.0.0.1:54321', MADAR_SECRET_KEY: 'sb_secret_made_up',
      APP_URL: 'http://127.0.0.1:5173', MAIL_FROM: 'Madar <notices@madar.test>', MAIL_DRIVER: 'outbox',
    });
    try {
      for (const path of ['/api/platform', '/api/platform/auth/token', '/api/platform/auth/logout']) {
        const response = await denoApi.fetch(new Request(`http://127.0.0.1${path}`, { method: 'POST', body: '{}' }));
        expect({ path, status: response.status }).toEqual({ path, status: 404 });
      }
    } finally {
      setEnvSource(undefined);
    }
  });
});
