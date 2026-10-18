import {
  discoverAuthorizationServerMetadata, exchangeAuthorization, refreshAuthorization, registerClient, startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { describe, expect, it } from 'vitest';
import { addSignIn } from '../../auth/own/testOffice';
import { oauthApp, TEST_MCP_URL } from './testApp';

const CALLBACK = 'http://127.0.0.1:33418/callback';

async function mcpPost(root: Awaited<ReturnType<typeof oauthApp>>['root'], token: string) {
  const response = await root.request('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const text = await response.text();
  const json = text.startsWith('event:') ? text.split('\n').find((line) => line.startsWith('data: '))!.slice(6) : text;
  return { status: response.status, body: (json ? JSON.parse(json) : {}) as Record<string, any> };
}

describe('an MCP client library against the own OAuth server (@modelcontextprotocol/sdk 1.32.0)', () => {
  it('discovers, registers, gets a code through the Madar approval, exchanges it with PKCE, calls Madar, and refreshes', async () => {
    const w = await oauthApp();
    // async: Hono's fetch may answer with a plain Response, and the FetchLike type of the SDK takes a promise only.
    const fetchFn = async (url: string | URL, init?: RequestInit): Promise<Response> => w.root.fetch(new Request(url, init));
    const metadata = await discoverAuthorizationServerMetadata(TEST_MCP_URL, { fetchFn });
    expect(metadata?.issuer).toBe(TEST_MCP_URL);
    const client = await registerClient(TEST_MCP_URL, { metadata, clientMetadata: { client_name: 'Claude Code', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, fetchFn });
    const { authorizationUrl, codeVerifier } = await startAuthorization(TEST_MCP_URL, { metadata, clientInformation: client, redirectUrl: CALLBACK, state: 's-1', resource: new URL(TEST_MCP_URL) });
    const consent = new URL((await fetchFn(authorizationUrl, { redirect: 'manual' })).headers.get('location')!);
    const id = consent.searchParams.get('authorization_id')!;

    // The person on the consent screen: the steps that the api routes run (Task 18).
    const authId = await addSignIn(w.t, 'usr_002', { password: 'a good password' });
    expect(await w.office.run('oauth.details', { authId, id })).toMatchObject({ ok: true });
    expect(await w.office.run('oauth.approve', { authId, id })).toMatchObject({ ok: true });
    const answered = await w.office.run('oauth.consent', { authId, id, action: 'approve' });
    if (!answered.ok) throw new Error('The consent failed.');
    const code = new URL(answered.value.redirect_url).searchParams.get('code')!;

    const tokens = await exchangeAuthorization(TEST_MCP_URL, { metadata, clientInformation: client, authorizationCode: code, codeVerifier, redirectUri: CALLBACK, resource: new URL(TEST_MCP_URL), fetchFn });
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 900 });
    const first = await mcpPost(w.root, tokens.access_token);
    expect(first.status).toBe(200);
    expect(first.body.result.tools).toHaveLength(44);
    expect(w.t.raw.prepare('select owner_user_id from agent_links').get()).toEqual({ owner_user_id: 'usr_002' });

    const again = await refreshAuthorization(TEST_MCP_URL, { metadata, clientInformation: client, refreshToken: tokens.refresh_token!, resource: new URL(TEST_MCP_URL), fetchFn });
    expect(again.refresh_token).not.toBe(tokens.refresh_token);
    expect((await mcpPost(w.root, again.access_token)).status).toBe(200);
    await expect(exchangeAuthorization(TEST_MCP_URL, { metadata, clientInformation: client, authorizationCode: code, codeVerifier, redirectUri: CALLBACK, resource: new URL(TEST_MCP_URL), fetchFn })).rejects.toThrow();
  });

  it('refuses a wrong PKCE verifier, another client and an old code', async () => {
    const w = await oauthApp();
    const register = async () => (await (await w.root.request('/mcp/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CALLBACK] }) })).json()) as { client_id: string };
    const mine = await register();
    const other = await register();
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const location = (await w.root.request(`/mcp/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: mine.client_id, redirect_uri: CALLBACK, code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256' })}`)).headers.get('location')!;
    const id = new URL(location).searchParams.get('authorization_id')!;
    const authId = await addSignIn(w.t, 'usr_002', { password: 'a good password' });
    await w.office.run('oauth.details', { authId, id });
    await w.office.run('oauth.approve', { authId, id });
    const answered = await w.office.run('oauth.consent', { authId, id, action: 'approve' });
    if (!answered.ok) throw new Error('The consent failed.');
    const code = new URL(answered.value.redirect_url).searchParams.get('code')!;
    const token = (form: Record<string, string>) => w.root.request('/mcp/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, ...form }).toString() });
    expect((await (await token({ client_id: mine.client_id, code_verifier: 'x'.repeat(43) })).json())).toMatchObject({ error: 'invalid_grant' });
    expect((await token({ client_id: other.client_id, code_verifier: verifier })).status).toBe(400);
    w.t.deps.clock.advance(61_000);
    expect((await (await token({ client_id: mine.client_id, code_verifier: verifier })).json())).toMatchObject({ error: 'invalid_grant' });
    expect((await (await w.root.request('/mcp/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=password' })).json())).toMatchObject({ error: 'unsupported_grant_type' });
  });
});
