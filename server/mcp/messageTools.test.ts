import { beforeAll, describe, expect, it } from 'vitest';
import type { Message } from '../../src/api/contract/entities';
import type { ChatRow } from '../../src/api/contract/views';
import { addDirectConversation, addGroupConversation } from '../../src/api/chatState';
import { nextId, type State } from '../../src/api/store';
import { makeTask } from '../../src/test/factories';
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

/** The agent of the tests: usr_009 acts for the Admin. A test may name another agent (made by agentOf below) for another person. */
type Acting = { agentId: string; personId: string };
const ADMIN_AGENT: Acting = { agentId: 'usr_009', personId: 'usr_001' };

function world(acting: Acting = ADMIN_AGENT): World {
  const mem = memoryData(seed);
  if (acting.agentId !== ADMIN_AGENT.agentId) {
    mem.tables.state.users[acting.agentId] = { ...mem.tables.state.users.usr_009, id: acting.agentId, email: `${acting.agentId}@madar.test`, ownerId: acting.personId };
    mem.tables.version += 1;
  }
  const deps = fakeDeps({ db: mem.db, config: { mcpUrl: MCP_URL } });
  deps.clock.set(new Date('2026-10-04T06:00:00Z'));
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

/**
 * The reads of an agent after a removal and for the file rows of a message (fbk_011, security review 2026-10-18). An agent acts with
 * the rights of its person, so it gets the answers of its person: not_found for a group that its person left, and a file row only
 * for a file that its person may view.
 */
const OFFICE_FILE_NAME = 'Licence-scan.pdf';

describe('the agent of a person who left a group', () => {
  it('reads nothing of the group, sends nothing into it, and the answers are those of a missing chat', async () => {
    const w = world();
    const room = w.mem.tables.state.conversations[groupRoom];
    w.mem.tables.state.conversations[groupRoom] = { ...room, memberIds: room.memberIds.filter((id) => id !== 'usr_001') };
    w.mem.tables.version += 1;
    const stored = Object.keys(w.mem.tables.state.messages).length;
    const read = await call(w, 'chats.messages', { conversationId: groupRoom });
    expect(read.result.isError).toBe(true);
    expect(read.result.structuredContent.error).toMatchObject({ code: 'not_found', message: `Conversation ${groupRoom} does not exist.` });
    expect(read.text).not.toContain(GROUP_SECRET);
    for (const fileIds of [[], ['fil_001']]) {
      const sent = await call(w, 'chats.send', { conversationId: groupRoom, body: 'Still here?', fileIds });
      expect(sent.result.isError, JSON.stringify(fileIds)).toBe(true);
      expect(sent.result.structuredContent.error, JSON.stringify(fileIds)).toMatchObject({ code: 'not_found', message: `Conversation ${groupRoom} does not exist.` });
    }
    expect(Object.keys(w.mem.tables.state.messages)).toHaveLength(stored);
    for (const name of ['chats.list', 'chats.waiting']) {
      const answer = await call(w, name, {});
      expect(answer.text, name).not.toContain(GROUP_SECRET);
      expect((answer.result.structuredContent.output as { id: string }[]).some((row) => row.id === groupRoom), name).toBe(false);
    }
  });
});

describe('the agent of a member of a group and the file rows of a message', () => {
  /** Reem (usr_003) leads an office task and posts its file in the group of Reem, the Admin and Turki. The chat rules keep this out, so the test plants it. */
  function plant(w: World): void {
    const state = w.mem.tables.state;
    const version = { letter: 'A', blobKey: 'blob_990', mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_003', uploadedAt: STAMP };
    state.tasks.tsk_990 = makeTask({ id: 'tsk_990', projectId: null, stageId: null, title: 'Private licence', ownerId: 'usr_003', createdBy: 'usr_003', needsReview: false, helperIds: [] });
    state.files.fil_990 = { id: 'fil_990', projectId: null, stageId: null, taskId: 'tsk_990', name: OFFICE_FILE_NAME, versions: [version] };
    state.messages.msg_990 = { id: 'msg_990', conversationId: groupRoom, authorId: 'usr_003', actingForId: 'usr_003', body: 'The scan.', mentions: [], fileIds: ['fil_990'], createdAt: STAMP, editedAt: null };
    w.mem.tables.version += 1;
  }

  async function rowOf(acting: Acting) {
    const w = world(acting);
    plant(w);
    const { text, result } = await call(w, 'chats.messages', { conversationId: groupRoom });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const messages = result.structuredContent.output.messages as { message: Message; files: { id: string; name: string | null }[] }[];
    return { text, view: messages.find((m) => m.message.id === 'msg_990')! };
  }

  it('shows the file row to the agent of the person who leads the task, and to the agent of the Admin', async () => {
    for (const acting of [{ agentId: 'usr_096', personId: 'usr_003' }, ADMIN_AGENT]) {
      const { view } = await rowOf(acting);
      expect(view.files, acting.agentId).toEqual([{ id: 'fil_990', name: OFFICE_FILE_NAME }]);
      expect(view.message.fileIds, acting.agentId).toEqual(['fil_990']);
    }
  });

  it('shows no file row to the agent of a member who may not view the file, and keeps the text of the message', async () => {
    const { text, view } = await rowOf({ agentId: 'usr_097', personId: 'usr_010' });
    expect(view.message.body).toBe('The scan.');
    expect(view.files).toEqual([]);
    expect(view.message.fileIds).toEqual([]);
    expect(text).not.toContain('fil_990');
    expect(text).not.toContain(OFFICE_FILE_NAME);
  });
});
