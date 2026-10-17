import { describe, expect, it } from 'vitest';
import { addSignIn } from '../../auth/own/testOffice';
import { browserTokenChecker } from '../../auth/verify';
import { ownIssuer, ownKeySet, ownPublicJwks } from '../../auth/ownKeys';
import { signAgentToken, signBrowserToken } from '../../auth/own/keys';
import { ownApiRoutes } from '../../auth/own/routes';
import type { Deps } from '../../core/ports';
import { apiApp } from '../../http/app';
import { oauthApp, TEST_MCP_URL } from './testApp';

const CALLBACK = 'http://127.0.0.1:33418/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

async function world() {
  const w = await oauthApp();
  const api = apiApp(w.t.deps as unknown as Deps, {
    routes: ownApiRoutes(w.office, { jwks: ownPublicJwks(w.jwk), checkToken: browserTokenChecker({ issuer: ownIssuer(TEST_MCP_URL), jwks: ownKeySet(w.jwk) }) }),
  });
  const person = async (userId: string) => {
    const authId = await addSignIn(w.t, userId, { password: 'a good password' });
    const sessionId = crypto.randomUUID();
    w.t.raw.prepare("insert into auth_sessions (id, auth_id, amr, refresh_hash, expires_at) values (?, ?, 'password', ?, '2026-12-01T00:00:00.000Z')").run(sessionId, authId, `h-${sessionId}`);
    return { authId, token: await signBrowserToken(w.keys, { authId, sessionId, now: new Date() }) };
  };
  const call = async (path: string, token: string, o: { method?: string; body?: unknown } = {}) => {
    const response = await api.request(path, { method: o.method ?? 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }) });
    return { status: response.status, text: await response.clone().text(), body: (await response.json()) as Record<string, any> };
  };
  const request = async () => {
    const made = (await (await w.root.request('/mcp/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Secret App Name', redirect_uris: [CALLBACK] }) })).json()) as { client_id: string };
    const location = (await w.root.request(`/mcp/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: made.client_id, redirect_uri: CALLBACK, code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 's-1' })}`)).headers.get('location')!;
    return { clientId: made.client_id, id: new URL(location).searchParams.get('authorization_id')! };
  };
  return { w, person, call, request };
}

describe('the consent with the Madar approval inside (server/mcp/oauth/ops.ts)', () => {
  it('shows the request to the person, needs the Madar approval first, then gives a code with the state', async () => {
    const { person, call, request } = await world();
    const hala = await person('usr_002');
    const { clientId, id } = await request();
    expect(await call(`/oauth/authorizations/${id}`, hala.token, { method: 'GET' })).toMatchObject({ status: 200, body: { authorization_id: id, client: { id: clientId, name: 'Secret App Name' }, redirect_uri: CALLBACK } });
    expect(await call(`/oauth/authorizations/${id}/consent`, hala.token, { body: { action: 'approve' } })).toMatchObject({ status: 403, body: { error: { details: { reason: 'agent_not_approved' } } } });
    expect(await call('/agents/approve', hala.token, { body: { authorizationId: id } })).toMatchObject({ status: 200, body: { approved: true } });
    const done = await call(`/oauth/authorizations/${id}/consent`, hala.token, { body: { action: 'approve' } });
    const back = new URL(done.body.redirect_url);
    expect(`${back.origin}${back.pathname}`).toBe(CALLBACK);
    expect(back.searchParams.get('state')).toBe('s-1');
    expect(back.searchParams.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('gives a known client of the same person its redirect at once', async () => {
    const { w, person, call } = await world();
    const hala = await person('usr_002');
    const first = await (async () => {
      const made = (await (await w.root.request('/mcp/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK] }) })).json()) as { client_id: string };
      return made.client_id;
    })();
    const ask = async () => new URL((await w.root.request(`/mcp/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: first, redirect_uri: CALLBACK, code_challenge: CHALLENGE, code_challenge_method: 'S256' })}`)).headers.get('location')!).searchParams.get('authorization_id')!;
    const one = await ask();
    await call(`/oauth/authorizations/${one}`, hala.token, { method: 'GET' });
    await call('/agents/approve', hala.token, { body: { authorizationId: one } });
    await call(`/oauth/authorizations/${one}/consent`, hala.token, { body: { action: 'approve' } });
    const two = await ask();
    expect((await call(`/oauth/authorizations/${two}`, hala.token, { method: 'GET' })).body.redirect_url).toMatch(/^http:\/\/127\.0\.0\.1:33418\/callback\?code=/);
  });

  it('denies with access_denied and the state, and records no approval', async () => {
    const { w, person, call, request } = await world();
    const hala = await person('usr_002');
    const { id } = await request();
    await call(`/oauth/authorizations/${id}`, hala.token, { method: 'GET' });
    const denied = await call(`/oauth/authorizations/${id}/consent`, hala.token, { body: { action: 'deny' } });
    expect(Object.fromEntries(new URL(denied.body.redirect_url).searchParams)).toEqual({ error: 'access_denied', state: 's-1' });
    expect(w.t.raw.prepare('select count(*) as n from agent_approvals').get()).toEqual({ n: 0 });
  });

  it('gives another person the answer of an unknown request, with no client name, on every path', async () => {
    const { person, call, request } = await world();
    const hala = await person('usr_002');
    const omar = await person('usr_003');
    const { id } = await request();
    await call(`/oauth/authorizations/${id}`, hala.token, { method: 'GET' });
    const theirs = await call(`/oauth/authorizations/${id}`, omar.token, { method: 'GET' });
    const unknown = await call('/oauth/authorizations/nothing-here', omar.token, { method: 'GET' });
    expect([theirs.status, theirs.body]).toEqual([unknown.status, unknown.body]);
    expect(theirs).toMatchObject({ status: 404, body: { error: { details: { reason: 'authorization_ended' } } } });
    const consent = await call(`/oauth/authorizations/${id}/consent`, omar.token, { body: { action: 'approve' } });
    const approve = await call('/agents/approve', omar.token, { body: { authorizationId: id } });
    expect(consent.status).toBe(404);
    expect(approve).toMatchObject({ status: 400, body: { error: { details: { reason: 'authorization_ended' } } } });
    for (const answer of [theirs, unknown, consent, approve]) expect(answer.text).not.toContain('Secret App Name');
  });

  it('refuses an agent token on every consent path', async () => {
    const { w, person, call, request } = await world();
    const hala = await person('usr_002');
    const { id } = await request();
    const agent = await signAgentToken(w.keys, { authId: hala.authId, sessionId: 's-a', clientId: 'c-a', now: new Date() });
    for (const [path, method] of [[`/oauth/authorizations/${id}`, 'GET'], [`/oauth/authorizations/${id}/consent`, 'POST'], ['/agents/approve', 'POST'], ['/oauth/grants', 'POST'], ['/oauth/grants/revoke', 'POST']] as const) {
      expect(await call(path, agent, { method, body: method === 'POST' ? { action: 'approve', authorizationId: id, client_id: 'c-a' } : undefined })).toMatchObject({ status: 403, body: { error: { details: { reason: 'agent_token' } } } });
    }
  });

  it('ends a request after 10 minutes', async () => {
    const { w, person, call, request } = await world();
    const hala = await person('usr_002');
    const { id } = await request();
    w.t.raw.prepare("update oauth_requests set expires_at = '2000-01-01T00:00:00.000Z' where id = ?").run(id);
    expect((await call(`/oauth/authorizations/${id}`, hala.token, { method: 'GET' })).status).toBe(404);
  });

  it('lists only the AI apps of the person, and a revoke of the app of another person changes nothing', async () => {
    const { w, person, call } = await world();
    const hala = await person('usr_002');
    const omar = await person('usr_003');
    w.t.raw.exec(`insert into oauth_clients (id, name, redirect_uris) values ('c-h', 'Hala App', '[]'), ('c-o', 'Omar App', '[]')`);
    w.t.raw.prepare("insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, expires_at) values ('s-h', ?, 'c-h', 'oauth', 'hh', '2099-01-01T00:00:00.000Z'), ('s-o', ?, 'c-o', 'oauth', 'ho', '2099-01-01T00:00:00.000Z')").run(hala.authId, omar.authId);
    expect(await call('/oauth/grants', hala.token)).toMatchObject({ status: 200, body: [{ client_id: 'c-h', client_name: 'Hala App' }] });
    expect((await call('/oauth/grants', hala.token)).text).not.toContain('Omar App');
    expect(await call('/oauth/grants/revoke', hala.token, { body: { client_id: 'c-o' } })).toMatchObject({ status: 200, body: { ok: true } });
    expect(w.t.raw.prepare("select revoked_at from auth_sessions where id = 's-o'").get()).toEqual({ revoked_at: null });
    await call('/oauth/grants/revoke', hala.token, { body: { client_id: 'c-h' } });
    expect((await call('/oauth/grants', hala.token)).body).toEqual([]);
  });
});
