import { describe, expect, it } from 'vitest';
import { STATE_LIFE_MS, signState } from '../google/state';
import { googleKeysOf } from '../google/keys';
import { GOOGLE_CONFIG, GOOGLE_KEY } from '../google/testOffice';
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

function setup(o: { mail?: OfficeMailAnswer; checkToken?: TokenChecker; overAddress?: boolean; google?: boolean } = {}) {
  const deps = fakeDeps(o.google ? { config: { google: GOOGLE_CONFIG } } : {});
  const seen = {
    signins: [] as (OfficeSigninInput & { object: string })[], mailRoutes: [] as OfficeMailInput[], mailWorks: [] as OfficeMailWork[], sleeps: [] as number[],
    created: [] as string[], resolved: [] as string[], hits: [] as { step: string; address: string; order: number }[], order: 0, refused: [] as { signin: string; input: unknown }[], refusedMail: [] as { route: string; body: string; address: string; addressChecked?: boolean }[],
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
    hitAddress: async ({ step, address }: { step: string; address: string }) => (
      seen.hits.push({ step, address, order: seen.order += 1 }), o.overAddress ? { ok: false as const, retryAfterMs: 61_000 } : { ok: true as const }
    ),
    listed: async () => ['ent_001', 'ent_002'],
    resolveAddress: async () => null,
    refuseSignin: async (input: { signin: string; input: unknown }) => (seen.refused.push(input), INVALID),
    refuseMail: async (input: { route: string; body: string; address: string; addressChecked?: boolean }) => (seen.refusedMail.push(input), { status: 200, body: '{"v":1,"ok":true}' }),
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
    expect(seen.signins).toEqual([{ object: 'ent_001', ent: 'ent_001', signin: 'auth.password', input: { email: 'hala@madar.test', password: 'a good password', address: ADDRESS, addressChecked: true } }]);
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
    expect(seen.refused).toEqual([{ signin: 'auth.password', input: { email: 'nobody@nowhere.test', password: 'a good password', address: ADDRESS, addressChecked: true } }]);
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
    expect(seen.signins).toEqual([{ object: 'ent_002', ent: 'ent_002', signin: 'auth.verify', input: { token: 'tok-123', type: 'invite', address: ADDRESS, addressChecked: true } }]);
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

  it('answers the Google callback with finish, the code and the state, and calls no object', async () => {
    const { deps, seen, routes, net } = setup({ google: true });
    const { state } = await signState(await googleKeysOf(GOOGLE_KEY), 'usr_001', deps.clock.now(), 'ent_001');
    const answer = await routes.fetch(new Request(`https://madar-server.internal/api/google/callback?code=code-SECRET&state=${encodeURIComponent(state)}`), {});
    expect([answer.status, answer.headers.get('location'), answer.headers.get('cache-control'), answer.headers.get('referrer-policy')]).toEqual([
      302, `http://127.0.0.1:5173/settings#google=finish&code=code-SECRET&state=${encodeURIComponent(state)}`, 'no-store', 'no-referrer',
    ]);
    expect(seen.signins).toEqual([]);
    expect(seen.mailRoutes).toEqual([]);
    expect(net.calls).toEqual([]);
    const log = JSON.stringify(deps.logs);
    expect(log).toContain('finish');
    expect(log).not.toContain('code-SECRET');
    expect(log).not.toContain(state);
  });

  it('finishes a Google state of a listed enterprise, and answers failed for an unlisted one, with no object call and no key made for it', async () => {
    const callback = async (ent: string) => {
      const { deps, seen, routes } = setup({ google: true });
      const { state } = await signState(await googleKeysOf(GOOGLE_KEY, ent), 'usr_001', deps.clock.now(), ent);
      const answer = await routes.fetch(new Request(`https://madar-server.internal/api/google/callback?code=code-SECRET&state=${encodeURIComponent(state)}`), {});
      expect(seen.signins).toEqual([]);
      return answer.headers.get('location');
    };
    expect(await callback('ent_002')).toContain('#google=finish&code=code-SECRET');
    // ent_009 has a true signature of its own keys, but the platform object does not list it.
    expect(await callback('ent_009')).toBe('http://127.0.0.1:5173/settings#google=failed');
  });

  it('answers old, failed, denied and not_ready with one word, and no object call', async () => {
    const callback = async (o: { google: boolean; query: (state: string) => string; late?: boolean }) => {
      const { deps, seen, routes } = setup({ google: o.google });
      const { state } = await signState(await googleKeysOf(GOOGLE_KEY), 'usr_001', deps.clock.now(), 'ent_001');
      if (o.late) deps.clock.advance(STATE_LIFE_MS + 1000);
      const answer = await routes.fetch(new Request(`https://madar-server.internal/api/google/callback?${o.query(encodeURIComponent(state))}`), {});
      expect(seen.signins).toEqual([]);
      expect(JSON.stringify(deps.logs)).not.toContain('code-SECRET');
      return answer.headers.get('location');
    };
    const base = 'http://127.0.0.1:5173/settings#';
    expect(await callback({ google: true, late: true, query: (state) => `code=code-SECRET&state=${state}` })).toBe(`${base}google=old`);
    expect(await callback({ google: true, query: () => 'code=code-SECRET&state=plain-text-not-a-state' })).toBe(`${base}google=failed`);
    expect(await callback({ google: true, query: () => 'code=code-SECRET&state=eyJhbGciOiJFUzI1NiJ9.e30.AAAA' })).toBe(`${base}google=failed`);
    expect(await callback({ google: true, query: () => 'error=access_denied&state=x' })).toBe(`${base}google=denied`);
    expect(await callback({ google: false, query: (state) => `code=code-SECRET&state=${state}` })).toBe(`${base}google=not_ready`);
  });

  it('answers a reset request from the limits of the office object, pads it to the minimum time, and sends the mail after the answer', async () => {
    const { seen, post, net } = setup();
    const waits: Promise<unknown>[] = [];
    const answer = await post('/auth/forgot', { email: 'hala@madar.test' }, { waitUntil: (work) => waits.push(work) });
    expect([answer.status, await answer.json()]).toEqual([200, { v: 1, ok: true }]);
    expect(seen.mailRoutes).toEqual([{ ent: 'ent_001', route: 'forgot', body: JSON.stringify({ email: 'hala@madar.test' }), address: ADDRESS, addressChecked: true }]);
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
    expect(seen.refusedMail).toEqual([{ route: 'forgot', body: JSON.stringify({ email: 'nobody@nowhere.test' }), address: ADDRESS, addressChecked: true }]);
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
    expect(seen.mailRoutes).toEqual([{ ent: 'ent_002', route: 'renew', body: JSON.stringify({ key: 'the-key-1' }), address: ADDRESS, addressChecked: true }]);
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

  it('counts the address in the platform object once, before the directory read or the tag read, for the four first steps', async () => {
    const { seen, post } = setup();
    await post('/auth/token', password('hala@madar.test'));
    await post('/auth/token', password('nobody@nowhere.test'));
    await post('/auth/verify', { token_hash: 'ent_002.tok-123', type: 'invite' });
    await post('/auth/verify', { token_hash: 'untagged', type: 'invite' });
    await post('/auth/forgot', { email: 'hala@madar.test' });
    await post('/auth/forgot', { email: 'nobody@nowhere.test' });
    await post('/auth/renew-invite', { key: 'ent_001.k' });
    await post('/auth/renew-invite', { key: 'untagged' });
    expect(seen.hits.map((one) => [one.step, one.address])).toEqual([
      ['auth.password', ADDRESS], ['auth.password', ADDRESS], ['auth.verify', ADDRESS], ['auth.verify', ADDRESS],
      ['forgot', ADDRESS], ['forgot', ADDRESS], ['renew', ADDRESS], ['renew', ADDRESS],
    ]);
    // The refresh token and a body that does not parse count no address.
    await post('/auth/token', { grant_type: 'refresh_token', refresh_token: 'ent_002.abc' });
    await post('/auth/forgot', { email: 'nope' });
    expect(seen.hits).toHaveLength(8);
  });

  it('gives the object and the refuse step addressChecked, so neither counts the address again', async () => {
    const { seen, post } = setup();
    await post('/auth/token', password('hala@madar.test'));
    await post('/auth/token', password('nobody@nowhere.test'));
    await post('/auth/verify', { token_hash: 'ent_002.tok-123', type: 'invite' });
    await post('/auth/verify', { token_hash: 'untagged', type: 'invite' });
    await post('/auth/forgot', { email: 'hala@madar.test' });
    await post('/auth/forgot', { email: 'nobody@nowhere.test' });
    expect([...seen.signins.map((one) => one.input), ...seen.refused.map((one) => one.input)]).toSatisfy((inputs: { addressChecked?: boolean }[]) => inputs.length === 4 && inputs.every((one) => one.addressChecked === true));
    expect(seen.mailRoutes.every((one) => one.addressChecked === true)).toBe(true);
    expect(seen.refusedMail.every((one) => one.addressChecked === true)).toBe(true);
  });

  it('answers a request over the address limit with the too-many answer, makes no object and runs no mail work, for a known and an unknown email', async () => {
    const { seen, post } = setup({ overAddress: true });
    const answers = [];
    for (const email of ['hala@madar.test', 'sara@globex.test', 'nobody@nowhere.test']) {
      const one = await post('/auth/token', password(email));
      answers.push([one.status, await one.text(), one.headers.get('retry-after')]);
    }
    expect(answers[0][0]).toBe(429);
    expect(answers[0][2]).toBe('61');
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    const mail = [];
    for (const email of ['hala@madar.test', 'sara@globex.test', 'nobody@nowhere.test']) {
      const one = await post('/auth/forgot', { email });
      mail.push([one.status, await one.text()]);
    }
    expect(mail[0][0]).toBe(429);
    expect(mail[1]).toEqual(mail[0]);
    expect(mail[2]).toEqual(mail[0]);
    const link = await post('/auth/verify', { token_hash: 'ent_002.tok-123', type: 'invite' });
    expect(link.status).toBe(429);
    expect(seen.created).toEqual([]);
    expect(seen.resolved).toEqual([]);
    expect(seen.signins).toEqual([]);
    expect(seen.refused).toEqual([]);
    expect(seen.mailRoutes).toEqual([]);
    expect(seen.refusedMail).toEqual([]);
    expect(seen.mailWorks).toEqual([]);
  });

  it('pads the too-many answer of forgot and renew to the same minimum time as the other answers', async () => {
    const { seen, post } = setup({ overAddress: true });
    await post('/auth/forgot', { email: 'hala@madar.test' });
    await post('/auth/renew-invite', { key: 'ent_001.k' });
    expect(seen.sleeps).toHaveLength(2);
    for (const wait of seen.sleeps) expect(wait).toBeGreaterThan(1400);
  });
});
