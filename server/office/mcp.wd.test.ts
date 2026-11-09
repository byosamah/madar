import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { signAgentToken, signingKeysOf } from '../auth/own/keys';
import { startLive } from './test/live/harness';
import { ENT_VADO } from '../enterprise/ids';

const TODAY = new Date().toISOString().slice(0, 10);
const MCP_URL = 'https://madar.test/mcp';

/**
 * MCP on the office path on local workerd (the merge of exit waves 2 and 3): the Worker routes hand /mcp to the production class
 * Office (TestOffice of the live suites), which checks the own agent token, finds the agent on SQLite and runs each tool call on
 * its batch path. The token is signed here with the key of the run, as the OAuth token step of the object signs it.
 */
describe('MCP through the office object on local workerd', () => {
  let live: Awaited<ReturnType<typeof startLive>>;
  beforeAll(async () => {
    live = await startLive();
  }, 120_000);
  afterAll(async () => {
    await live?.server.close();
  });

  const tokenFor = async (ownerId: string) => {
    const { authId, clientId, sessionId } = await live.agent(ownerId);
    return signAgentToken(await signingKeysOf(live.jwk, MCP_URL), { authId, sessionId, clientId, now: new Date(), ent: ENT_VADO });
  };

  it('gives an agent token the tools of its person and runs one tool call through the office object', async () => {
    await live.fresh(await buildSeed(TODAY, async () => undefined));
    const token = await tokenFor('usr_002');
    const list = await live.mcp(token, 'tools/list');
    expect(list.status).toBe(200);
    expect((list.body.result?.tools as { name: string }[]).map((tool) => tool.name)).toContain('projects.list');
    const call = await live.mcp(token, 'tools/call', { name: 'projects.list', arguments: {} });
    expect([call.status, call.body.result?.isError ?? false]).toEqual([200, false]);
    expect(Array.isArray(call.body.result?.structuredContent.output)).toBe(true);
    expect(await live.rows("select count(*) as n from agent_links where owner_user_id = 'usr_002' and revoked_at is null")).toEqual([{ n: 1 }]);
  });

  it('refuses the agent of a person whom an Admin turned off, and a request with no token', async () => {
    await live.fresh(await buildSeed(TODAY, async () => undefined));
    const token = await tokenFor('usr_002');
    expect((await live.mcp(token, 'tools/list')).status).toBe(200);
    const off = await live.batch('usr_001', [{ name: 'users.deactivate', input: { id: 'usr_002' } }]);
    expect(off.body.results[0].ok).toBe(true);
    expect([401, 403]).toContain((await live.mcp(token, 'tools/list')).status);
    expect((await live.mcp(token, 'tools/call', { name: 'projects.list', arguments: {} })).body.result).toBeUndefined();
    expect((await live.mcp(null, 'tools/list')).status).toBe(401);
  });
});

/**
 * The old agent tokens after the move of VADO (plan E, Review Focus 3): a token of the Supabase key, and a token of the own key with no
 * claim ent. The object refuses both with 401 and the challenge, never with a 500, so the AI app asks the person to connect again.
 */
describe('an old agent token on the office path (plan E)', () => {
  let live: Awaited<ReturnType<typeof startLive>>;
  beforeAll(async () => {
    live = await startLive();
  }, 120_000);
  afterAll(async () => {
    await live?.server.close();
  });

  /** The claims of an old Supabase agent token: no ent. It is signed here with the own key (no ent) or with a foreign key. */
  const withNoEnt = async (key: CryptoKey, kid: string) => {
    const { authId, clientId, sessionId } = await live.agent('usr_002');
    const iat = Math.floor(Date.now() / 1000);
    return new SignJWT({ role: 'authenticated', session_id: sessionId, client_id: clientId })
      .setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' }).setIssuer((await signingKeysOf(live.jwk, MCP_URL)).issuer).setAudience((await signingKeysOf(live.jwk, MCP_URL)).mcpUrl)
      .setSubject(authId).setIssuedAt(iat).setExpirationTime(iat + 900).sign(key);
  };

  it('answers 401 with WWW-Authenticate for an agent token of the own key that has no ent claim', async () => {
    await live.fresh(await buildSeed(TODAY, async () => undefined));
    const keys = await signingKeysOf(live.jwk, MCP_URL);
    const answer = await live.mcp(await withNoEnt(keys.key, keys.kid), 'tools/list');
    expect(answer.status).toBe(401);
    expect(answer.headers.get('www-authenticate')).toMatch(/resource_metadata=/);
    expect(answer.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('answers 401 with WWW-Authenticate for an agent token that another key signed (the Supabase key), and for a tool call', async () => {
    await live.fresh(await buildSeed(TODAY, async () => undefined));
    const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const token = await withNoEnt(other.privateKey, 'supabase-key');
    for (const [method, params] of [['tools/list', {}], ['tools/call', { name: 'projects.list', arguments: {} }]] as const) {
      const answer = await live.mcp(token, method, params);
      expect([method, answer.status]).toEqual([method, 401]);
      expect(answer.headers.get('www-authenticate')).toMatch(/resource_metadata=/);
    }
  });
});

/**
 * Two objects (Madar enterprises, design 5.5): /mcp serves ent_001 and /mcp/globex serves ent_002. The Worker finds the object from the
 * address, and the object checks the claim ent of the token again.
 */
describe('the MCP address of two enterprises on local workerd', () => {
  let live: Awaited<ReturnType<typeof startLive>>;
  beforeAll(async () => {
    live = await startLive();
  }, 120_000);
  afterAll(async () => {
    await live?.server.close();
  });

  const GLOBEX_URL = `${MCP_URL}/globex`;
  const tokenFor = async (ownerId: string, o: { ent: string; aud: string; agentIn?: string }) => {
    const { authId, clientId, sessionId } = await live.agent(ownerId, o.agentIn ? { ent: o.agentIn } : {});
    return signAgentToken(await signingKeysOf(live.jwk, o.aud), { authId, sessionId, clientId, now: new Date(), ent: o.ent });
  };
  const setup = async () => {
    await live.fresh(await buildSeed(TODAY, async () => undefined));
    await live.seedEnterprise('ent_002', await buildSeed(TODAY, async () => undefined), 'globex');
  };

  it('an agent token of ent_001 sent to /mcp/globex gets 401, and a token of ent_002 sent to /mcp gets 401', async () => {
    await setup();
    const one = await tokenFor('usr_002', { ent: 'ent_001', aud: MCP_URL });
    expect((await live.mcp(one, 'tools/list')).status).toBe(200);
    expect((await live.mcp(one, 'tools/list', {}, { path: '/mcp/globex' })).status).toBe(401);
    const two = await tokenFor('usr_002', { ent: 'ent_002', aud: GLOBEX_URL, agentIn: 'ent_002' });
    expect((await live.mcp(two, 'tools/list')).status).toBe(401);
  });

  it('a token issued under /mcp/globex has the address in its audience, and works only there', async () => {
    await setup();
    const two = await tokenFor('usr_002', { ent: 'ent_002', aud: GLOBEX_URL, agentIn: 'ent_002' });
    const list = await live.mcp(two, 'tools/list', {}, { path: '/mcp/globex' });
    expect(list.status).toBe(200);
    expect((list.body.result?.tools as { name: string }[]).map((tool) => tool.name)).toContain('projects.list');
    // The tools run in the object of ent_002: the agent link is a row of that object only.
    expect(await live.rows("select count(*) as n from agent_links", [], { ent: 'ent_002' })).toEqual([{ n: 1 }]);
    expect(await live.rows("select count(*) as n from agent_links", [])).toEqual([{ n: 0 }]);
  });

  it('the metadata under /mcp/globex names the issuer with the address, and oauth/register under it writes the client in ent_002 only', async () => {
    await setup();
    const document = await live.worker().fetch('/mcp/globex/.well-known/oauth-authorization-server');
    expect(((await document.json()) as { issuer: string }).issuer).toBe(GLOBEX_URL);
    const register = await live.worker().fetch('/mcp/globex/oauth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }),
    });
    expect(register.status).toBe(201);
    expect(await live.rows('select count(*) as n from oauth_clients', [], { ent: 'ent_002' })).toEqual([{ n: 1 }]);
    expect(await live.rows('select count(*) as n from oauth_clients', [])).toEqual([{ n: 0 }]);
  });

  it('answers an address that no enterprise holds with 401 and makes no object', async () => {
    await setup();
    expect((await live.mcp(null, 'tools/list', {}, { path: '/mcp/nobody' })).status).toBe(401);
    expect((await live.mcp(null, 'tools/list', {}, { path: '/mcp/Globex' })).status).toBe(401);
  });
});
