import { beforeAll, describe, expect, it } from 'vitest';
import { emptyReactions, type Message } from '../../src/api/contract/entities';
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

describe('a deleted message and the agent (chat design 2026-10-19, base B3)', () => {
  it('never gives an agent the text of a deleted message', async () => {
    const w = world();
    const gone = 'The deleted offer is 41000.';
    w.mem.tables.state.messages.msg_991 = {
      id: 'msg_991', conversationId: hala3, authorId: 'usr_003', actingForId: 'usr_003', body: gone, mentions: [],
      createdAt: '2026-10-04T05:30:00.000Z', editedAt: null, deletedAt: '2026-10-04T05:40:00.000Z',
    };
    w.mem.tables.version += 1;
    const read = await call(w, 'chats.messages', { conversationId: hala3 });
    expect(read.result.isError, JSON.stringify(read.result)).toBeUndefined();
    expect(read.text).toContain(SECRET);
    expect(read.text).not.toContain(gone);
    const list = await call(w, 'chats.list', {});
    expect(list.text).not.toContain(gone);
    expect((list.result.structuredContent.output as ChatRow[]).find((row) => row.id === hala3)).toMatchObject({ preview: SECRET });
    const waiting = await call(w, 'chats.waiting', {});
    expect(waiting.text).not.toContain(gone);
    expect((waiting.result.structuredContent.output as { id: string; body: string }[]).find((row) => row.id === hala3)).toMatchObject({ body: SECRET });
  });
});

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

  it('opens a direct chat that shows in chats.list after the first message', async () => {
    const w = world();
    const made = await call(w, 'chats.openDirect', { userId: 'usr_005' });
    const id = made.result.structuredContent.output.id as string;
    const before = await call(w, 'chats.list', {});
    expect((before.result.structuredContent.output as ChatRow[]).some((row) => row.id === id)).toBe(false);
    expect(w.mem.tables.state.chatReads[`${id}:usr_001`]).toBeUndefined();
    const sent = await call(w, 'chats.send', { conversationId: id, body: 'A first line.' });
    expect(sent.result.isError, JSON.stringify(sent.result)).toBeUndefined();
    const after = await call(w, 'chats.list', {});
    expect((after.result.structuredContent.output as ChatRow[]).find((row) => row.id === id)).toMatchObject({ preview: 'A first line.' });
    const { TOOL_DOCS } = await import('./docs');
    expect(TOOL_DOCS['chats.list'].description).toContain('shows only for the person who opened it');
    expect(TOOL_DOCS['chats.openDirect'].description).toContain('after the first message');
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
    expect(result.structuredContent.error).toMatchObject({ code: 'not_found', message: `Conversation ${faisalAndTurki} does not exist.` });
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

  it('reads the page of a chat at one message with around', async () => {
    const w = world();
    const first = await call(w, 'chats.messages', { conversationId: hala3 });
    const secret = (first.result.structuredContent.output.messages as { message: Message }[]).find((m) => m.message.body === SECRET)!.message.id;
    const { text, result } = await call(w, 'chats.messages', { conversationId: hala3, around: secret });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(text).toContain(SECRET);
    expect(result.structuredContent.output.newer).toBe(false);
    const { TOOL_DOCS } = await import('./docs');
    expect(TOOL_DOCS['chats.messages'].description).toContain('around');
    expect(TOOL_DOCS['chats.messages'].description.length).toBeLessThanOrEqual(600);
  });

  it('finds the messages of its person with search.query, and none of a chat its person may not open', async () => {
    const w = world();
    const found = await call(w, 'search.query', { text: 'private offer' });
    expect(found.result.isError, JSON.stringify(found.result)).toBeUndefined();
    const hits = found.result.structuredContent.output.messages as { chatId: string; kind: string; line: string }[];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ chatId: hala3, kind: 'direct', line: SECRET });
    // A direct chat of two other people and a group that the person is not in: no hit, no text, no id.
    for (const text of ['Admin may not open', 'other team text']) {
      const none = await call(w, 'search.query', { text });
      expect(none.result.isError, text).toBeUndefined();
      expect(none.result.structuredContent.output.messages, text).toEqual([]);
      expect(none.text, text).not.toContain(faisalAndTurki);
      expect(none.text, text).not.toContain(outsiderRoom);
    }
  });

  it('finds a comment of a project task with search.query, as a hit of kind task', async () => {
    const w = world();
    const task = Object.values(seed.tasks).find((t) => t.projectId !== null)!;
    w.mem.tables.state.comments.cmt_991 = {
      id: 'cmt_991', targetType: 'task', targetId: task.id, authorId: 'usr_003', body: 'The tower crane permit arrives on Sunday.', reactions: emptyReactions(), fileIds: [],
      createdAt: '2026-10-04T05:20:00.000Z', editedAt: null,
    };
    w.mem.tables.version += 1;
    const found = await call(w, 'search.query', { text: 'crane permit' });
    expect(found.result.isError, JSON.stringify(found.result)).toBeUndefined();
    const hits = found.result.structuredContent.output.messages as { id: string; chatId: string; kind: string; title: string }[];
    expect(hits).toEqual([expect.objectContaining({ id: 'cmt_991', chatId: task.id, kind: 'task', title: task.title })]);
    const { TOOL_DOCS } = await import('./docs');
    expect(TOOL_DOCS['search.query'].description).toContain('task comments');
    expect(TOOL_DOCS['search.query'].description.length).toBeLessThanOrEqual(600);
  });

  it('gives the project chat id of a project in projects.get, for the person of the agent', async () => {
    const w = world();
    const project = Object.values(seed.conversations).find((c) => c.kind === 'project')!;
    const got = await call(w, 'projects.get', { id: project.projectId! });
    expect(got.result.isError, JSON.stringify(got.result)).toBeUndefined();
    expect(got.result.structuredContent.output.chatId).toBe(project.id);
    const { TOOL_DOCS } = await import('./docs');
    expect(TOOL_DOCS['projects.get'].description).toContain('chatId');
    expect(TOOL_DOCS['projects.get'].description.length).toBeLessThanOrEqual(600);
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
    // A group waits only when a newer message names the person (item 22): the plain group text does not.
    expect(rows.some((row) => row.id === groupRoom)).toBe(false);
    expect(rows.some((row) => row.id === outsiderRoom)).toBe(false);
    const state = w.mem.tables.state;
    const id = nextId(state, 'msg');
    state.messages[id] = {
      id, conversationId: groupRoom, authorId: 'usr_010', actingForId: 'usr_010', body: 'Please look at the group text.', mentions: ['usr_001'],
      createdAt: '2026-10-04T05:05:00.000Z', editedAt: null,
    };
    w.mem.tables.version += 1;
    const later = (await call(w, 'chats.waiting', {})).result.structuredContent.output as { kind: string; id: string; from: { id: string }; body: string }[];
    expect(later.find((row) => row.id === groupRoom)).toMatchObject({ kind: 'group', from: { id: 'usr_010' }, body: 'Please look at the group text.' });
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
      expect(view.files, acting.agentId).toEqual([{ id: 'fil_990', name: OFFICE_FILE_NAME, mimeType: 'application/pdf' }]);
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

/**
 * The files of a group chat over MCP (owner, 2026-10-19). A chat file belongs to its chat. An agent acts with the rights of its
 * person, so it reads the name of the file in a message, as its person does. No tool opens a file, files.list never lists a chat file,
 * and a search never finds one. The agent of a person outside the chat reads nothing of the chat, so it learns nothing of the file.
 */
const CHAT_FILE_NAME = 'Hidden-chat-photo-5521.jpg';

describe('a file of a group chat over MCP (owner, 2026-10-19)', () => {
  function plantChatFile(w: World): void {
    const state = w.mem.tables.state;
    const version = { letter: 'A', blobKey: 'chat/x/y/file', mimeType: 'image/jpeg', size: 10, uploadedBy: 'usr_003', uploadedAt: STAMP };
    state.files.fil_991 = { id: 'fil_991', projectId: null, stageId: null, taskId: null, conversationId: groupRoom, name: CHAT_FILE_NAME, versions: [version] };
    state.messages.msg_991 = { id: 'msg_991', conversationId: groupRoom, authorId: 'usr_003', actingForId: 'usr_003', body: 'The photo.', mentions: [], fileIds: ['fil_991'], createdAt: STAMP, editedAt: null };
    w.mem.tables.version += 1;
  }

  it('shows the file name in the message to the agent of a member, and the agent opens nothing', async () => {
    const w = world();
    plantChatFile(w);
    const { result } = await call(w, 'chats.messages', { conversationId: groupRoom });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const messages = result.structuredContent.output.messages as { message: Message; files: { id: string; name: string | null }[] }[];
    expect(messages.find((m) => m.message.id === 'msg_991')?.files).toEqual([{ id: 'fil_991', name: CHAT_FILE_NAME, mimeType: 'image/jpeg' }]);
    const { MCP_ALLOW } = await import('./tools');
    // The upload calls stay closed. files.link, files.share and files.delete are tools now (MCP parity), and the calls refuse a file of a chat (below).
    for (const name of ['files.upload', 'files.uploadStart']) expect(MCP_ALLOW as readonly string[], name).not.toContain(name);
  });

  it('lists the file in no files.list and finds it in no search, for the agent of a member', async () => {
    const w = world();
    plantChatFile(w);
    const project = Object.values(w.mem.tables.state.projects)[0].id;
    const listed = await call(w, 'files.list', { projectId: project });
    expect(listed.text).not.toContain(CHAT_FILE_NAME);
    expect(listed.text).not.toContain('fil_991');
    const found = await call(w, 'search.query', { text: 'Hidden-chat' });
    expect(found.result.isError, JSON.stringify(found.result)).toBeUndefined();
    expect(found.text).not.toContain(CHAT_FILE_NAME);
    expect(found.text).not.toContain('fil_991');
  });

  it('gives the agent of a person outside the chat no row and no name', async () => {
    const w = world({ agentId: 'usr_098', personId: 'usr_002' });
    plantChatFile(w);
    const read = await call(w, 'chats.messages', { conversationId: groupRoom });
    expect(read.result.isError).toBe(true);
    expect(read.result.structuredContent.error).toMatchObject({ code: 'not_found', message: `Conversation ${groupRoom} does not exist.` });
    for (const [name, args] of [['chats.list', {}], ['chats.waiting', {}], ['search.query', { text: 'Hidden-chat' }], ['events.list', {}]] as const) {
      const answer = await call(w, name, args);
      expect(answer.text, name).not.toContain(CHAT_FILE_NAME);
      expect(answer.text, name).not.toContain('fil_991');
    }
  });

  it('keeps the texts true: the model reads that it never opens a file of a direct or group chat', async () => {
    const { INSTRUCTIONS, TOOL_DOCS } = await import('./docs');
    expect(INSTRUCTIONS).toContain('You never open a file of a direct or group chat');
    for (const name of ['chats.messages', 'chats.send', 'files.list', 'search.query']) {
      const text = TOOL_DOCS[name].description;
      expect(text.length, name).toBeGreaterThanOrEqual(40);
      expect(text.length, name).toBeLessThanOrEqual(600);
    }
    expect(TOOL_DOCS['chats.messages'].description).toContain('direct or group chat');
    expect(TOOL_DOCS['files.list'].description).toContain('direct or group chat');
  });
});

// Base B5 (chat design 2026-10-19): the texts of chats.messages and comments.list name the new fields of the views.
describe('the new view fields in the texts of the message tools (base B5)', () => {
  it('names the new message fields in chats.messages and comments.list', async () => {
    const { TOOL_DOCS } = await import('./docs');
    const read = TOOL_DOCS['chats.messages'].description;
    for (const word of ['reactions', 'editedAt', 'replyTo', 'namesMe', 'readUpTo', 'Deleted messages are left out', 'direct or group chat', 'quiet lines']) expect(read, word).toContain(word);
    // 540 left 60 characters for the "around" input of track find; the tool limit is 600.
    expect(read.length).toBeLessThanOrEqual(600);
    for (const word of ['replyTo', 'namesMe']) expect(TOOL_DOCS['comments.list'].description, word).toContain(word);
    expect(TOOL_DOCS['comments.list'].description.length).toBeLessThanOrEqual(600);
  });
});

// Base B6 (chat design 2026-10-19): a reply names the author of the message it answers, and the texts say so.
describe('the reply in the texts of the message tools (base B6)', () => {
  it('names replyToId in chats.send and comments.create, and the notice rule in INSTRUCTIONS', async () => {
    const { INSTRUCTIONS, TOOL_DOCS } = await import('./docs');
    for (const name of ['chats.send', 'comments.create']) {
      const text = TOOL_DOCS[name].description;
      expect(text, name).toContain('replyToId');
      expect(text.length, name).toBeGreaterThanOrEqual(40);
      expect(text.length, name).toBeLessThanOrEqual(600);
    }
    expect(INSTRUCTIONS).toContain('A reply (replyToId) names the author of the message it answers');
  });

  it('sends a reply as the person, names the author of the old message, and refuses a reply to another chat', async () => {
    const w = world();
    const first = await call(w, 'chats.send', { conversationId: hala3, body: 'The first line.' });
    const firstId = first.result.structuredContent.output.message.id as string;
    // usr_003 (Reem) wrote SECRET in this chat: a reply to it names Reem for the Admin.
    const reemMessage = Object.values(w.mem.tables.state.messages).find((m) => m.body === SECRET)!;
    const reply = await call(w, 'chats.send', { conversationId: hala3, body: 'Understood.', replyToId: reemMessage.id });
    expect(reply.result.isError, JSON.stringify(reply.result)).toBeUndefined();
    expect(reply.result.structuredContent.output.message).toMatchObject({ replyToId: reemMessage.id, mentions: ['usr_003'] });
    expect(reply.result.structuredContent.output.replyTo).toMatchObject({ id: reemMessage.id, deleted: false });
    // A reply to an own message names nobody.
    const own = await call(w, 'chats.send', { conversationId: hala3, body: 'And one more.', replyToId: firstId });
    expect(own.result.structuredContent.output.message.mentions).toEqual([]);
    // A reply into the group text of another chat is refused with the one text of a missing message.
    const groupMessage = Object.values(w.mem.tables.state.messages).find((m) => m.body === GROUP_SECRET)!;
    const wrong = await call(w, 'chats.send', { conversationId: hala3, body: 'x', replyToId: groupMessage.id });
    const missing = await call(w, 'chats.send', { conversationId: hala3, body: 'x', replyToId: 'msg_9999' });
    expect(wrong.result.isError).toBe(true);
    expect(wrong.result.structuredContent.error).toMatchObject({ code: 'invalid_input', details: { reason: 'reply_not_here' } });
    expect(wrong.result.structuredContent.error.message).toBe(missing.result.structuredContent.error.message);
    expect(wrong.text).not.toContain(GROUP_SECRET);
  });
});

// UX audit 2026-10-19, INT-18 and chats-10: the tool texts that the model reads at the call must say how to read and answer a task
// thread, and that a group gives quiet lines that are no messages.
describe('the texts of the message tools', () => {
  it('tell the model how to read and answer a row of kind task, and what a group line is', async () => {
    const { TOOL_DOCS } = await import('./docs');
    for (const name of ['chats.list', 'chats.waiting'] as const) {
      const text = TOOL_DOCS[name].description;
      expect(text, name).toContain('kind task');
      expect(text, name).toContain('comments.create');
      expect(text.length, name).toBeGreaterThanOrEqual(40);
      expect(text.length, name).toBeLessThanOrEqual(600);
    }
    expect(TOOL_DOCS['chats.list'].description).toContain('comments.list');
    expect(TOOL_DOCS['chats.messages'].description).toContain('quiet lines');
    expect(TOOL_DOCS['chats.messages'].description.length).toBeLessThanOrEqual(600);
  });

  it('says what unread means for an Admin in chats.list', async () => {
    const { TOOL_DOCS } = await import('./docs');
    const text = TOOL_DOCS['chats.list'].description;
    expect(text).toContain('counts only the unread messages that name the Admin');
    expect(text.length).toBeLessThanOrEqual(600);
  });

  it('says the wait rules of item 22 in chats.waiting', async () => {
    const { TOOL_DOCS } = await import('./docs');
    const text = TOOL_DOCS['chats.waiting'].description;
    expect(text).toContain('A group or a project chat waits when a newer message names your person');
    expect(text).toContain('👍 or ✅');
    expect(text.length).toBeLessThanOrEqual(600);
  });
});

// Track msg B8 to B10 (chat design 2026-10-19, items 11 and 12). Since the MCP parity track (owner, 2026-10-26) an agent edits and deletes a message of its
// person, and reacts, as tools. The calls still allow only a message of the person (parity.test.ts probes it).
describe('edit, delete and reaction of a message are tools of an agent (MCP parity)', () => {
  it('puts the message calls on the allow list and in the tool list, and tells the agent to ask its person first', async () => {
    const { INSTRUCTIONS, TOOL_DOCS } = await import('./docs');
    const { MCP_ALLOW, MCP_DENY, mcpTools } = await import('./tools');
    const listed = new Set(mcpTools({ admin: true }).map((tool) => tool.name as string));
    for (const name of ['chats.editMessage', 'chats.deleteMessage', 'reactions.toggle']) {
      expect(MCP_ALLOW as readonly string[], name).toContain(name);
      expect(MCP_DENY as readonly string[], name).not.toContain(name);
      expect(listed.has(name), name).toBe(true);
    }
    expect(INSTRUCTIONS).toContain('You change or delete only a message of your person, with chats.editMessage and chats.deleteMessage: ask your person first');
    for (const name of ['chats.editMessage', 'chats.deleteMessage']) expect(TOOL_DOCS[name].description, name).toContain('Ask your person first');
  });
});
