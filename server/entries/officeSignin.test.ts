import { describe, expect, it } from 'vitest';
import { APPROVE_PATH } from '../mcp/approval';
import type { OfficeMailAnswer, OfficeMailInput, OfficeMailWork, OfficeSigninInput } from '../office/parts';
import { recordingNet } from '../office/test/fakes';
import { fakeDeps } from '../test/fakes/deps';
import { officeSigninRoutes } from './officeSignin';
import { officeRoutes, type OfficeStub } from './officeWorker';

const JWKS = { keys: [{ kty: 'EC', crv: 'P-256', x: 'x', y: 'y', kid: 'k1', alg: 'ES256', use: 'sig' }] };
const ADDRESS = '203.0.113.7';

function setup(o: { mail?: OfficeMailAnswer } = {}) {
  const deps = fakeDeps();
  const seen = { signins: [] as OfficeSigninInput[], mailRoutes: [] as OfficeMailInput[], mailWorks: [] as OfficeMailWork[], sleeps: [] as number[] };
  const stub = {
    signin: async (body: OfficeSigninInput) => (seen.signins.push(body), { ok: true as const, value: { access_token: 't', step: body.signin } }),
    mailRoute: async (input: OfficeMailInput) => (seen.mailRoutes.push(input), o.mail ?? { status: 200, body: '{"v":1,"ok":true}', work: 'value-1' }),
    mailWork: async (input: OfficeMailWork) => void seen.mailWorks.push(input),
  } as unknown as OfficeStub;
  const net = recordingNet();
  const routes = officeRoutes({
    deps,
    verifyToken: async () => ({ authUserId: 'auth-1' }),
    stub: () => stub,
    net: () => net,
    jobsSecret: () => undefined,
    routes: officeSigninRoutes({ jwks: JWKS, deps, minMs: { forgot: 1500, renew: 1500 }, sleep: async (ms) => void seen.sleeps.push(ms) }),
  });
  const post = (path: string, body: unknown, ctx?: { waitUntil(work: Promise<unknown>): void }) =>
    routes.fetch(new Request(`https://madar-server.internal/api${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-madar-client-address': ADDRESS }, body: JSON.stringify(body),
    }), {}, ctx);
  return { deps, seen, routes, post, net };
}

describe('the own sign-in routes of the office path (server/entries/officeSignin.ts)', () => {
  it('runs a password sign-in as one step of the office object, with the address that the Pages Function wrote', async () => {
    const { seen, post } = setup();
    const answer = await post('/auth/token', { grant_type: 'password', email: 'hala@madar.test', password: 'a good password' });
    expect([answer.status, answer.headers.get('cache-control'), await answer.json()]).toEqual([200, 'no-store', { access_token: 't', step: 'auth.password' }]);
    expect(seen.signins).toEqual([{ signin: 'auth.password', input: { email: 'hala@madar.test', password: 'a good password', address: ADDRESS } }]);
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
    expect(seen.mailRoutes).toEqual([{ route: 'forgot', body: JSON.stringify({ email: 'hala@madar.test' }), address: ADDRESS }]);
    expect(seen.sleeps).toHaveLength(1);
    expect(seen.sleeps[0]).toBeGreaterThan(1400);
    expect(waits).toHaveLength(1);
    await Promise.all(waits);
    expect(seen.mailWorks).toEqual([{ route: 'forgot', value: 'value-1' }]);
    expect(net.calls).toEqual([]);
  });

  it('answers a refusal of the limits as it is, with no mail work', async () => {
    const refused = '{"v":1,"error":{"code":"conflict","message":"Too many tries. Wait a few minutes, then try again."}}';
    const { seen, post } = setup({ mail: { status: 409, body: refused } });
    const answer = await post('/auth/renew-invite', { key: 'k' });
    expect([answer.status, await answer.text()]).toEqual([409, refused]);
    expect(seen.mailRoutes[0].route).toBe('renew');
    expect(seen.mailWorks).toEqual([]);
  });
});
