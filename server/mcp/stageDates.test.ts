import { beforeAll, describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import type { State } from '../../src/api/store';
import { memoryData, type MemoryData } from '../core/memoryData';
import { createRunCall } from '../core/runCall';
import type { OfficeSnapshot } from '../core/types';
import { fakeDeps } from '../test/fakes/deps';
import { mcpApp } from './app';
import type { AgentPrincipal, AgentToken } from './auth';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { MCP_ALLOW, MCP_DENY, mcpTools } from './tools';

/**
 * The stage dates over MCP (fbk_023): an agent sets the start and end dates of one stage with stages.setDates, as the Schedule tab
 * does. The leader of the project and the Admin may; a member of the team and an outsider may not. A change of stage dates needs
 * no reason (the call never asks for one). The History names the agent and its person. In process, as messageTools.test.ts: the
 * MCP app with the real runCall on the memory office. In the sample office usr_002 leads prj_001, usr_005 is on its team, and usr_003
 * is not on it.
 */

const MCP_URL = 'http://127.0.0.1:54321/functions/v1/mcp';
const VERSION = '2026-07-28';
const TOKEN: AgentToken = {
  token: 'agent-token', authUserId: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f', clientId: '907ef9d7-7bfc-4e2b-ac19-e027f13226fa', sessionId: '1b2c3d4e-5f60-4718-9a0b-1c2d3e4f5a6b',
};
/** Permits of prj_001. */
const STAGE = 'stg_005';
const PROJECT = 'prj_001';

let seed: State;

beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

type World = { app: ReturnType<typeof mcpApp>; mem: MemoryData };

/** A world where the agent usr_9xx acts for the given person. */
function world(personId: string): World {
  const agentId = 'usr_950';
  const mem = memoryData(seed);
  mem.tables.state.users[agentId] = { ...mem.tables.state.users.usr_009, id: agentId, email: `${agentId}@madar.test`, ownerId: personId };
  mem.tables.version += 1;
  const deps = fakeDeps({ db: mem.db, config: { mcpUrl: MCP_URL } });
  deps.clock.set(new Date('2026-10-04T06:00:00Z'));
  const app = mcpApp(deps, {
    checkToken: async () => TOKEN,
    agentOf: async (): Promise<AgentPrincipal> => ({ principal: { userId: agentId, agent: { clientId: TOKEN.clientId } }, ownerId: personId, linked: false }),
    runCall: createRunCall({ data: () => mem.data() }),
    readOffice: async (): Promise<OfficeSnapshot> => mem.data().office(),
    limit: async () => ({ ok: true, count: 1, retryAfterMs: 0 }),
    stateKey: 'k'.repeat(40),
  });
  return { app, mem };
}

let nextRpc = 1;

/** One 2026-07-28 tools/call. A client that declared elicitation gets input_required for a reason, so these tests declare none. */
async function call(w: World, name: string, args: Record<string, unknown>): Promise<Record<string, any>> {
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

const stageOf = (w: World) => w.mem.tables.state.stages[STAGE];

describe('stages.setDates over MCP (fbk_023)', () => {
  it('is a tool of every agent: on the allowlist, off the deny list, a change (not additive) that takes a story', () => {
    expect(MCP_ALLOW).toContain('stages.setDates');
    expect(MCP_DENY).not.toContain('stages.setDates');
    const tool = mcpTools().find((t) => t.name === 'stages.setDates')!;
    expect(tool).toBeDefined();
    expect(tool.readOnly).toBe(false);
    expect(tool.takesStory).toBe(true);
    expect(tool.annotations.destructiveHint).toBe(true);
    const properties = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
    expect(properties.sort()).toEqual(['endDate', 'stageId', 'startDate', 'storyId']);
    // What a stage needs stays screen work (stages.replace became a tool on 2026-10-26: stageReplace.test.ts).
    expect(MCP_DENY).toContain('stages.setPrerequisites');
    expect(MCP_ALLOW as readonly string[]).not.toContain('stages.setPrerequisites');
  });

  it('tells the agent what it changes, who may, that no reason is needed, and what the dates move', () => {
    const doc = TOOL_DOCS['stages.setDates'];
    expect(doc.title).toBe('Set stage dates');
    for (const word of ['stageId', 'YYYY-MM-DD', 'both dates', 'leader', 'Admin', 'no reason', 'time order', 'current stage', 'when your person asks']) {
      expect(doc.description, word).toContain(word);
    }
    expect(doc.description).not.toMatch(/[\u2013\u2014]/);
    // The rule for stage dates is the opposite of the rule for task dates, so INSTRUCTIONS names both.
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Stages: '));
    expect(line).toBeDefined();
    for (const word of ['stages.setDates', 'no reason', 'dateReason', 'leader', 'Admin']) expect(line, word).toContain(word);
    expect(line).not.toMatch(/[\u2013\u2014]/);
  });

  it('lets the agent of the leader set a stage date, and the History names the agent and the leader', async () => {
    const w = world('usr_002');
    const before = { ...stageOf(w) };
    const story = (await call(w, 'story.start', {})).structuredContent.output.storyId as string;
    const result = await call(w, 'stages.setDates', { stageId: STAGE, startDate: '2026-10-05', endDate: '2026-11-12', storyId: story });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(stageOf(w)).toMatchObject({ startDate: '2026-10-05', endDate: '2026-11-12' });
    expect(before).toMatchObject({ startDate: '2026-10-02', endDate: '2026-11-05' });
    // The answer is the project, as the screen gets it: the stage list holds the new dates.
    const stages = result.structuredContent.output.stages as { id: string; startDate: string; endDate: string }[];
    expect(stages.find((s) => s.id === STAGE)).toMatchObject({ startDate: '2026-10-05', endDate: '2026-11-12' });
    const event = Object.values(w.mem.tables.state.events).find((e) => e.verb === 'stage.dates_changed' && e.correlationId === story)!;
    expect(event).toMatchObject({ actorId: 'usr_950', actorKind: 'agent', actingForId: 'usr_002', projectId: PROJECT, targetType: 'stage', targetId: STAGE });
    // The History tool shows the same event to the agent: the agent is the actor, and the event keeps its person.
    const history = await call(w, 'events.list', { projectId: PROJECT, targetType: 'stage', targetId: STAGE });
    const line = (history.structuredContent.output as { event: { verb: string; actingForId: string }; actor: { id: string } }[]).find((l) => l.event.verb === 'stage.dates_changed')!;
    expect(line.actor.id).toBe('usr_950');
    expect(line.event.actingForId).toBe('usr_002');
  });

  it('lets the agent of the Admin set a stage date of any project', async () => {
    const w = world('usr_001');
    const result = await call(w, 'stages.setDates', { stageId: STAGE, startDate: '2026-10-03', endDate: '2026-11-06' });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(stageOf(w)).toMatchObject({ startDate: '2026-10-03', endDate: '2026-11-06' });
  });

  it('refuses the agent of a team member who is not the leader, and changes nothing', async () => {
    const w = world('usr_005');
    const before = { ...stageOf(w) };
    const events = Object.keys(w.mem.tables.state.events).length;
    const result = await call(w, 'stages.setDates', { stageId: STAGE, startDate: '2026-10-05', endDate: '2026-11-12' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe('forbidden');
    expect(stageOf(w)).toEqual(before);
    expect(Object.keys(w.mem.tables.state.events)).toHaveLength(events);
  });

  it('refuses the agent of a person who is not on the project, and changes nothing', async () => {
    const w = world('usr_003');
    const before = { ...stageOf(w) };
    const result = await call(w, 'stages.setDates', { stageId: STAGE, startDate: null, endDate: null });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe('forbidden');
    expect(stageOf(w)).toEqual(before);
  });

  it('answers not_found for a stage that does not exist', async () => {
    const w = world('usr_002');
    const result = await call(w, 'stages.setDates', { stageId: 'stg_999', startDate: '2026-10-05', endDate: '2026-11-12' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe('not_found');
  });

  it('refuses an end date before the start date, with the field name', async () => {
    const w = world('usr_002');
    const before = { ...stageOf(w) };
    const result = await call(w, 'stages.setDates', { stageId: STAGE, startDate: '2026-11-12', endDate: '2026-10-05' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({ code: 'invalid_input', details: { fields: ['endDate'] } });
    expect(stageOf(w)).toEqual(before);
  });

  it('needs no reason for a stage date that was already set: no question, no dateReason field', async () => {
    const w = world('usr_002');
    // The stage has both dates now. Moving them is a change of a set date, which a task would answer with date_reason_needed.
    expect(stageOf(w)).toMatchObject({ startDate: '2026-10-02', endDate: '2026-11-05' });
    const result = await call(w, 'stages.setDates', { stageId: STAGE, startDate: '2026-10-20', endDate: '2026-12-01' });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(result.resultType).not.toBe('input_required');
    expect(JSON.stringify(result)).not.toContain('date_reason_needed');
    expect(stageOf(w)).toMatchObject({ startDate: '2026-10-20', endDate: '2026-12-01' });
  });

  it('clears a date with null, and the person can undo the change with its event', async () => {
    const w = world('usr_002');
    const cleared = await call(w, 'stages.setDates', { stageId: STAGE, startDate: '2026-10-02', endDate: null });
    expect(cleared.isError, JSON.stringify(cleared)).toBeUndefined();
    expect(stageOf(w)).toMatchObject({ startDate: '2026-10-02', endDate: null });
    const event = Object.values(w.mem.tables.state.events).find((e) => e.verb === 'stage.dates_changed')!;
    // The agent may undo a change of its own person's project, as the screen does for the person.
    const undone = await call(w, 'events.undo', { eventId: event.id });
    expect(undone.isError, JSON.stringify(undone)).toBeUndefined();
    expect(stageOf(w)).toMatchObject({ startDate: '2026-10-02', endDate: '2026-11-05' });
  });
});
