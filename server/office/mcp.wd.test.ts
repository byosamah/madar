import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { signAgentToken, signingKeysOf } from '../auth/own/keys';
import { startLive } from './test/live/harness';

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
    return signAgentToken(await signingKeysOf(live.jwk, MCP_URL), { authId, sessionId, clientId, now: new Date() });
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
