import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from 'jose';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { stageTag } from '../../src/api/flow';
import { runInHost } from '../core/after';
import { memoryData, type MemoryData } from '../core/memoryData';
import { createRunCall } from '../core/runCall';
import type { OfficeSnapshot } from '../core/types';
import { fakeDeps, type FakeDeps } from '../test/fakes/deps';
import { mcpApp, serverInfoFor, TOOL_CALLS_PER_MINUTE, type McpAppOptions, type McpLimit } from './app';
import { agentTokenChecker, type AgentPrincipal, type AgentToken } from './auth';
import { INSTRUCTIONS } from './docs';
import { HOP_HEADER, hopHeaderOf, hopKeyFrom } from './forward';
import { mcpTools } from './tools';

/**
 * Suite 12 of TM 7, in process (plan 5.6; task G3): the MCP app with a real token check (local ES256 keys), the real runCall on
 * the memory office (server/core/memoryData.ts), and fakes for the agent link and the rate limit. The OAuth flow and the SQL
 * steps run on the local stack in server/it/mcp.it.test.ts.
 */

const MCP_URL = 'http://127.0.0.1:54321/functions/v1/mcp';
const ISSUER = 'http://127.0.0.1:54321/auth/v1';
const VERSION = '2026-07-28';
const AUTH = { a: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f', b: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e60' };
const CLIENT = {
  one: '907ef9d7-7bfc-4e2b-ac19-e027f13226fa', two: '907ef9d7-7bfc-4e2b-ac19-e027f13226fb', gone: '907ef9d7-7bfc-4e2b-ac19-e027f13226fc',
  member: '907ef9d7-7bfc-4e2b-ac19-e027f13226fd',
};
const SESSION = '1b2c3d4e-5f60-4718-9a0b-1c2d3e4f5a6b';
const samples = JSON.parse(readFileSync(new URL('./samples.json', import.meta.url), 'utf8')) as Record<string, Record<string, unknown>>;

let key: { privateKey: CryptoKey; jwk: JWK };
let seed: State;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  key = { privateKey: pair.privateKey, jwk: { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' } };
  seed = await buildSeed('2026-10-04', async () => undefined);
  // A second agent of the Admin (usr_001), for the limit over all of one person's agents.
  seed.users.usr_012 = { ...seed.users.usr_009, id: 'usr_012', name: 'Second Agent', email: 'usr_012@agents.madar.invalid' };
  // An agent of a member (usr_003), for the tools that only an agent of an Admin gets (owner, 2026-10-07).
  seed.users.usr_013 = { ...seed.users.usr_009, id: 'usr_013', name: 'Member Agent', email: 'usr_013@agents.madar.invalid', ownerId: 'usr_003' };
  seed.counters.usr = 13;
});

async function tokenOf(claims: JWTPayload = {}): Promise<string> {
  return new SignJWT({ sub: AUTH.a, role: 'authenticated', aud: MCP_URL, client_id: CLIENT.one, session_id: SESSION, ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setIssuer(ISSUER).setIssuedAt().setExpirationTime('1h').sign(key.privateKey);
}

/**
 * The agent links of the fake: client one is usr_009, client two is usr_012, both of the Admin usr_001; client member is usr_013 of
 * the member usr_003; client gone was removed.
 */
async function fakeAgentOf(_deps: unknown, token: AgentToken): Promise<AgentPrincipal> {
  if (token.clientId === CLIENT.gone) throw new ApiError('unauthenticated', 'This agent was removed in Madar. Connect it again in your AI app.');
  if (token.clientId === CLIENT.member) return { principal: { userId: 'usr_013', agent: { clientId: token.clientId } }, ownerId: 'usr_003', linked: false };
  const userId = token.clientId === CLIENT.two ? 'usr_012' : 'usr_009';
  return { principal: { userId, agent: { clientId: token.clientId } }, ownerId: 'usr_001', linked: false };
}

/** The fixed-window limit in memory, keyed like the SQL one: by person, over all of the person's agents. */
function memoryLimit(): McpLimit & { hits: Map<string, number> } {
  const hits = new Map<string, number>();
  const limit = (async (_deps, o) => {
    const window = `mcp:${o.ownerId}:${Math.floor(o.now.getTime() / 60_000)}`;
    const count = (hits.get(window) ?? 0) + 1;
    hits.set(window, count);
    return { ok: count <= TOOL_CALLS_PER_MINUTE, count, retryAfterMs: 30_000 };
  }) as McpLimit & { hits: Map<string, number> };
  limit.hits = hits;
  return limit;
}

/** ran: the name of each call that reached runCall, in order. */
type World = { app: ReturnType<typeof mcpApp>; deps: FakeDeps; mem: MemoryData; limit: ReturnType<typeof memoryLimit>; ran: string[] };

function world(o: Partial<McpAppOptions> & { region?: string } = {}): World {
  const mem = memoryData(seed);
  const deps = fakeDeps({ db: mem.db, config: { mcpUrl: MCP_URL, ...(o.region ? { region: o.region } : {}) } });
  deps.clock.set(new Date('2026-10-04T06:00:00Z'));
  const limit = memoryLimit();
  const ran: string[] = [];
  const runCall = createRunCall({ data: () => mem.data() });
  const app = mcpApp(deps, {
    checkToken: agentTokenChecker({ issuer: ISSUER, audience: MCP_URL, jwks: createLocalJWKSet({ keys: [key.jwk] }) }),
    agentOf: fakeAgentOf,
    runCall: (d, req) => {
      ran.push(req.name);
      return runCall(d, req);
    },
    readOffice: async (): Promise<OfficeSnapshot> => mem.data().office(),
    limit,
    stateKey: 'k'.repeat(40),
    issuer: ISSUER,
    ...o,
  });
  return { app, deps, mem, limit, ran };
}

const meta = (caps: Record<string, unknown> = {}) => ({
  'io.modelcontextprotocol/protocolVersion': VERSION,
  'io.modelcontextprotocol/clientCapabilities': caps,
  'io.modelcontextprotocol/clientInfo': { name: 'test-agent', version: '1.0.0' },
});

let nextId = 1;

type Rpc = { status: number; headers: Headers; body: Record<string, any> };

async function post(w: World, body: unknown, headers: Record<string, string>, path = '/'): Promise<Rpc> {
  const response = await w.app.fetch(new Request(`http://127.0.0.1${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body),
  }));
  const text = await response.text();
  // A 2025-era answer may come as one SSE event.
  const json = text.startsWith('event:') ? text.split('\n').find((line) => line.startsWith('data: '))!.slice(6) : text;
  return { status: response.status, headers: response.headers, body: json ? JSON.parse(json) : {} };
}

/** One 2026-07-28 request, with the headers and the _meta envelope of the version. */
async function rpc(w: World, method: string, params: Record<string, unknown> = {}, o: { token?: string | null; caps?: Record<string, unknown>; headers?: Record<string, string> } = {}): Promise<Rpc> {
  const token = o.token === undefined ? await tokenOf() : o.token;
  const name: Record<string, string> = method === 'tools/call' ? { 'Mcp-Name': String(params.name) } : {};
  return post(w, { jsonrpc: '2.0', id: nextId++, method, params: { ...params, _meta: meta(o.caps) } }, {
    'MCP-Protocol-Version': VERSION, 'Mcp-Method': method, ...name, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...o.headers,
  });
}

const call = (w: World, name: string, args: Record<string, unknown> = {}, o: Parameters<typeof rpc>[3] & { extra?: Record<string, unknown> } = {}) =>
  rpc(w, 'tools/call', { name, arguments: args, ...o.extra }, o);

/** A done task in a stage before its project's current stage: reopening it moves the project back (stage_back_reason). */
function backTask(state: State): { id: string; stageName: string } {
  for (const task of Object.values(state.tasks)) {
    const project = state.projects[task.projectId!];
    const stage = state.stages[task.stageId ?? ''];
    const current = state.stages[project?.currentStageId ?? ''];
    if (task.status === 'done' && stage && current && stage.order < current.order && project.status === 'active') return { id: task.id, stageName: stage.name };
  }
  throw new Error('The sample office has no done task in an earlier stage.');
}

/** An open task with a due date, and an earlier stage of its project: moving the task there and its due date asks for both reasons. */
function dateAndBackTask(state: State): { id: string; stageId: string; dueDate: string } {
  for (const task of Object.values(state.tasks)) {
    const project = state.projects[task.projectId!];
    if (!project || project.status !== 'active' || task.status === 'done' || task.status === 'in_review' || !task.dueDate) continue;
    const stages = Object.values(state.stages).filter((s) => s.projectId === task.projectId).sort((a, b) => a.order - b.order);
    const tag = stageTag(state, task.projectId!);
    if (stages.length < 2 || !tag || tag.id === stages[0].id || task.stageId === stages[0].id) continue;
    const due = new Date(`${task.dueDate}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + 7);
    return { id: task.id, stageId: stages[0].id, dueDate: due.toISOString().slice(0, 10) };
  }
  throw new Error('The sample office has no open task with a due date in a project past its first stage.');
}

describe('suite 12: the MCP server in process', () => {
  let w: World;
  beforeEach(() => {
    w = world();
  });

  it('answers server/discover with the version, the tools capability, serverInfo and the instructions', async () => {
    const { status, body } = await rpc(w, 'server/discover');
    expect(status).toBe(200);
    expect(body.result).toMatchObject({
      resultType: 'complete', supportedVersions: expect.arrayContaining([VERSION]), capabilities: { tools: expect.any(Object) },
      instructions: INSTRUCTIONS, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'madar', version: '1.0.0' } },
    });
    // A client keeps the discover answer for 5 minutes at most, so a new release (a new version) reaches it soon (owner, 2026-10-12).
    expect(body.result.ttlMs).toBe(300_000);
  });

  it('lists the 45 tools of an agent of an Admin in their fixed order, with ttlMs and cacheScope "private", and the exact schemas of tools.ts', async () => {
    const { body } = await rpc(w, 'tools/list');
    const tools = body.result.tools as { name: string; inputSchema: Record<string, unknown>; annotations: Record<string, unknown> }[];
    const admin = mcpTools({ admin: true });
    expect(tools.map((t) => t.name)).toEqual(admin.map((t) => t.name));
    expect(tools).toHaveLength(45);
    expect(body.result.ttlMs).toBe(300_000);
    expect(body.result.cacheScope).toBe('private');
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
    ajv.addFormat('date-time', { validate: (value: string) => !Number.isNaN(Date.parse(value)) });
    for (const [i, tool] of tools.entries()) {
      expect(tool.inputSchema, tool.name).toEqual(admin[i].inputSchema);
      expect(tool.annotations, tool.name).toEqual(admin[i].annotations);
      const validate = ajv.compile(tool.inputSchema);
      expect(validate(samples[tool.name]), `${tool.name}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  describe('the Admin tools of requests and bugs (owner, 2026-10-07)', () => {
    const member = async () => tokenOf({ client_id: CLIENT.member });
    const legacyList = async (target: World, token: string) =>
      (await post(target, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { Authorization: `Bearer ${token}`, 'MCP-Protocol-Version': '2025-11-25' })).body;

    it('lists 42 tools and no feedback tool to an agent of a member, in both eras', async () => {
      const modern = await rpc(w, 'tools/list', {}, { token: await member() });
      const legacy = await legacyList(w, await member());
      for (const [era, result] of [['2026-07-28', modern.body.result], ['2025-11-25', legacy.result]] as const) {
        const names = (result.tools as { name: string }[]).map((t) => t.name);
        expect(names, era).toEqual(mcpTools().map((t) => t.name));
        expect(names, era).toHaveLength(42);
        expect(names.filter((name) => name.startsWith('feedback.')), era).toEqual([]);
      }
    });

    it('refuses a feedback tool of an agent of a member as an unknown tool, before runCall', async () => {
      for (const [name, args] of [['feedback.list', {}], ['feedback.screenshot', { id: 'fbk_001', index: 0 }], ['feedback.setStatus', { id: 'fbk_001', status: 'done' }]] as const) {
        const { body } = await call(w, name, args, { token: await member() });
        expect(body.error?.code, name).toBe(-32602);
        expect(JSON.stringify(body), name).not.toContain('structuredContent');
      }
      expect(w.ran).toEqual([]);
      // The same agent still runs its own tools through runCall.
      const read = await call(w, 'projects.get', { id: 'prj_001' }, { token: await member() });
      expect(read.body.result.structuredContent.output.project.id).toBe('prj_001');
      expect(w.ran).toEqual(['projects.get']);
    });

    it('lists 42 tools on the next request after the Admin becomes a member, and 45 again after the promotion', async () => {
      expect((await rpc(w, 'tools/list')).body.result.tools).toHaveLength(45);
      const admin = w.mem.tables.state.users.usr_001;
      w.mem.tables.state.users.usr_001 = { ...admin, systemRole: 'member' };
      w.mem.tables.version += 1;
      const demoted = (await rpc(w, 'tools/list')).body.result.tools as { name: string }[];
      expect(demoted).toHaveLength(42);
      expect(demoted.map((t) => t.name).filter((name) => name.startsWith('feedback.'))).toEqual([]);
      expect((await legacyList(w, await tokenOf())).result.tools).toHaveLength(42);
      const refused = await call(w, 'feedback.list');
      expect(refused.body.error?.code).toBe(-32602);
      w.mem.tables.state.users.usr_001 = admin;
      w.mem.tables.version += 1;
      expect((await rpc(w, 'tools/list')).body.result.tools).toHaveLength(45);
    });
  });

  it('runs a read as the agent: structuredContent and the same JSON as text', async () => {
    const { body } = await call(w, 'projects.get', { id: 'prj_001' });
    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent.output.project.id).toBe('prj_001');
    expect(JSON.parse(body.result.content[0].text)).toEqual(body.result.structuredContent);
  });

  it('lists people with both names and leaves picture data out, so the agent context stays small (owner items 10 and 12)', async () => {
    const before = seed.users.usr_002;
    seed.users.usr_002 = { ...before, nameAr: 'فيصل الحربي', avatarUrl: `data:image/webp;base64,${'A'.repeat(8_000)}` };
    try {
      const { body } = await call(world(), 'users.list');
      const faisal = (body.result.structuredContent.output as { id: string }[]).find((user) => user.id === 'usr_002');
      expect(faisal).toMatchObject({ name: before.name, nameAr: 'فيصل الحربي', avatarUrl: null });
      expect(body.result.content[0].text).not.toContain('data:image');
    } finally {
      seed.users.usr_002 = before;
    }
  });

  it('lists the sub-companies without their logo data, so the agent context stays small (fbk_007)', async () => {
    const before = seed.subCompanies;
    seed.subCompanies = {
      sub_001: { id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: `data:image/webp;base64,${'A'.repeat(8_000)}`, createdBy: 'usr_001', createdAt: '2026-10-04T06:00:00Z' },
    };
    try {
      const { body } = await call(world(), 'subCompanies.list');
      const rows = body.result.structuredContent.output as { id: string; logo: string | null }[];
      expect(rows[0]).toMatchObject({ id: 'sub_001', name: 'Vado', logo: null });
      expect(body.result.content[0].text).not.toContain('data:image');
    } finally {
      seed.subCompanies = before;
    }
  });

  it('gives madar.readFirst the rules and the person the agent acts for', async () => {
    const { body } = await call(w, 'madar.readFirst');
    const text = body.result.content[0].text as string;
    expect(text.startsWith(INSTRUCTIONS)).toBe(true);
    expect(text).toContain(`You act for ${seed.users.usr_001.name}, whose role in Madar is Admin.`);
  });

  it('runs a write with a story from story.start: the History names the agent and its person', async () => {
    const started = await call(w, 'story.start');
    const storyId = started.body.result.structuredContent.output.storyId as string;
    expect(storyId).toBeTruthy();
    const { body } = await call(w, 'comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Checked the drawings.', storyId });
    expect(body.result.isError, JSON.stringify(body.result)).toBeUndefined();
    expect(body.result.structuredContent.storyId).toBe(storyId);
    const event = Object.values(w.mem.tables.state.events).find((e) => e.correlationId === storyId)!;
    expect(event).toMatchObject({ actorId: 'usr_009', actorKind: 'agent', actingForId: 'usr_001' });
  });

  it('turns an ApiError into isError with its code, so the model can correct itself', async () => {
    const { body } = await call(w, 'projects.get', { id: 'prj_999' });
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe('not_found');
  });

  it('refuses a call that is not on the allowlist as an unknown tool', async () => {
    const { body } = await call(w, 'users.create', { name: 'X', email: 'x@madar.test', systemRole: 'member', discipline: 'Design' });
    expect(body.error.code).toBe(-32602);
    expect(Object.keys(w.mem.tables.state.users)).toHaveLength(Object.keys(seed.users).length);
  });

  describe('reasons (change 7)', () => {
    it('returns input_required to a client with elicitation, and the retry with the answer moves the task', async () => {
      const task = backTask(w.mem.tables.state);
      const first = await call(w, 'tasks.move', { id: task.id, status: 'todo' }, { caps: { elicitation: {} } });
      expect(first.body.result.resultType).toBe('input_required');
      const request = first.body.result.inputRequests.reason;
      expect(request.method).toBe('elicitation/create');
      expect(request.params.message).toContain(task.stageName);
      expect(w.mem.tables.state.tasks[task.id].status).toBe('done');

      const retry = await call(w, 'tasks.move', { id: task.id, status: 'todo' }, {
        caps: { elicitation: {} },
        extra: { requestState: first.body.result.requestState, inputResponses: { reason: { action: 'accept', content: { text: 'The client changed the brief.' } } } },
      });
      expect(retry.body.result.isError, JSON.stringify(retry.body.result)).toBeUndefined();
      expect(w.mem.tables.state.tasks[task.id].status).toBe('todo');
    });

    it('gives isError with the retry instruction to a client without elicitation, and a call with "reason" works', async () => {
      const task = backTask(w.mem.tables.state);
      const first = await call(w, 'tasks.move', { id: task.id, status: 'todo' });
      expect(first.body.result.isError).toBe(true);
      expect(first.body.result.content[0].text).toContain('"reason"');
      expect(first.body.result.inputRequests).toBeUndefined();
      const again = await call(w, 'tasks.move', { id: task.id, status: 'todo', reason: 'The client changed the brief.' });
      expect(again.body.result.isError).toBeUndefined();
      expect(w.mem.tables.state.tasks[task.id].status).toBe('todo');
    });

    it('refuses a forged requestState, and a state of another call', async () => {
      const task = backTask(w.mem.tables.state);
      const forged = await call(w, 'tasks.move', { id: task.id, status: 'todo' }, {
        caps: { elicitation: {} }, extra: { requestState: 'v1.eyJwIjp7fX0.forged', inputResponses: { reason: { action: 'accept', content: { text: 'x' } } } },
      });
      expect(forged.body.error.code).toBe(-32602);
      const first = await call(w, 'tasks.move', { id: task.id, status: 'todo' }, { caps: { elicitation: {} } });
      const other = await call(w, 'tasks.move', { id: task.id, status: 'in_progress' }, {
        caps: { elicitation: {} }, extra: { requestState: first.body.result.requestState, inputResponses: { reason: { action: 'accept', content: { text: 'x' } } } },
      });
      // A good signature on the state of another call: the SDK gives the throw of the tool back as a tool error.
      expect(other.body.result.isError).toBe(true);
      expect(other.body.result.content[0].text).toContain('requestState belongs to another call');
      expect(w.mem.tables.state.tasks[task.id].status).toBe('done');
    });

    it('refuses the state of another agent (the state is bound to the agent)', async () => {
      const task = backTask(w.mem.tables.state);
      const first = await call(w, 'tasks.move', { id: task.id, status: 'todo' }, { caps: { elicitation: {} } });
      const stolen = await call(w, 'tasks.move', { id: task.id, status: 'todo' }, {
        token: await tokenOf({ client_id: CLIENT.two }),
        caps: { elicitation: {} }, extra: { requestState: first.body.result.requestState, inputResponses: { reason: { action: 'accept', content: { text: 'x' } } } },
      });
      expect(stolen.body.error.code).toBe(-32602);
    });

    it('asks for both reasons of one tasks.update in turn, and the third round records the date comment and the stage-back reason', async () => {
      const target = dateAndBackTask(w.mem.tables.state);
      const args = { id: target.id, patch: { stageId: target.stageId, dueDate: target.dueDate } };
      const caps = { elicitation: {} };
      const accept = (text: string) => ({ action: 'accept', content: { text } });
      const one = await call(w, 'tasks.update', args, { caps });
      expect(one.body.result.resultType, JSON.stringify(one.body)).toBe('input_required');
      expect(Object.keys(one.body.result.inputRequests)).toEqual(['dateReason']);
      const two = await call(w, 'tasks.update', args, { caps, extra: { requestState: one.body.result.requestState, inputResponses: { dateReason: accept('The survey came late.') } } });
      expect(two.body.result.resultType, JSON.stringify(two.body)).toBe('input_required');
      expect(Object.keys(two.body.result.inputRequests)).toEqual(['reason']);
      expect(w.mem.tables.state.tasks[target.id].stageId).not.toBe(target.stageId);
      const three = await call(w, 'tasks.update', args, { caps, extra: { requestState: two.body.result.requestState, inputResponses: { reason: accept('The client changed the brief.') } } });
      expect(three.body.result.isError, JSON.stringify(three.body)).toBeUndefined();
      const state = w.mem.tables.state;
      expect(state.tasks[target.id]).toMatchObject({ stageId: target.stageId, dueDate: target.dueDate });
      expect(state.projects[state.tasks[target.id].projectId!].stageBack?.reason).toBe('The client changed the brief.');
      expect(Object.values(state.comments).some((c) => c.targetId === target.id && c.body === 'The survey came late.')).toBe(true);
    });

    it('never lets a state carry an answer into a call with other arguments', async () => {
      const target = dateAndBackTask(w.mem.tables.state);
      const args = { id: target.id, patch: { stageId: target.stageId, dueDate: target.dueDate } };
      const one = await call(w, 'tasks.update', args, { caps: { elicitation: {} } });
      const two = await call(w, 'tasks.update', args, {
        caps: { elicitation: {} }, extra: { requestState: one.body.result.requestState, inputResponses: { dateReason: { action: 'accept', content: { text: 'Late survey.' } } } },
      });
      const other = await call(w, 'tasks.update', { id: target.id, patch: { stageId: target.stageId } }, {
        caps: { elicitation: {} }, extra: { requestState: two.body.result.requestState, inputResponses: { reason: { action: 'accept', content: { text: 'x' } } } },
      });
      expect(other.body.result.isError).toBe(true);
      expect(other.body.result.content[0].text).toContain('requestState belongs to another call');
      expect(w.mem.tables.state.tasks[target.id].stageId).not.toBe(target.stageId);
    });

    it('gives the retry instruction, never -32021, to a client that declared only URL elicitation (checklist point 12)', async () => {
      const task = backTask(w.mem.tables.state);
      const first = await call(w, 'tasks.move', { id: task.id, status: 'todo' }, { caps: { elicitation: { url: {} } } });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body.result.isError).toBe(true);
      expect(first.body.result.content[0].text).toContain('"reason"');
      const form = await call(w, 'tasks.move', { id: task.id, status: 'todo' }, { caps: { elicitation: { form: {} } } });
      expect(form.body.result.resultType).toBe('input_required');
    });

    it('changes nothing when the person declines', async () => {
      const task = backTask(w.mem.tables.state);
      const first = await call(w, 'tasks.move', { id: task.id, status: 'todo' }, { caps: { elicitation: {} } });
      const declined = await call(w, 'tasks.move', { id: task.id, status: 'todo' }, {
        caps: { elicitation: {} }, extra: { requestState: first.body.result.requestState, inputResponses: { reason: { action: 'decline' } } },
      });
      expect(declined.body.result.isError).toBe(true);
      expect(w.mem.tables.state.tasks[task.id].status).toBe('done');
    });
  });

  describe('the transport', () => {
    it('answers 400 with -32020 when MCP-Protocol-Version differs from _meta', async () => {
      const { status, body } = await rpc(w, 'tools/list', {}, { headers: { 'MCP-Protocol-Version': '2025-11-25' } });
      expect(status).toBe(400);
      expect(body.error.code).toBe(-32020);
    });

    it('gives the legacy answer to a request with no version header', async () => {
      const { status, body } = await post(w, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { Authorization: `Bearer ${await tokenOf()}` });
      expect(status).toBe(200);
      expect(body.result.tools).toHaveLength(45);
      expect(body.result.resultType).toBeUndefined();
    });

    it('serves a 2025-11-25 client: initialize, then tools/list and tools/call, each request on its own', async () => {
      const auth = { Authorization: `Bearer ${await tokenOf()}`, 'MCP-Protocol-Version': '2025-11-25' };
      const init = await post(w, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'old', version: '1' } } }, { Authorization: auth.Authorization });
      expect(init.body.result.protocolVersion).toBe('2025-11-25');
      expect(init.headers.get('Mcp-Session-Id')).toBeNull();
      const list = await post(w, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, auth);
      expect(list.body.result.tools).toHaveLength(45);
      const read = await post(w, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'projects.get', arguments: { id: 'prj_001' } } }, auth);
      expect(read.body.result.structuredContent.output.project.id).toBe('prj_001');
      // A legacy client cannot answer a question, so a reason comes back as the retry instruction.
      const task = backTask(w.mem.tables.state);
      const back = await post(w, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'tasks.move', arguments: { id: task.id, status: 'todo' } } }, auth);
      expect(back.body.result.isError).toBe(true);
      expect(back.body.result.content[0].text).toContain('"reason"');
    });

    it('answers GET and DELETE with 405, and needs no session between requests', async () => {
      for (const method of ['GET', 'DELETE']) {
        const response = await w.app.fetch(new Request('http://127.0.0.1/', { method, headers: { Authorization: `Bearer ${await tokenOf()}` } }));
        expect(response.status, method).toBe(405);
        expect(response.headers.get('Allow')).toBe('POST');
      }
      const one = await rpc(w, 'tools/list');
      const two = await call(w, 'projects.get', { id: 'prj_001' });
      for (const answer of [one, two]) expect(answer.headers.get('Mcp-Session-Id')).toBeNull();
      expect(two.body.result.structuredContent.output.project.id).toBe('prj_001');
    });

    it('answers a notification with 202 and no body (checklist point 3)', async () => {
      const response = await w.app.fetch(new Request('http://127.0.0.1/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${await tokenOf()}`, 'MCP-Protocol-Version': VERSION, 'Mcp-Method': 'notifications/cancelled' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7, _meta: meta() } }),
      }));
      expect(response.status).toBe(202);
      expect(await response.text()).toBe('');
    });

    it('answers 400 with -32020 when Mcp-Method is missing, or Mcp-Name is missing on tools/call (checklist point 6)', async () => {
      const token = `Bearer ${await tokenOf()}`;
      const noMethod = await post(w, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: meta() } }, { Authorization: token, 'MCP-Protocol-Version': VERSION });
      expect(noMethod.status).toBe(400);
      expect(noMethod.body.error.code).toBe(-32020);
      const noName = await post(w, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'projects.get', arguments: { id: 'prj_001' }, _meta: meta() } }, {
        Authorization: token, 'MCP-Protocol-Version': VERSION, 'Mcp-Method': 'tools/call',
      });
      expect(noName.status).toBe(400);
      expect(noName.body.error.code).toBe(-32020);
    });

    it('answers an unknown method with 404 and -32601 (checklist point 8)', async () => {
      const { status, body } = await rpc(w, 'tools/unknown');
      expect(status).toBe(404);
      expect(body.error.code).toBe(-32601);
    });

    it('answers 400 with -32602 when _meta has no protocolVersion or no clientCapabilities (checklist point 10)', async () => {
      const token = `Bearer ${await tokenOf()}`;
      const headers = { Authorization: token, 'MCP-Protocol-Version': VERSION, 'Mcp-Method': 'tools/list' };
      const { 'io.modelcontextprotocol/protocolVersion': _version, ...noVersion } = meta();
      const { 'io.modelcontextprotocol/clientCapabilities': _caps, ...noCaps } = meta();
      for (const [label, m] of [['no protocolVersion', noVersion], ['no clientCapabilities', noCaps]] as const) {
        const { status, body } = await post(w, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: m } }, headers);
        expect(status, label).toBe(400);
        expect(body.error.code, label).toBe(-32602);
      }
    });

    it('answers an unsupported version with 400, -32022 and the supported versions (checklist point 11)', async () => {
      const version = '2099-01-01';
      const { status, body } = await post(w, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { ...meta(), 'io.modelcontextprotocol/protocolVersion': version } } }, {
        Authorization: `Bearer ${await tokenOf()}`, 'MCP-Protocol-Version': version, 'Mcp-Method': 'tools/list',
      });
      expect(status).toBe(400);
      expect(body.error.code).toBe(-32022);
      expect(body.error.data.supported).toEqual(expect.arrayContaining([VERSION]));
    });

    it('never takes a token from the query string: 401 with WWW-Authenticate (checklist point 27)', async () => {
      const valid = await tokenOf();
      const { status, headers } = await post(w, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: meta() } }, {
        'MCP-Protocol-Version': VERSION, 'Mcp-Method': 'tools/list',
      }, `/?access_token=${encodeURIComponent(valid)}`);
      expect(status).toBe(401);
      expect(headers.get('WWW-Authenticate')).not.toBeNull();
    });

    it('refuses an Origin that is not allowed with 403, and serves the Madar screens\' origin', async () => {
      expect((await rpc(w, 'tools/list', {}, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
      expect((await rpc(w, 'tools/list', {}, { headers: { Origin: w.deps.config.allowedOrigins[0] } })).status).toBe(200);
    });
  });

  describe('sign-in', () => {
    const challenge = `Bearer resource_metadata="${MCP_URL}/oauth-protected-resource"`;

    it('gives every 401 a WWW-Authenticate header that names the metadata', async () => {
      const browser = await tokenOf({ aud: ['authenticated'], client_id: undefined });
      const cases: [string, string | null][] = [
        ['no token', null], ['not a token', 'not-a-token'], ['a browser token', browser],
        ['a removed agent', await tokenOf({ client_id: CLIENT.gone })], ['no client_id', await tokenOf({ client_id: undefined })],
      ];
      for (const [label, token] of cases) {
        const { status, headers } = await rpc(w, 'tools/list', {}, { token: token === 'not-a-token' ? null : token, headers: token === 'not-a-token' ? { Authorization: 'Bearer not-a-token' } : {} });
        expect(status, label).toBe(401);
        const header = headers.get('WWW-Authenticate');
        expect(header, label).not.toBeNull();
        expect(header!.startsWith(challenge), label).toBe(true);
      }
    });

    it('answers 403 account_off when the person or the agent is off', async () => {
      const off = world({ agentOf: async () => { throw new ApiError('unauthenticated', 'This account or this agent is turned off in Madar.', { reason: 'account_off' }); } });
      const { status, body } = await rpc(off, 'tools/list');
      expect(status).toBe(403);
      expect(body.error.data.reason).toBe('account_off');
    });

    it('answers a hidden 500 when the key set cannot load, never a sign-out', async () => {
      const broken = world({ checkToken: async () => { throw new Error('fetch failed'); } });
      const { status, headers } = await rpc(broken, 'tools/list');
      expect(status).toBe(500);
      expect(headers.get('WWW-Authenticate')).toBeNull();
    });

    it('serves the protected resource metadata with no token', async () => {
      const response = await w.app.fetch(new Request('http://127.0.0.1/oauth-protected-resource'));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ resource: MCP_URL, authorization_servers: [ISSUER], bearer_methods_supported: ['header'], resource_name: 'Madar' });
    });
  });

  it('gives the 61st tool call in a minute from two agents of one person 429 with Retry-After', async () => {
    const one = await tokenOf();
    const two = await tokenOf({ client_id: CLIENT.two });
    for (let n = 0; n < TOOL_CALLS_PER_MINUTE; n += 1) {
      const answer = await call(w, 'projects.get', { id: 'prj_001' }, { token: n % 2 === 0 ? one : two });
      expect(answer.status, `call ${n + 1}`).toBe(200);
    }
    const over = await call(w, 'projects.get', { id: 'prj_001' }, { token: two });
    expect(over.status).toBe(429);
    expect(over.headers.get('Retry-After')).toBe('30');
    // tools/list is not a tool call: it still works.
    expect((await rpc(w, 'tools/list', {}, { token: one })).status).toBe(200);
  }, 30_000);

  it('refuses a 2025-era batch with more than one tools/call with 400 and -32600, and runs and counts none of them', async () => {
    const auth = { Authorization: `Bearer ${await tokenOf()}` };
    const batch = [1, 2].map((id) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'projects.get', arguments: { id: 'prj_001' } } }));
    for (const headers of [auth, { ...auth, 'MCP-Protocol-Version': '2025-03-26' }, { ...auth, 'MCP-Protocol-Version': '2025-06-18' }]) {
      const { status, body } = await post(w, batch, headers);
      expect(status, JSON.stringify(headers)).toBe(400);
      expect(body.error.code).toBe(-32600);
    }
    expect(w.limit.hits.size).toBe(0);
    // One tool call in a batch is still one tool call: it runs and counts once.
    const one = await post(w, [batch[0], { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }], auth);
    expect(one.status).toBe(200);
    expect([...w.limit.hits.values()]).toEqual([1]);
  });

  it('counts each request on the usage meter, and a hopped request twice only when its hop header carries the server\'s tag', async () => {
    const secretKey = 'sb_secret_meter_test';
    const keyed = world({ secretKey });
    await rpc(keyed, 'tools/list');
    expect(keyed.deps.meter.requests).toBe(1);
    // A client can send the header itself: a bare region, or a tag made with another key, counts once.
    await rpc(keyed, 'tools/list', {}, { headers: { [HOP_HEADER]: 'us-east-1' } });
    await rpc(keyed, 'tools/list', {}, { headers: { [HOP_HEADER]: await hopHeaderOf('us-east-1', await hopKeyFrom('another-secret')) } });
    expect(keyed.deps.meter.requests).toBe(3);
    await rpc(keyed, 'tools/list', {}, { headers: { [HOP_HEADER]: await hopHeaderOf('us-east-1', await hopKeyFrom(secretKey)) } });
    expect(keyed.deps.meter.requests).toBe(5);
  });

  it('hands both meter counts to after when the host has one: the answer does not wait, and each count runs once, in order (performance audit SRV-4)', async () => {
    const secretKey = 'sb_secret_meter_test';
    const keyed = world({ secretKey });
    const counts: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    keyed.deps.meter.countRequest = async () => {
      counts.push(`start:${counts.length}`);
      await gate;
    };
    const later: Promise<unknown>[] = [];
    const hop = await hopHeaderOf('us-east-1', await hopKeyFrom(secretKey));
    const answer = await runInHost({ host: 'workers', after: (work) => void later.push(work) }, () => rpc(keyed, 'tools/list', {}, { headers: { [HOP_HEADER]: hop } }));
    expect(answer.status).toBe(200);
    expect([counts, later.length]).toEqual([['start:0'], 1]);
    release();
    await Promise.all(later);
    expect(counts).toEqual(['start:0', 'start:1']);
  });

  it('keeps the warning of an MCP meter count that fails after the answer', async () => {
    const w = world();
    w.deps.meter.countRequest = async () => {
      throw new Error('meter down');
    };
    const later: Promise<unknown>[] = [];
    expect((await runInHost({ host: 'workers', after: (work) => void later.push(work) }, () => rpc(w, 'tools/list'))).status).toBe(200);
    await Promise.all(later);
    expect(w.deps.logs).toContainEqual({ level: 'warn', message: 'The usage meter did not count the MCP request.', fields: { error: 'meter down' } });
  });

  it('forwards a request in a region other than Frankfurt once, before the token check', async () => {
    const seen: Request[] = [];
    const far = world({
      region: 'us-east-1',
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new Request(input, init));
        return Response.json({ jsonrpc: '2.0', id: 1, result: { from: 'frankfurt' } });
      }) as typeof fetch,
      checkToken: async () => { throw new Error('The token check must not run before the hop.'); },
    });
    const { status, body } = await rpc(far, 'tools/list', {}, { token: null });
    expect(status).toBe(200);
    expect(body.result).toEqual({ from: 'frankfurt' });
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0].url).searchParams.get('forceFunctionRegion')).toBe('eu-central-1');
  });
});

describe('serverInfoFor', () => {
  it('names the Madar logo on the site of the MCP address, so a client shows the Madar icon, not the vado.sa one (owner, 2026-10-05)', () => {
    expect(serverInfoFor('https://madar.vado.sa/mcp')).toEqual({
      name: 'madar', title: 'Madar', version: '1.0.0', websiteUrl: 'https://madar.vado.sa',
      icons: [
        { src: 'https://madar.vado.sa/icons/madar-192.png', mimeType: 'image/png', sizes: ['192x192'] },
        { src: 'https://madar.vado.sa/icons/madar-512.png', mimeType: 'image/png', sizes: ['512x512'] },
      ],
    });
    expect(serverInfoFor('https://preview.madar-46r.pages.dev/mcp').icons?.[0].src).toBe('https://preview.madar-46r.pages.dev/icons/madar-192.png');
  });

  it('gives no icon and no site for a plain http address (the local stack): an icon address must be https', () => {
    expect(serverInfoFor('http://127.0.0.1:54321/functions/v1/mcp')).toEqual({ name: 'madar', title: 'Madar', version: '1.0.0' });
  });
});
