import { beforeAll, describe, expect, it } from 'vitest';
import type { MeetingRow } from '../../src/api/contract/views';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { memoryData, type MemoryData } from '../core/memoryData';
import { createRunCall } from '../core/runCall';
import type { OfficeSnapshot } from '../core/types';
import { runOn } from '../data/loaders/compare';
import { fakeDeps, type FakeDeps } from '../test/fakes/deps';
import { mcpApp } from './app';
import type { AgentPrincipal, AgentToken } from './auth';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { MCP_ALLOW, MCP_DENY, mcpTools } from './tools';

/**
 * The meeting tools over MCP (fbk_022, owner 2026-10-19): an agent lists and reads the meetings of its person, plans, changes and
 * cancels a meeting as its person, and sees nothing of a meeting with no project that its person is not in. In process, as
 * messageTools.test.ts: the MCP app with the real runCall on the memory office. The agent usr_009 acts for the Admin usr_001.
 */

const MCP_URL = 'http://127.0.0.1:54321/functions/v1/mcp';
const VERSION = '2026-07-28';
const NOW = new Date('2026-10-04T06:00:00Z');
const TOKEN: AgentToken = {
  token: 'agent-token', authUserId: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f', clientId: '907ef9d7-7bfc-4e2b-ac19-e027f13226fa', sessionId: '1b2c3d4e-5f60-4718-9a0b-1c2d3e4f5a6b',
};
const SECRET_TITLE = 'Salary talk with Nour';
const TOOLS = ['meetings.list', 'meetings.get', 'meetings.create', 'meetings.update', 'meetings.cancel'] as const;

let seed: State;
let hidden: string;
let shared: string;

beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
  const plan = (input: Record<string, unknown>, actor: string) => {
    const outcome = runOn(seed, 'meetings.create', input as never, actor, { now: NOW, correlationId: `cor_mtg_${actor}` });
    if (outcome.error) throw new Error(outcome.error.message);
    return (outcome.output as { id: string }).id;
  };
  // Omar (usr_004) plans a meeting with no project for Nour (usr_006). The Admin is not invited.
  hidden = plan({ kind: 'meeting', title: SECRET_TITLE, startsAt: '2026-10-06T10:00:00+03:00', attendeeIds: ['usr_006'] }, 'usr_004');
  // The leader of prj_001 plans a client meeting of the project. Everyone reads it.
  shared = plan({ kind: 'client', title: 'Review the facade', projectId: 'prj_001', startsAt: '2026-10-06T12:00:00+03:00' }, seed.projects.prj_001.leaderId!);
});

type World = { app: ReturnType<typeof mcpApp>; deps: FakeDeps; mem: MemoryData };
type Acting = { agentId: string; personId: string };
const ADMIN_AGENT: Acting = { agentId: 'usr_009', personId: 'usr_001' };
const OMAR_AGENT: Acting = { agentId: 'usr_096', personId: 'usr_004' };

function world(acting: Acting = ADMIN_AGENT): World {
  const mem = memoryData(seed);
  if (acting.agentId !== ADMIN_AGENT.agentId) {
    mem.tables.state.users[acting.agentId] = { ...mem.tables.state.users.usr_009, id: acting.agentId, email: `${acting.agentId}@madar.test`, ownerId: acting.personId };
    mem.tables.version += 1;
  }
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

describe('the written instructions for the meeting tools', () => {
  it('give each tool a title and a description of 40 to 600 characters with no dash', () => {
    for (const name of TOOLS) {
      const doc = TOOL_DOCS[name];
      expect(doc.title.length, name).toBeGreaterThan(2);
      expect(doc.description.length, name).toBeGreaterThanOrEqual(40);
      expect(doc.description.length, name).toBeLessThanOrEqual(600);
      expect(doc.description, name).not.toMatch(/[–—]/);
    }
  });

  it('say in the paragraph of the instructions what the agent must know: the attendees are people, the start form, the private meeting, and no word on the minutes before wave 2', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Meetings:'));
    expect(line).toBeDefined();
    for (const word of ['meetings.list', 'projectId', 'real people', 'ask your person', 'YYYY-MM-DDTHH:MM:00+03:00', 'private', 'not_found', 'rule 6']) {
      expect(line, word).toContain(word);
    }
    expect(line).not.toContain('minutes task');
    expect(line).not.toMatch(/[–—]/);
  });

  it('tell the agent in meetings.create to ask the person before it adds attendees', () => {
    expect(TOOL_DOCS['meetings.create'].description).toContain('ask your person');
    expect(TOOL_DOCS['meetings.create'].description).toContain('private');
  });
});

describe('the lists of the meeting tools', () => {
  it('put the five calls on the allow list, none on the deny list, and in the list of every agent', () => {
    for (const name of TOOLS) {
      expect(MCP_ALLOW as readonly string[], name).toContain(name);
      expect(MCP_DENY as readonly string[], name).not.toContain(name);
      expect(mcpTools().map((tool) => tool.name), name).toContain(name);
    }
  });

  it('mark the two reads as read-only, meetings.create as additive, and the change and the cancel as not', () => {
    const tool = (name: string) => mcpTools().find((one) => one.name === name)!;
    expect(tool('meetings.list').readOnly).toBe(true);
    expect(tool('meetings.get').readOnly).toBe(true);
    expect(tool('meetings.create').annotations.destructiveHint).toBe(false);
    for (const name of ['meetings.update', 'meetings.cancel']) expect(tool(name).annotations.destructiveHint, name).toBe(true);
    for (const name of ['meetings.create', 'meetings.update', 'meetings.cancel']) expect(tool(name).takesStory, name).toBe(true);
    for (const name of ['meetings.list', 'meetings.get']) expect(tool(name).takesStory, name).toBe(false);
  });
});

describe('the meeting tools, as the agent of the Admin', () => {
  it('plans a meeting as the person, names the agent in the History, and changes and cancels it', async () => {
    const w = world();
    const made = await call(w, 'meetings.create', { kind: 'client', title: 'Review the site plan', projectId: 'prj_001', startsAt: '2026-10-07T09:00:00+03:00', attendeeIds: ['usr_002'] });
    expect(made.result.isError, JSON.stringify(made.result)).toBeUndefined();
    const meeting = made.result.structuredContent.output;
    expect(meeting).toMatchObject({ kind: 'client', organizer: { id: 'usr_001' }, status: 'scheduled', attendeeCount: 1 });
    const event = Object.values(w.mem.tables.state.events).find((e) => e.verb === 'meeting.created' && e.targetId === meeting.id)!;
    expect(event).toMatchObject({ actorId: 'usr_009', actingForId: 'usr_001', actorKind: 'agent' });
    const moved = await call(w, 'meetings.update', { id: meeting.id, startsAt: '2026-10-07T10:00:00+03:00' });
    expect(moved.result.isError, JSON.stringify(moved.result)).toBeUndefined();
    expect(moved.result.structuredContent.output).toMatchObject({ startsAt: '2026-10-07T10:00:00.000+03:00', rev: 2 });
    const cancelled = await call(w, 'meetings.cancel', { id: meeting.id });
    expect(cancelled.result.structuredContent.output).toMatchObject({ status: 'cancelled', rev: 3 });
  });

  it('lists the meetings of the person and of a project, and reads one', async () => {
    const w = world();
    const mine = await call(w, 'meetings.list', { from: '2026-10-04', to: '2026-10-31' });
    expect((mine.result.structuredContent.output as MeetingRow[]).map((row) => row.id)).toEqual([]);
    const project = await call(w, 'meetings.list', { from: '2026-10-04', to: '2026-10-31', projectId: 'prj_001', mine: false });
    expect((project.result.structuredContent.output as MeetingRow[]).map((row) => row.id)).toEqual([shared]);
    const got = await call(w, 'meetings.get', { id: shared });
    expect(got.result.structuredContent.output).toMatchObject({ id: shared, title: 'Review the facade', viewerCan: { edit: true, cancel: true } });
  });
});

describe('a meeting with no project over MCP (owner, 2026-10-19)', () => {
  const missing = async (w: World, name: string, args: Record<string, unknown>) => {
    const { text, result } = await call(w, name, args);
    return { text, isError: result.isError, error: result.structuredContent?.error as { code: string; message: string } | undefined };
  };

  it('answers the agent of the Admin who is not invited exactly as for a meeting that does not exist', async () => {
    const w = world();
    for (const [name, args] of [
      ['meetings.get', { id: hidden }], ['meetings.update', { id: hidden, notes: 'x' }], ['meetings.cancel', { id: hidden }],
    ] as const) {
      const real = await missing(w, name, args);
      const none = await missing(w, name, { ...args, id: 'mtg_999' });
      expect(real.isError, name).toBe(true);
      expect(JSON.stringify(real.error), name).toBe(JSON.stringify(none.error).replaceAll('mtg_999', hidden));
      expect(real.error, name).toMatchObject({ code: 'not_found', message: `Meeting ${hidden} does not exist.` });
    }
  });

  it('holds nothing of it in the lists, the History or the search of the agent of the Admin', async () => {
    const w = world();
    for (const [name, args] of [
      ['meetings.list', { from: '2026-10-01', to: '2026-12-31' }], ['meetings.list', { from: '2026-10-01', to: '2026-12-31', projectId: 'prj_001', mine: false }],
      ['events.list', { limit: 500 }], ['events.list', { targetType: 'meeting', limit: 500 }], ['events.list', { targetId: hidden }],
      ['search.query', { text: 'salary' }], ['dashboard.get', {}],
    ] as const) {
      const { text } = await call(w, name, args as Record<string, unknown>);
      expect(text, name).not.toContain(SECRET_TITLE);
      expect(text, name).not.toContain(hidden);
    }
  });

  it('shows it to the agent of its organizer and keeps the Undo of its event with the organizer', async () => {
    const w = world(OMAR_AGENT);
    const got = await call(w, 'meetings.get', { id: hidden });
    expect(got.result.isError, JSON.stringify(got.result)).toBeUndefined();
    expect(got.result.structuredContent.output).toMatchObject({ title: SECRET_TITLE, organizer: { id: 'usr_004' }, viewerCan: { edit: true, cancel: true } });
    const events = await call(w, 'events.list', { targetType: 'meeting', targetId: hidden });
    expect(events.text).toContain('meeting.created');
  });
});
