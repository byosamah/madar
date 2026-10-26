import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { memoryData, type MemoryData } from '../core/memoryData';
import { createRunCall } from '../core/runCall';
import type { OfficeSnapshot } from '../core/types';
import { fakeDeps, type FakeDeps } from '../test/fakes/deps';
import { mcpApp } from './app';
import type { AgentPrincipal, AgentToken } from './auth';
import { MCP_ALLOW, MCP_DENY } from './tools';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';

/**
 * A hidden project over MCP (hidden projects, owner 2026-10-22). The agent of a person who does not see a hidden project gets, for the
 * project and for every record in it, the answer of a missing record: the same code and the same text. The agent of a person who sees it
 * reads it. In process, as meetingTools.test.ts. prj_005 (leader usr_003, team usr_007) is hidden, with usr_011 chosen.
 */
const MCP_URL = 'http://127.0.0.1:54321/functions/v1/mcp';
const VERSION = '2026-07-28';
const NOW = new Date('2026-10-04T06:00:00Z');
const TOKEN: AgentToken = {
  token: 'agent-token', authUserId: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f', clientId: '907ef9d7-7bfc-4e2b-ac19-e027f13226fa', sessionId: '1b2c3d4e-5f60-4718-9a0b-1c2d3e4f5a6b',
};
const HIDDEN = 'prj_005';

let seed: State;
let taskId: string;
let commentTaskId: string;

beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
  seed.projects[HIDDEN].access = { hidden: true, viewerIds: ['usr_011'] };
  taskId = Object.values(seed.tasks).find((t) => t.projectId === HIDDEN)!.id;
  commentTaskId = taskId;
});

type World = { app: ReturnType<typeof mcpApp>; deps: FakeDeps; mem: MemoryData };
type Acting = { agentId: string; personId: string };
const agentOf = (personId: string): Acting => ({ agentId: `usr_9${personId.slice(-2)}`, personId });

function world(acting: Acting): World {
  const mem = memoryData(seed);
  mem.tables.state.users[acting.agentId] = { ...mem.tables.state.users.usr_009, id: acting.agentId, email: `${acting.agentId}@madar.test`, ownerId: acting.personId };
  mem.tables.version += 1;
  const deps = fakeDeps({ db: mem.db, config: { mcpUrl: MCP_URL } });
  deps.clock.set(NOW);
  const app = mcpApp(deps, {
    checkToken: async () => TOKEN,
    agentOf: async (): Promise<AgentPrincipal> => ({ principal: { userId: acting.agentId, agent: { clientId: TOKEN.clientId } }, ownerId: acting.personId, linked: false }),
    runCall: createRunCall({ data: () => mem.data() }),
    readOffice: async (): Promise<OfficeSnapshot> => mem.data().office(),
    limit: async () => ({ ok: true, count: 1, retryAfterMs: 0 }),
    stateKey: 'k'.repeat(40),
  });
  return { app, deps, mem };
}

let nextRpc = 1;
async function call(w: World, name: string, args: Record<string, unknown>) {
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
  const body = JSON.parse(await response.text()) as { result: Record<string, any> };
  return body.result;
}
const errorOf = (result: Record<string, any>) => ({ isError: result.isError, error: result.structuredContent?.error as { code: string; message: string; details?: unknown } | undefined });
const swap = (value: unknown, id: string) => JSON.parse(JSON.stringify(value ?? null).split(id).join('@')) as unknown;

describe('the tools that name a hidden project, for the agent of a person who does not see it', () => {
  it('answer as for a missing record, for the project and for each record in it', async () => {
    const w = world(agentOf('usr_002'));
    const probes: [string, Record<string, unknown>, Record<string, unknown>, string][] = [
      ['projects.get', { id: HIDDEN }, { id: 'prj_999' }, HIDDEN],
      ['updates.list', { projectId: HIDDEN }, { projectId: 'prj_999' }, HIDDEN],
      ['files.list', { projectId: HIDDEN }, { projectId: 'prj_999' }, HIDDEN],
      ['tracker.list', { projectId: HIDDEN }, { projectId: 'prj_999' }, HIDDEN],
      ['deadlines.create', { projectId: HIDDEN, name: 'Due', date: '2026-12-01' }, { projectId: 'prj_999', name: 'Due', date: '2026-12-01' }, HIDDEN],
      ['updates.create', { projectId: HIDDEN, body: 'Hello' }, { projectId: 'prj_999', body: 'Hello' }, HIDDEN],
      ['tasks.create', { projectId: HIDDEN, title: 'Mine' }, { projectId: 'prj_999', title: 'Mine' }, HIDDEN],
      ['tasks.get', { id: taskId }, { id: 'tsk_999' }, taskId],
      ['tasks.update', { id: taskId, patch: { title: 'Mine' } }, { id: 'tsk_999', patch: { title: 'Mine' } }, taskId],
      ['comments.list', { targetType: 'task', targetId: commentTaskId }, { targetType: 'task', targetId: 'tsk_999' }, commentTaskId],
      ['comments.create', { targetType: 'task', targetId: commentTaskId, body: 'Mine' }, { targetType: 'task', targetId: 'tsk_999', body: 'Mine' }, commentTaskId],
      ['meetings.list', { projectId: HIDDEN, mine: false }, { projectId: 'prj_999', mine: false }, HIDDEN],
    ];
    for (const [name, hidden, gone, id] of probes) {
      const a = errorOf(await call(w, name, hidden));
      const b = errorOf(await call(w, name, gone));
      expect(a.isError, name).toBe(true);
      expect(a.error?.code, name).toBe('not_found');
      expect(swap(a, id), name).toEqual(swap(b, JSON.stringify(gone).match(/"([a-z]{3}_999)"/)![1]));
    }
  });

  it('leave the project out of the History of the agent, and out of a search', async () => {
    const w = world(agentOf('usr_002'));
    const events = JSON.stringify((await call(w, 'events.list', { limit: 500 })).structuredContent.output);
    expect(events).not.toContain(`"projectId":"${HIDDEN}"`);
    expect(JSON.stringify((await call(w, 'events.list', { projectId: HIDDEN })).structuredContent.output)).toBe('[]');
  });

  it('give the agent of the leader, of a chosen person and of the Admin the project', async () => {
    for (const person of ['usr_003', 'usr_011', 'usr_001']) {
      const w = world(agentOf(person));
      const got = await call(w, 'projects.get', { id: HIDDEN });
      expect(got.isError, person).toBeUndefined();
      expect(got.structuredContent.output.project.id).toBe(HIDDEN);
      expect(got.structuredContent.output.project.access).toEqual({ hidden: true, viewerIds: ['usr_011'] });
    }
  });
});

describe('the lists and the words of the hidden projects', () => {
  it('put projects.setAccess on the allow list (MCP parity, owner 2026-10-26), and tell the agent in the instructions and in the docs', () => {
    expect(MCP_ALLOW as readonly string[]).toContain('projects.setAccess');
    expect(MCP_DENY as readonly string[]).not.toContain('projects.setAccess');
    expect(TOOL_DOCS['projects.setAccess'].description).toContain('Ask your person first');
    expect(INSTRUCTIONS).toContain('may be hidden from your person');
    expect(INSTRUCTIONS).not.toMatch(/[–—]/);
    for (const name of ['projects.get', 'projects.list']) {
      expect(TOOL_DOCS[name].description, name).toContain('access');
      expect(TOOL_DOCS[name].description.length, name).toBeLessThanOrEqual(600);
    }
  });
});
