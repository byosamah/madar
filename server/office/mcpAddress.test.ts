import { describe, expect, it } from 'vitest';
import { signAgentToken, signingKeysOf } from '../auth/own/keys';
import { ownIssuer } from '../auth/ownKeys';
import { ENT_VADO } from '../enterprise/ids';
import { httpOf, nodeWorld } from './test/nodeWorld';

/**
 * The MCP address of each enterprise through the real Worker routes into two objects (Madar enterprises, design 5.5): /mcp serves
 * VADOs' Companies and /mcp/globex serves ent_002. The issuer, the audience and the metadata come from the address.
 */
const BASE = 'https://madar.test/mcp';
const GLOBEX = `${BASE}/globex`;

async function world() {
  return nodeWorld({ ents: [ENT_VADO, 'ent_002'], seeds: { ent_002: false } });
}

const get = async (t: Awaited<ReturnType<typeof world>>, path: string, headers: Record<string, string> = {}) => {
  const answer = await t.route(httpOf('GET', path, undefined, headers));
  return { status: answer.status, headers: new Headers(answer.headers), body: answer.body };
};

describe('the MCP address of each enterprise', () => {
  it('names the issuer with the address in the metadata of an enterprise, and without it for VADOs Companies', async () => {
    const t = await world();
    const vado = JSON.parse((await get(t, '/mcp/.well-known/oauth-authorization-server')).body) as { issuer: string; token_endpoint: string };
    const globex = JSON.parse((await get(t, '/mcp/globex/.well-known/oauth-authorization-server')).body) as { issuer: string; token_endpoint: string };
    expect(vado.issuer).toBe(ownIssuer(BASE));
    expect(globex.issuer).toBe(ownIssuer(GLOBEX));
    expect(globex.token_endpoint).toContain('/mcp/globex/');
    const resource = JSON.parse((await get(t, '/mcp/globex/oauth-protected-resource')).body) as { resource: string; authorization_servers: string[] };
    expect(resource).toMatchObject({ resource: GLOBEX, authorization_servers: [ownIssuer(GLOBEX)] });
    const resourceVado = JSON.parse((await get(t, '/mcp/oauth-protected-resource')).body) as { resource: string };
    expect(resourceVado.resource).toBe(BASE);
  });

  it('writes the client of oauth/register under an address in that object only', async () => {
    const t = await world();
    const answer = await t.route(httpOf('POST', '/mcp/globex/oauth/register', { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }));
    expect(answer.status).toBe(201);
    const count = (ent: string) => t.ents.get(ent)!.raw.prepare('select count(*) as n from oauth_clients').get();
    expect(count('ent_002')).toEqual({ n: 1 });
    expect(count(ENT_VADO)).toEqual({ n: 0 });
    const plain = await t.route(httpOf('POST', '/mcp/oauth/register', { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }));
    expect(plain.status).toBe(201);
    expect(count(ENT_VADO)).toEqual({ n: 1 });
    expect(count('ent_002')).toEqual({ n: 1 });
  });

  it('answers a request with no token with the challenge of its own address, and an unknown address like a listed one', async () => {
    const t = await world();
    const vado = await t.route(httpOf('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    const globex = await t.route(httpOf('POST', '/mcp/globex', { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    const nope = await t.route(httpOf('POST', '/mcp/nope', { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    const challenge = (a: { headers: [string, string][] }) => new Headers(a.headers).get('www-authenticate');
    expect([vado.status, globex.status, nope.status]).toEqual([401, 401, 401]);
    expect(challenge(vado)).toContain(`resource_metadata="${BASE}/oauth-protected-resource"`);
    expect(challenge(globex)).toContain(`resource_metadata="${GLOBEX}/oauth-protected-resource"`);
    expect(challenge(nope)).toContain(`resource_metadata="${BASE}/nope/oauth-protected-resource"`);
    // The body of a listed address and of an unknown one is the same, apart from nothing.
    expect(JSON.parse(globex.body)).toEqual(JSON.parse(nope.body));
    expect(t.created).not.toContain('nope');
  });

  it('refuses an agent token of one enterprise on the address of the other, in both directions', async () => {
    const t = await world();
    const token = async (aud: string, ent: string) => signAgentToken(await signingKeysOf(t.jwk, aud), { authId: 'a-1', sessionId: 's-1', clientId: 'c-1', now: new Date(), ent });
    const call = async (path: string, jwt: string) => t.route(httpOf('POST', path, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${jwt}` }));
    // A token of ent_001 on the address of ent_002: wrong audience and wrong claim.
    expect((await call('/mcp/globex', await token(BASE, ENT_VADO))).status).toBe(401);
    // A token with the audience of the address but the claim of the other enterprise: the claim check refuses it.
    expect((await call('/mcp/globex', await token(GLOBEX, ENT_VADO))).status).toBe(401);
    expect((await call('/mcp', await token(BASE, 'ent_002'))).status).toBe(401);
    // A token of ent_002 on /mcp: wrong audience.
    expect((await call('/mcp', await token(GLOBEX, 'ent_002'))).status).toBe(401);
  });

  it('refuses an mcpUrl that is not under the own MCP_URL of the object', async () => {
    const t = await world();
    const net = t.net;
    const out = await t.ents.get(ENT_VADO)!.parts.mcp({ ent: ENT_VADO, mcpUrl: 'https://evil.test/mcp', url: 'https://madar.test/mcp', method: 'POST', headers: [], body: '{}', worker: 0 }, net);
    expect(out.status).toBe(401);
    const sibling = await t.ents.get(ENT_VADO)!.parts.mcp({ ent: ENT_VADO, mcpUrl: 'https://madar.test/mcpx', url: 'https://madar.test/mcp', method: 'POST', headers: [], body: '{}', worker: 0 }, net);
    expect(sibling.status).toBe(401);
  });
});
