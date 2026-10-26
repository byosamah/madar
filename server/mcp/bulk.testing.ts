import type { State } from '../../src/api/store';
import { memoryData, type MemoryData } from '../core/memoryData';
import { createRunCall } from '../core/runCall';
import type { OfficeSnapshot } from '../core/types';
import { fakeDeps } from '../test/fakes/deps';
import { mcpApp } from './app';
import type { AgentPrincipal, AgentToken } from './auth';

/**
 * The harness of the MCP tests for stages.replace, the bulk tools, the paged lists and the light answers (owner, 2026-10-26): the MCP app
 * with the real runCall on the memory office. In the sample office usr_001 is the Admin, usr_002 leads prj_001, usr_005 is on its team and
 * usr_003 is not on it. Only tests import this file.
 */

export const MCP_URL = 'http://127.0.0.1:54321/functions/v1/mcp';
const VERSION = '2026-07-28';
export const TOKEN: AgentToken = {
  token: 'agent-token', authUserId: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f', clientId: '907ef9d7-7bfc-4e2b-ac19-e027f13226fa', sessionId: '1b2c3d4e-5f60-4718-9a0b-1c2d3e4f5a6b',
};

export type World = { app: ReturnType<typeof mcpApp>; mem: MemoryData; agentId: string; /** How many tool calls the minute limit counted. */ hits: { count: number } };

/** A world where the agent usr_950 acts for the given person. `prepare` changes the office before the first request. */
export function world(seed: State, personId: string, prepare?: (state: State) => void): World {
  const agentId = 'usr_950';
  const mem = memoryData(seed);
  mem.tables.state.users[agentId] = { ...mem.tables.state.users.usr_009, id: agentId, email: `${agentId}@madar.test`, ownerId: personId };
  prepare?.(mem.tables.state);
  mem.tables.version += 1;
  const deps = fakeDeps({ db: mem.db, config: { mcpUrl: MCP_URL } });
  deps.clock.set(new Date('2026-10-04T06:00:00Z'));
  const hits = { count: 0 };
  const app = mcpApp(deps, {
    checkToken: async () => TOKEN,
    agentOf: async (): Promise<AgentPrincipal> => ({ principal: { userId: agentId, agent: { clientId: TOKEN.clientId } }, ownerId: personId, linked: false }),
    runCall: createRunCall({ data: () => mem.data() }),
    readOffice: async (): Promise<OfficeSnapshot> => mem.data().office(),
    limit: async () => ({ ok: true, count: ++hits.count, retryAfterMs: 0 }),
    stateKey: 'k'.repeat(40),
  });
  return { app, mem, agentId, hits };
}

let nextRpc = 1;

/** One 2026-07-28 tools/call. The client declares no elicitation, so a reason comes back as a tool error. */
export async function call(w: World, name: string, args: Record<string, unknown>): Promise<Record<string, any>> {
  const response = await w.app.fetch(new Request('http://127.0.0.1/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN.token}`,
      'MCP-Protocol-Version': VERSION, 'Mcp-Method': 'tools/call', 'Mcp-Name': name,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: nextRpc++, method: 'tools/call',
      params: {
        name, arguments: args,
        _meta: { 'io.modelcontextprotocol/protocolVersion': VERSION, 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'test-agent', version: '1.0.0' } },
      },
    }),
  }));
  const text = await response.text();
  const body = JSON.parse(text) as { result?: Record<string, any>; error?: unknown };
  if (!body.result) throw new Error(`The call ${name} gave no result: ${text}`);
  return body.result;
}
