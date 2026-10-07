import { beforeAll, describe, expect, it } from 'vitest';
import type { Feedback } from '../../src/api/contract/entities';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { memoryData, type MemoryData } from '../core/memoryData';
import { createRunCall } from '../core/runCall';
import type { OfficeSnapshot } from '../core/types';
import { fakeDeps, type FakeDeps } from '../test/fakes/deps';
import { mcpApp } from './app';
import type { AgentPrincipal, AgentToken } from './auth';

/**
 * The 3 Admin tools of requests and bugs over MCP (owner, 2026-10-07), in process: the MCP app with the real runCall on the memory
 * office and the files fake. The agent is usr_009, the agent of the Admin usr_001. The token check is a fake here; app.test.ts
 * covers the real one. An agent never gets a storage key (run.ts): a screenshot keeps only its type, and feedback.screenshot
 * gives a signed link.
 */

const MCP_URL = 'http://127.0.0.1:54321/functions/v1/mcp';
const VERSION = '2026-07-28';
const TOKEN: AgentToken = {
  token: 'agent-token', authUserId: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f', clientId: '907ef9d7-7bfc-4e2b-ac19-e027f13226fa', sessionId: '1b2c3d4e-5f60-4718-9a0b-1c2d3e4f5a6b',
};

const report = (id: string, o: Partial<Feedback>): Feedback => ({
  id, kind: 'bug', message: 'The board does not scroll on my phone.', page: '/projects', screenshots: [], status: 'new',
  createdBy: 'usr_003', createdAt: '2026-10-03T08:00:00.000Z', doneBy: null, doneAt: null, ...o,
});

let seed: State;

beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
  seed.feedback = {
    fbk_001: report('fbk_001', { screenshots: [{ blobKey: 'feedback/upl-a/file', type: 'image/png' }, { blobKey: 'feedback/upl-b/file', type: 'image/webp' }] }),
    fbk_002: report('fbk_002', { kind: 'feature', message: 'Add a print view.', createdBy: 'usr_002', status: 'done', doneBy: 'usr_001', doneAt: '2026-10-03T09:00:00.000Z' }),
  };
  seed.counters.fbk = 2;
});

type World = { app: ReturnType<typeof mcpApp>; deps: FakeDeps; mem: MemoryData };

function world(): World {
  const mem = memoryData(seed);
  const deps = fakeDeps({ db: mem.db, config: { mcpUrl: MCP_URL } });
  deps.clock.set(new Date('2026-10-04T06:00:00Z'));
  const app = mcpApp(deps, {
    checkToken: async () => TOKEN,
    agentOf: async (): Promise<AgentPrincipal> => ({ principal: { userId: 'usr_009', agent: { clientId: TOKEN.clientId } }, ownerId: 'usr_001', linked: false }),
    runCall: createRunCall({ data: () => mem.data() }),
    readOffice: async (): Promise<OfficeSnapshot> => mem.data().office(),
    limit: async () => ({ ok: true, count: 1, retryAfterMs: 0 }),
    stateKey: 'k'.repeat(40),
  });
  return { app, deps, mem };
}

let nextId = 1;

/** One 2026-07-28 tools/call, with the headers and the _meta envelope of the version. */
async function call(w: World, name: string, args: Record<string, unknown>): Promise<{ text: string; result: Record<string, any> }> {
  const response = await w.app.fetch(new Request('http://127.0.0.1/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN.token}`,
      'MCP-Protocol-Version': VERSION, 'Mcp-Method': 'tools/call', 'Mcp-Name': name,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: nextId++, method: 'tools/call',
      params: {
        name, arguments: args,
        _meta: { 'io.modelcontextprotocol/protocolVersion': VERSION, 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'test-agent', version: '1.0.0' } },
      },
    }),
  }));
  const text = await response.text();
  const body = JSON.parse(text) as { result?: Record<string, any>; error?: unknown };
  if (!body.result) throw new Error(`The call ${name} gave no result: ${text}`);
  return { text, result: body.result };
}

describe('the Admin tools of requests and bugs over MCP (owner, 2026-10-07)', () => {
  it('gives an agent of an Admin a signed link to a screenshot from feedback.screenshot, as it is', async () => {
    const w = world();
    const { result } = await call(w, 'feedback.screenshot', { id: 'fbk_001', index: 1 });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(result.structuredContent.output).toEqual({ url: 'https://files.test/get/feedback/upl-b/file?disposition=inline', expiresAt: '2099-01-01T00:00:00.000Z' });
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    expect(w.deps.files.calls).toEqual([{ op: 'presignGet', key: 'feedback/upl-b/file' }]);
  });

  it('answers not_found for a screenshot that the report does not have, and signs nothing', async () => {
    const w = world();
    const { result } = await call(w, 'feedback.screenshot', { id: 'fbk_002', index: 0 });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe('not_found');
    expect(w.deps.files.calls).toEqual([]);
  });

  it('lists the reports with no storage key: each screenshot keeps its type, and the count stays', async () => {
    const w = world();
    const { text, result } = await call(w, 'feedback.list', {});
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(text).not.toContain('blobKey');
    expect(text).not.toContain('feedback/upl-');
    const rows = result.structuredContent.output as { item: Feedback; screenshots: number; sender: { id: string } }[];
    expect(rows.map((row) => row.item.id)).toEqual(['fbk_001', 'fbk_002']);
    expect(rows[0]).toMatchObject({ screenshots: 2, sender: { id: 'usr_003' }, item: { status: 'new', message: 'The board does not scroll on my phone.' } });
    expect(rows[0].item.screenshots).toEqual([{ type: 'image/png' }, { type: 'image/webp' }]);
    expect(rows[1]).toMatchObject({ screenshots: 0, item: { screenshots: [] } });
  });

  it('marks a report done and answers with no storage key, while the stored report keeps its keys', async () => {
    const w = world();
    const { text, result } = await call(w, 'feedback.setStatus', { id: 'fbk_001', status: 'done' });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(text).not.toContain('blobKey');
    expect(result.structuredContent.output).toMatchObject({ id: 'fbk_001', status: 'done', doneBy: 'usr_009', screenshots: [{ type: 'image/png' }, { type: 'image/webp' }] });
    expect(w.mem.tables.state.feedback!.fbk_001.screenshots).toEqual(seed.feedback!.fbk_001.screenshots);
    expect(w.mem.tables.state.feedback!.fbk_001.status).toBe('done');
  });
});
