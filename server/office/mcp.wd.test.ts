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
