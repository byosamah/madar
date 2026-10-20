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
const TOOLS = ['meetings.list', 'meetings.get', 'meetings.create', 'meetings.update', 'meetings.cancel', 'meetings.saveMinutes'] as const;
const MINUTES = 'We agreed on the raise SECRET-MINUTES-4417.';

let seed: State;
let hidden: string;
let shared: string;
/** A meeting with no project that ended (Omar and Nour), and a client meeting of prj_001 that ended (the leader and Sara). */
let endedHidden: string;
let endedShared: string;

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
  // Two meetings that ended two days ago (the minutes open after the end). The Admin is on neither.
  endedHidden = plan({ kind: 'meeting', title: SECRET_TITLE, startsAt: '2026-10-02T09:00:00+03:00', attendeeIds: ['usr_006'] }, 'usr_004');
  endedShared = plan({ kind: 'client', title: 'Kick-off', projectId: 'prj_001', startsAt: '2026-10-02T10:00:00+03:00', attendeeIds: ['usr_003'] }, seed.projects.prj_001.leaderId!);
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

  it('say in the paragraph of the instructions what the agent must know: the attendees are people, the start form, the private meeting, and the minutes', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Meetings:'));
    expect(line).toBeDefined();
    for (const word of ['meetings.list', 'projectId', 'real people', 'ask your person', 'YYYY-MM-DDTHH:MM:00+03:00', 'private', 'not_found', 'rule 6']) {
      expect(line, word).toContain(word);
    }
    // Wave 2 (owner, 2026-10-19): any attendee writes the minutes with meetings.saveMinutes, and there is no minutes task.
    for (const word of ['meetings.saveMinutes', 'organizer and its attendees', 'leader and the Admin', 'what your person gives you', 'Tracker line', 'do not log that meeting with tracker.log', 'never open a file of a meeting']) {
      expect(line, word).toContain(word);
    }
    expect(line).not.toContain('minutes task');
    expect(line).not.toMatch(/[–—]/);
  });

  it('tell the agent in meetings.saveMinutes who writes, the limit, the replace rule, the empty clear, the files, since and to ask the person', () => {
    const description = TOOL_DOCS['meetings.saveMinutes'].description;
    for (const word of ['10,000', 'replaces', 'clears', 'fileIds', 'since', 'organizer and the attendees', 'leader and the Admin', 'ask your person', 'Nobody gets a notice']) expect(description, word).toContain(word);
    expect(TOOL_DOCS['meetings.get'].description).toContain('minutes');
    expect(TOOL_DOCS['tracker.list'].description).toContain('meetings.saveMinutes');
  });

  it('tell the agent in meetings.create to ask the person before it adds attendees', () => {
    expect(TOOL_DOCS['meetings.create'].description).toContain('ask your person');
    expect(TOOL_DOCS['meetings.create'].description).toContain('private');
  });
});

describe('the lists of the meeting tools', () => {
  it('put the six calls on the allow list, none on the deny list, and in the list of every agent', () => {
    for (const name of TOOLS) {
      expect(MCP_ALLOW as readonly string[], name).toContain(name);
      expect(MCP_DENY as readonly string[], name).not.toContain(name);
      expect(mcpTools().map((tool) => tool.name), name).toContain(name);
    }
  });

  it('put meetings.settle on the deny list only: Madar makes the Tracker line of a meeting that ended, an agent does not (wave 2)', () => {
    expect(MCP_DENY as readonly string[]).toContain('meetings.settle');
    expect(MCP_ALLOW as readonly string[]).not.toContain('meetings.settle');
    expect(mcpTools().map((tool) => tool.name)).not.toContain('meetings.settle');
  });

  it('mark the two reads as read-only, meetings.create as additive, and the change and the cancel as not', () => {
    const tool = (name: string) => mcpTools().find((one) => one.name === name)!;
    expect(tool('meetings.list').readOnly).toBe(true);
    expect(tool('meetings.get').readOnly).toBe(true);
    expect(tool('meetings.create').annotations.destructiveHint).toBe(false);
    // The minutes replace what stands, so the client may ask its person first: not additive (wave 2).
    for (const name of ['meetings.update', 'meetings.cancel', 'meetings.saveMinutes']) expect(tool(name).annotations.destructiveHint, name).toBe(true);
    for (const name of ['meetings.create', 'meetings.update', 'meetings.cancel', 'meetings.saveMinutes']) expect(tool(name).takesStory, name).toBe(true);
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

describe('the minutes over MCP (wave 2, owner 2026-10-19)', () => {
  const failed = async (w: World, name: string, args: Record<string, unknown>) => {
    const { text, result } = await call(w, name, args);
    return { text, isError: result.isError, error: result.structuredContent?.error as { code: string; message: string; details?: { reason?: string } } | undefined };
  };

  it('lets the agent of an attendee write the minutes as its person, and names the agent in the History', async () => {
    const w = world(OMAR_AGENT);
    const saved = await call(w, 'meetings.saveMinutes', { id: endedHidden, text: MINUTES, fileIds: [], since: null });
    expect(saved.result.isError, JSON.stringify(saved.result)).toBeUndefined();
    expect(saved.result.structuredContent.output).toMatchObject({ minutesPlace: 'meeting', minutes: { text: MINUTES, updatedBy: { id: 'usr_004' } }, viewerCan: { minutes: true } });
    const event = Object.values(w.mem.tables.state.events).find((e) => e.verb === 'meeting.minutes_saved' && e.targetId === endedHidden)!;
    expect(event).toMatchObject({ actorId: 'usr_096', actingForId: 'usr_004', actorKind: 'agent', officeMeetingId: endedHidden });
    const got = await call(w, 'meetings.get', { id: endedHidden });
    expect(got.result.structuredContent.output).toMatchObject({ minutes: { text: MINUTES } });
  });

  it('settles a project meeting on the way and keeps the minutes on its Tracker line, which tracker.list shows', async () => {
    const w = world();
    const saved = await call(w, 'meetings.saveMinutes', { id: endedShared, text: MINUTES, fileIds: [] });
    expect(saved.result.isError, JSON.stringify(saved.result)).toBeUndefined();
    expect(saved.result.structuredContent.output).toMatchObject({ minutesPlace: 'tracker', minutes: { text: MINUTES } });
    const rows = await call(w, 'tracker.list', { projectId: 'prj_001' });
    const line = (rows.result.structuredContent.output as { entry: { auto: string | null; meetingId?: string }; minutes?: { text: string }; canEditMinutes?: boolean }[]).find((row) => row.entry.auto === 'meeting' && row.entry.meetingId === endedShared)!;
    expect(line).toMatchObject({ minutes: { text: MINUTES }, canEditMinutes: true });
  });

  it('answers the agent of the Admin who is not invited exactly as for a meeting that does not exist, and writes nothing', async () => {
    const w = world();
    const real = await failed(w, 'meetings.saveMinutes', { id: endedHidden, text: MINUTES, fileIds: [] });
    const none = await failed(w, 'meetings.saveMinutes', { id: 'mtg_999', text: MINUTES, fileIds: [] });
    expect(real.isError).toBe(true);
    expect(JSON.stringify(real.error)).toBe(JSON.stringify(none.error).replaceAll('mtg_999', endedHidden));
    expect(real.error).toMatchObject({ code: 'not_found', message: `Meeting ${endedHidden} does not exist.` });
    expect(w.mem.tables.state.meetings![endedHidden].minutes ?? null).toBeNull();
  });

  it('shows the minutes of a meeting with no project to nobody outside it: not in the meeting, the lists, the History or the search', async () => {
    const people: Acting[] = [{ agentId: 'usr_096', personId: 'usr_004' }];
    const writer = world(people[0]);
    await call(writer, 'meetings.saveMinutes', { id: endedHidden, text: MINUTES, fileIds: [] });
    // The agent of the Admin reads the same office: copy the memory office of the writer into the world of the Admin's agent.
    const w = world();
    w.mem.tables.state.meetings![endedHidden] = structuredClone(writer.mem.tables.state.meetings![endedHidden]);
    w.mem.tables.state.events = structuredClone(writer.mem.tables.state.events);
    w.mem.tables.version += 1;
    for (const [name, args] of [
      ['meetings.get', { id: endedHidden }], ['meetings.list', { from: '2026-09-01', to: '2026-12-31' }], ['meetings.list', { from: '2026-09-01', to: '2026-12-31', projectId: 'prj_001', mine: false }],
      ['events.list', { limit: 500 }], ['events.list', { targetType: 'meeting', limit: 500 }], ['events.list', { targetId: endedHidden }],
      ['search.query', { text: 'SECRET-MINUTES' }], ['search.query', { text: 'salary' }], ['dashboard.get', {}], ['tracker.list', { projectId: 'prj_001' }],
    ] as const) {
      const { text } = await call(w, name, args as Record<string, unknown>);
      expect(text, name).not.toContain('SECRET-MINUTES');
      // The answer to the read of the id repeats the id that was asked, as for an id that does not exist.
      if (name !== 'meetings.get') expect(text, name).not.toContain(endedHidden);
    }
    const undo = await failed(w, 'events.undo', { eventId: Object.values(w.mem.tables.state.events).find((e) => e.verb === 'meeting.minutes_saved')!.id });
    expect(undo.error).toMatchObject({ code: 'not_found' });
  });

  it('refuses the minutes before the end, and the file of a meeting with no project in the minutes of another place', async () => {
    const w = world();
    const early = await failed(w, 'meetings.saveMinutes', { id: shared, text: MINUTES, fileIds: [] });
    expect(early.error).toMatchObject({ code: 'conflict', details: { reason: 'minutes_not_yet' } });
    const missing = await failed(w, 'meetings.saveMinutes', { id: endedShared, text: MINUTES, fileIds: ['fil_404'] });
    expect(missing.error).toMatchObject({ code: 'invalid_input', details: { reason: 'file_missing' } });
  });
});

describe('a repeating series over MCP (wave 3, owner 2026-10-19)', () => {
  const failed = async (w: World, name: string, args: Record<string, unknown>) => {
    const { text, result } = await call(w, name, args);
    return { text, isError: result.isError, error: result.structuredContent?.error as { code: string; message: string; details?: { reason?: string } } | undefined };
  };

  it('tell the agent in the instructions and the tool texts what repeat and scope do, and to ask the person before a series', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Meetings:'))!;
    for (const word of ['repeat', 'every', 'two_weeks', 'first 8 meetings', 'keeps full by itself', 'Ask your person before you plan a series', 'scope', 'later', 'a new day is for one meeting only']) {
      expect(line, word).toContain(word);
    }
    expect(line).not.toMatch(/[–—]/);
    for (const word of ['repeat', 'day, week or two_weeks', '8 meetings', 'ask your person first, also before a series', '400']) expect(TOOL_DOCS['meetings.create'].description + ' ' + line, word).toContain(word);
    expect(TOOL_DOCS['meetings.update'].description).toContain('scope');
    expect(TOOL_DOCS['meetings.cancel'].description).toContain('scope later');
    expect(TOOL_DOCS['meetings.list'].description).toContain('seriesId');
  });

  it('put meetings.extend on the deny list only: the job keeps a series full, an agent never does', () => {
    expect(MCP_DENY as readonly string[]).toContain('meetings.extend');
    expect(MCP_ALLOW as readonly string[]).not.toContain('meetings.extend');
    expect(mcpTools().map((tool) => tool.name)).not.toContain('meetings.extend');
  });

  it('plans a series as the person, changes the later meetings with the scope, and cancels them', async () => {
    const w = world();
    const made = await call(w, 'meetings.create', { kind: 'client', title: 'Weekly facade review', projectId: 'prj_001', startsAt: '2026-10-07T09:00:00+03:00', repeat: { every: 'week', until: null } });
    expect(made.result.isError, JSON.stringify(made.result)).toBeUndefined();
    const first = made.result.structuredContent.output as MeetingRow;
    expect(first).toMatchObject({ seriesId: first.id, repeat: { every: 'week', until: null } });
    const series = () => Object.values(w.mem.tables.state.meetings!).filter((m) => m.seriesId === first.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    expect(series()).toHaveLength(8);
    const third = series()[2].id;
    const moved = await call(w, 'meetings.update', { id: third, where: 'Room 9', scope: 'later' });
    expect(moved.result.isError, JSON.stringify(moved.result)).toBeUndefined();
    expect(series().map((m) => m.where)).toEqual(['', '', 'Room 9', 'Room 9', 'Room 9', 'Room 9', 'Room 9', 'Room 9']);
    const day = await failed(w, 'meetings.update', { id: third, startsAt: '2026-10-22T09:00:00+03:00', scope: 'later' });
    expect(day.error).toMatchObject({ code: 'invalid_input', details: { reason: 'series_day_one_only' } });
    const cancelled = await call(w, 'meetings.cancel', { id: third, scope: 'later' });
    expect(cancelled.result.isError, JSON.stringify(cancelled.result)).toBeUndefined();
    expect(series().map((m) => m.status)).toEqual(['scheduled', 'scheduled', ...Array(6).fill('cancelled')]);
    // The History names the agent and the person on each event of the series.
    const events = Object.values(w.mem.tables.state.events).filter((e) => e.targetType === 'meeting' && series().some((m) => m.id === e.targetId));
    expect(events.length).toBeGreaterThan(8);
    expect(events.every((e) => e.actorId === 'usr_009' && e.actingForId === 'usr_001')).toBe(true);
    // The list shows the series and the rule.
    const rows = await call(w, 'meetings.list', { from: '2026-10-04', to: '2026-12-31', projectId: 'prj_001', mine: false });
    expect((rows.result.structuredContent.output as MeetingRow[]).filter((row) => row.seriesId === first.id)).toHaveLength(8);
  });

  it('answers the agent of the Admin who is not invited, for a private series, exactly as for a meeting that does not exist, scope later too', async () => {
    const w = world(OMAR_AGENT);
    const made = await call(w, 'meetings.create', { kind: 'meeting', title: SECRET_TITLE, startsAt: '2026-10-11T09:00:00+03:00', attendeeIds: ['usr_006'], repeat: { every: 'day', until: null } });
    expect(made.result.isError, JSON.stringify(made.result)).toBeUndefined();
    const ids = Object.values(w.mem.tables.state.meetings!).filter((m) => m.seriesId === (made.result.structuredContent.output as MeetingRow).id).map((m) => m.id);
    expect(ids).toHaveLength(8);
    // The same office for the agent of the Admin.
    const admin = world();
    admin.mem.tables.state.meetings = structuredClone(w.mem.tables.state.meetings);
    admin.mem.tables.state.events = structuredClone(w.mem.tables.state.events);
    admin.mem.tables.state.counters = structuredClone(w.mem.tables.state.counters);
    admin.mem.tables.version += 1;
    for (const id of [ids[0], ids[5]]) {
      for (const [name, args] of [
        ['meetings.get', { id }], ['meetings.update', { id, where: 'x', scope: 'later' }], ['meetings.cancel', { id, scope: 'later' }],
      ] as const) {
        const real = await failed(admin, name, args);
        const none = await failed(admin, name, { ...args, id: 'mtg_999' });
        expect(real.isError, name).toBe(true);
        expect(JSON.stringify(real.error), name).toBe(JSON.stringify(none.error).replaceAll('mtg_999', id));
        expect(real.error, name).toMatchObject({ code: 'not_found', message: `Meeting ${id} does not exist.` });
      }
    }
    for (const [name, args] of [
      ['meetings.list', { from: '2026-10-01', to: '2026-12-31' }], ['events.list', { limit: 500 }], ['events.list', { targetType: 'meeting', limit: 500 }], ['search.query', { text: 'salary' }],
    ] as const) {
      const { text } = await call(admin, name, args as Record<string, unknown>);
      expect(text, name).not.toContain(SECRET_TITLE);
      for (const id of ids) expect(text, `${name} ${id}`).not.toContain(id);
    }
    expect(Object.values(admin.mem.tables.state.meetings!).every((m) => m.status === 'scheduled' && m.where === '')).toBe(true);
  });
});
