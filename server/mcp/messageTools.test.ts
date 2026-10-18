import { beforeAll, describe, expect, it } from 'vitest';
import type { Message } from '../../src/api/contract/entities';
import type { ChatRow } from '../../src/api/contract/views';
import { addDirectConversation, addGroupConversation } from '../../src/api/chatState';
import { nextId, type State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { memoryData, type MemoryData } from '../core/memoryData';
import { createRunCall } from '../core/runCall';
import type { OfficeSnapshot } from '../core/types';
import { fakeDeps, type FakeDeps } from '../test/fakes/deps';
import { mcpApp } from './app';
import type { AgentPrincipal, AgentToken } from './auth';

/**
 * The message tools over MCP (owner, 2026-10-12; fbk_011, owner 2026-10-18): an agent finds a chat, reads the messages of a chat its
 * person may open, lists what waits for the reply of its person, opens the direct chat with a person and sends one message, as its
 * person. An agent never marks a chat read. In process, as feedbackTools.test.ts: the MCP app with the real runCall on the memory
 * office. The agent is usr_009, the agent of the Admin usr_001.
 */

const MCP_URL = 'http://127.0.0.1:54321/functions/v1/mcp';
const VERSION = '2026-07-28';
const TOKEN: AgentToken = {
  token: 'agent-token', authUserId: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f', clientId: '907ef9d7-7bfc-4e2b-ac19-e027f13226fa', sessionId: '1b2c3d4e-5f60-4718-9a0b-1c2d3e4f5a6b',
};
const SECRET = 'The private offer is 90000.';
const STAMP = '2026-10-04T05:00:00.000Z';

let seed: State;
let hala3: string;
let faisalAndTurki: string;
let projectRoom: string;
let groupRoom: string;
const GROUP_SECRET = 'The group text is for the group only.';
const OUTSIDER_SECRET = 'The other team text is not for the Admin.';
let outsiderRoom: string;

function say(state: State, conversationId: string, authorId: string, body: string): void {
  const id = nextId(state, 'msg');
  const message: Message = { id, conversationId, authorId, actingForId: authorId, body, mentions: [], createdAt: STAMP, editedAt: null };
  state.messages[id] = message;
}

beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
  // The Admin (usr_001) and Reem (usr_003) have one direct chat with a private message. Faisal (usr_002) and Turki (usr_010) have another.
  const direct = Object.values(seed.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes('usr_001') && c.memberIds.includes('usr_003'));
  hala3 = direct?.id ?? addDirectConversation(seed, 'usr_001', 'usr_003', STAMP).id;
  say(seed, hala3, 'usr_003', SECRET);
  faisalAndTurki = addDirectConversation(seed, 'usr_002', 'usr_010', STAMP).id;
  say(seed, faisalAndTurki, 'usr_010', 'A chat that the Admin may not open.');
  projectRoom = Object.values(seed.conversations).find((c) => c.kind === 'project')!.id;
  // A group of the Admin (the person of the agent), Reem and Turki, with a text that no agent may read.
  groupRoom = addGroupConversation(seed, 'Tower team', 'usr_003', ['usr_003', 'usr_001', 'usr_010'], STAMP).id;
  say(seed, groupRoom, 'usr_010', GROUP_SECRET);
  // A group that the Admin is not in: an agent of the Admin may not read it, and its id answers as a missing chat.
  outsiderRoom = addGroupConversation(seed, 'Other team', 'usr_003', ['usr_003', 'usr_010', 'usr_002'], STAMP).id;
  say(seed, outsiderRoom, 'usr_010', OUTSIDER_SECRET);
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

let nextRpc = 1;

/** One 2026-07-28 tools/call, with the headers and the _meta envelope of the version. */
async function call(w: World, name: string, args: Record<string, unknown>): Promise<{ text: string; result: Record<string, any> }> {
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
  return { text, result: body.result };
}

describe('the message tools over MCP (owner, 2026-10-12)', () => {
  it('opens the direct chat that exists with a person, and makes one with a person who has none', async () => {
    const w = world();
    const existing = await call(w, 'chats.openDirect', { userId: 'usr_003' });
    expect(existing.result.isError, JSON.stringify(existing.result)).toBeUndefined();
    expect(existing.result.structuredContent.output).toEqual({ id: hala3 });
    const before = Object.keys(w.mem.tables.state.conversations).length;
    const made = await call(w, 'chats.openDirect', { userId: 'usr_005' });
    expect(made.result.isError, JSON.stringify(made.result)).toBeUndefined();
    const created = w.mem.tables.state.conversations[made.result.structuredContent.output.id];
    expect(created).toMatchObject({ kind: 'direct', memberIds: ['usr_001', 'usr_005'] });
    expect(Object.keys(w.mem.tables.state.conversations)).toHaveLength(before + 1);
  });

  it('sends a direct message as the person, with the agent named beside it', async () => {
    const w = world();
    const { result } = await call(w, 'chats.send', { conversationId: hala3, body: 'The new task list is live.' });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const view = result.structuredContent.output;
    expect(view.message).toMatchObject({ conversationId: hala3, authorId: 'usr_009', actingForId: 'usr_001', body: 'The new task list is live.' });
    expect(view.actingFor).toMatchObject({ id: 'usr_001' });
    const stored = Object.values(w.mem.tables.state.messages).find((m) => m.body === 'The new task list is live.');
    expect(stored).toMatchObject({ conversationId: hala3, authorId: 'usr_009', actingForId: 'usr_001' });
  });

  it('writes no event for a sent message, so no Undo takes it back (the tool texts say so)', async () => {
    const w = world();
    const events = Object.keys(w.mem.tables.state.events).length;
    const { result } = await call(w, 'chats.send', { conversationId: hala3, body: 'One more line.' });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(Object.keys(w.mem.tables.state.events)).toHaveLength(events);
  });

  it('sends a message into a project chat that the person may open', async () => {
    const w = world();
    const { result } = await call(w, 'chats.send', { conversationId: projectRoom, body: 'The drawings are on the drive.' });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(Object.values(w.mem.tables.state.messages).find((m) => m.body === 'The drawings are on the drive.')).toMatchObject({ conversationId: projectRoom, actingForId: 'usr_001' });
  });

  it('refuses a message into a direct chat of two other people, and stores nothing', async () => {
    const w = world();
    const { result } = await call(w, 'chats.send', { conversationId: faisalAndTurki, body: 'Hello.' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe('forbidden');
    expect(Object.values(w.mem.tables.state.messages).some((m) => m.body === 'Hello.')).toBe(false);
  });

  it('lists a direct chat with its preview, because the agent reads the chats of its person (fbk_011)', async () => {
    const w = world();
    const { text, result } = await call(w, 'chats.list', {});
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(text).toContain(SECRET);
    const rows = result.structuredContent.output as ChatRow[];
    const direct = rows.find((row) => row.id === hala3)!;
    expect(direct).toMatchObject({ kind: 'direct', preview: SECRET, previewAuthor: { id: 'usr_003' }, previewMine: false });
    expect(direct.person).toMatchObject({ id: 'usr_003' });
  });

  it('lists a group with its preview, and never a group that the person is not in', async () => {
    const w = world();
    const { text, result } = await call(w, 'chats.list', {});
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(text).toContain(GROUP_SECRET);
    expect(text).not.toContain(OUTSIDER_SECRET);
    const rows = result.structuredContent.output as ChatRow[];
    expect(rows.find((row) => row.id === groupRoom)).toMatchObject({
      kind: 'group', title: 'Tower team', preview: GROUP_SECRET, previewAuthor: { id: 'usr_010' }, previewMine: false,
    });
    expect(rows.some((row) => row.id === outsiderRoom)).toBe(false);
  });

  it('reads one page of a direct chat of its person with chats.messages', async () => {
    const w = world();
    const { text, result } = await call(w, 'chats.messages', { conversationId: hala3 });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(text).toContain(SECRET);
    const messages = result.structuredContent.output.messages as { message: Message; author: { id: string } }[];
    expect(messages.find((m) => m.message.body === SECRET)).toMatchObject({ author: { id: 'usr_003' } });
  });

  it('reads a group of its person with chats.messages', async () => {
    const w = world();
    const { text, result } = await call(w, 'chats.messages', { conversationId: groupRoom });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(text).toContain(GROUP_SECRET);
  });

  it('answers not_found for a group that its person is not in, with no text of it', async () => {
    const w = world();
    const { text, result } = await call(w, 'chats.messages', { conversationId: outsiderRoom });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe('not_found');
    expect(text).not.toContain(OUTSIDER_SECRET);
  });

  it('lists what waits for the reply of its person with chats.waiting, as data', async () => {
    const w = world();
    const { text, result } = await call(w, 'chats.waiting', {});
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(text).not.toContain(OUTSIDER_SECRET);
    const rows = result.structuredContent.output as { kind: string; id: string; from: { id: string }; body: string }[];
    expect(rows.find((row) => row.id === hala3)).toMatchObject({ kind: 'direct', from: { id: 'usr_003' }, body: SECRET });
    expect(rows.find((row) => row.id === groupRoom)).toMatchObject({ kind: 'group', from: { id: 'usr_010' }, body: GROUP_SECRET });
    expect(rows.some((row) => row.id === outsiderRoom)).toBe(false);
  });
});
