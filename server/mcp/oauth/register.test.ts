import { describe, expect, it } from 'vitest';
import { oauthApp, TEST_MCP_URL } from './testApp';

const CALLBACK = 'http://127.0.0.1:33418/callback';
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' }, body: JSON.stringify(body) });

async function registered(root: Awaited<ReturnType<typeof oauthApp>>['root'], redirect = CALLBACK) {
  const response = await root.request('/mcp/oauth/register', json({ client_name: 'Claude Code', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }));
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const authorizeUrl = (clientId: string, more: Record<string, string> = {}) => `/mcp/oauth/authorize?${new URLSearchParams({
  response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256', state: 's-1', resource: TEST_MCP_URL, ...more,
})}`;

describe('the OAuth documents, the registration and the authorize step (server/mcp/oauth)', () => {
  it('serves the authorization server document at both discovery paths under /mcp, with the own issuer', async () => {
    const { root } = await oauthApp();
    for (const path of ['/mcp/.well-known/oauth-authorization-server', '/mcp/.well-known/openid-configuration']) {
      const body = (await (await root.request(path)).json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        issuer: TEST_MCP_URL, authorization_endpoint: `${TEST_MCP_URL}/oauth/authorize`, token_endpoint: `${TEST_MCP_URL}/oauth/token`,
        registration_endpoint: `${TEST_MCP_URL}/oauth/register`, jwks_uri: `${TEST_MCP_URL}/oauth/jwks`, code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['ES256'],
      });
      expect(body).not.toHaveProperty('client_id_metadata_document_supported');
    }
    const resource = (await (await root.request('/mcp/oauth-protected-resource')).json()) as { authorization_servers: string[] };
    expect(resource.authorization_servers).toEqual([TEST_MCP_URL]);
  });

  it('registers a public client with safe return addresses', async () => {
    const { root, t } = await oauthApp();
    const made = await registered(root);
    expect(made).toMatchObject({ status: 201, body: { client_name: 'Claude Code', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] } });
    expect(t.raw.prepare('select name, redirect_uris from oauth_clients where id = ?').get(made.body.client_id)).toEqual({ name: 'Claude Code', redirect_uris: JSON.stringify([CALLBACK]) });
  });

  it('refuses a script address, a confidential client and the eleventh registration of one address in an hour', async () => {
    const { root } = await oauthApp();
    expect(await registered(root, 'javascript://claude.ai/%0aalert(1)')).toMatchObject({ status: 400, body: { error: 'invalid_redirect_uri' } });
    const secret = await root.request('/mcp/oauth/register', json({ redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_basic' }));
    expect([secret.status, ((await secret.json()) as { error: string }).error]).toEqual([400, 'invalid_client_metadata']);
    for (let i = 0; i < 8; i += 1) await registered(root);
    expect((await registered(root)).status).toBe(429);
  });

  it('sends the person to the consent screen, and keeps the challenge for 10 minutes', async () => {
    const { root, t } = await oauthApp();
    const { body } = await registered(root);
    const response = await root.request(authorizeUrl(body.client_id));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(`${location.origin}${location.pathname}`).toBe('https://madar.test/oauth/consent');
    const id = location.searchParams.get('authorization_id')!;
    const row = t.raw.prepare('select client_id, redirect_uri, state, code_challenge, status, auth_id, expires_at from oauth_requests where id = ?').get(id) as Record<string, unknown>;
    expect(row).toMatchObject({ client_id: body.client_id, redirect_uri: CALLBACK, state: 's-1', status: 'pending', auth_id: null });
    expect(Date.parse(String(row.expires_at)) - t.deps.clock.now().getTime()).toBe(600_000);
  });

  it('accepts a loopback return address on another port, as RFC 8252 says', async () => {
    const { root } = await oauthApp();
    const { body } = await registered(root);
    expect((await root.request(authorizeUrl(body.client_id, { redirect_uri: 'http://127.0.0.1:51000/callback' }))).status).toBe(302);
  });

  it('never sends an error to an unknown client or address, and sends the other errors back to the client', async () => {
    const { root } = await oauthApp();
    const { body } = await registered(root);
    expect((await root.request(authorizeUrl('nobody'))).status).toBe(400);
    expect((await root.request(authorizeUrl(body.client_id, { redirect_uri: 'https://evil.example/cb' }))).status).toBe(400);
    const plain = await root.request(authorizeUrl(body.client_id, { code_challenge_method: 'plain' }));
    expect(new URL(plain.headers.get('location')!).searchParams.get('error')).toBe('invalid_request');
    const other = await root.request(authorizeUrl(body.client_id, { resource: 'https://other.example/mcp' }));
    expect(Object.fromEntries(new URL(other.headers.get('location')!).searchParams)).toEqual({ error: 'invalid_target', state: 's-1' });
  });
});
