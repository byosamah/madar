import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CustomRole } from '../../src/api/contract/entities';
import { OFFICE_RIGHTS } from '../../src/api/permissions';
import { heldRightsOfRole, rightsOf } from '../../src/api/rights';
import type { State } from '../../src/api/store';
import { subCompaniesOf } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { memoryData, type MemoryData } from '../core/memoryData';
import { createRunCall } from '../core/runCall';
import type { OfficeSnapshot } from '../core/types';
import { fakeDeps, type FakeDeps } from '../test/fakes/deps';
import { mcpApp } from './app';
import type { AgentPrincipal, AgentToken } from './auth';
import { giveRole, roleWithout } from './aiRoles.testing';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { MCP_ALLOW, MCP_BY_RIGHT, MCP_DENY, mcpTools } from './tools';

/**
 * Projects and clients from an AI agent (owner, 2026-10-25, fbk_057). Four tools (projects.create, clients.create, clients.list and
 * projectTemplates.list) belong to one new AI switch, ai.projectSetup. It is off for every built-in role except the Admin, who holds
 * every switch. A new project has no Undo. The leader and the team get a notice. The lists for the agent are lean. In process, as
 * stageDates.test.ts: the MCP app with the real runCall on the memory office. In the sample office usr_001 is the Admin, usr_002
 * leads prj_001, usr_010 is Management and usr_011 is Accounting. The sample office has no sub-company, so a test adds one.
 */

const MCP_URL = 'http://127.0.0.1:54321/functions/v1/mcp';
const VERSION = '2026-07-28';
const NOW = new Date('2026-10-04T06:00:00Z');
const TOKEN: AgentToken = {
  token: 'agent-token', authUserId: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f', clientId: '907ef9d7-7bfc-4e2b-ac19-e027f13226fa', sessionId: '1b2c3d4e-5f60-4718-9a0b-1c2d3e4f5a6b',
};
const ADMIN = 'usr_001';
const MEMBER = 'usr_002';
const MANAGEMENT = 'usr_010';
const ACCOUNTING = 'usr_011';
const FOUR = ['projects.create', 'clients.create', 'clients.list', 'projectTemplates.list'];
const PARTS = { initials: 'GCH', classification: 'RES', type: 'Villa' };

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

type Office = { mem: MemoryData; deps: FakeDeps; /** The committed office. Each commit replaces it, so read it again after a call. */ readonly state: State; as: (personId: string) => Agent };
type Agent = { personId: string; agentId: string; call: (name: string, args?: Record<string, unknown>) => Promise<Record<string, any>>; names: () => Promise<string[]> };

/** An office where each person can have an agent. setup changes the office before the first request. */
function office(setup?: (state: State) => void): Office {
  const mem = memoryData(structuredClone(seed));
  const state = mem.tables.state;
  setup?.(state);
  const deps = fakeDeps({ db: mem.db, config: { mcpUrl: MCP_URL } });
  deps.clock.set(NOW);
  const agents = new Map<string, Agent>();
  const as = (personId: string): Agent => {
    const known = agents.get(personId);
    if (known) return known;
    const agentId = `usr_9${personId.slice(-2)}`;
    mem.tables.state.users[agentId] = { ...state.users.usr_009, id: agentId, email: `${agentId}@madar.test`, ownerId: personId };
    mem.tables.version += 1;
    const app = mcpApp(deps, {
      checkToken: async () => TOKEN,
      agentOf: async (): Promise<AgentPrincipal> => ({ principal: { userId: agentId, agent: { clientId: TOKEN.clientId } }, ownerId: personId, linked: false }),
      runCall: createRunCall({ data: () => mem.data() }),
      readOffice: async (): Promise<OfficeSnapshot> => mem.data().office(),
      limit: async () => ({ ok: true, count: 1, retryAfterMs: 0 }),
      stateKey: 'k'.repeat(40),
    });
    let rpcId = 1;
    const post = async (method: string, params: Record<string, unknown>, mcpName?: string) => {
      const response = await app.fetch(new Request('http://127.0.0.1/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN.token}`,
          'MCP-Protocol-Version': VERSION, 'Mcp-Method': method, ...(mcpName ? { 'Mcp-Name': mcpName } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0', id: rpcId++, method,
          params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': VERSION, 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'test-agent', version: '1.0.0' } } },
        }),
      }));
      return { status: response.status, body: JSON.parse((await response.text()) || '{}') as { result?: Record<string, any>; error?: { code: number; message: string } } };
    };
    const agent: Agent = {
      personId, agentId,
      call: async (name, args = {}) => {
        const { body, status } = await post('tools/call', { name, arguments: args }, name);
        if (!body.result) throw new Error(`The call ${name} gave no result (${status}): ${JSON.stringify(body)}`);
        return body.result;
      },
      names: async () => {
        const { body, status } = await post('tools/list', {});
        if (!body.result) throw new Error(`The list gave no result (${status}): ${JSON.stringify(body)}`);
        return (body.result.tools as { name: string }[]).map((tool) => tool.name);
      },
    };
    // A raw call: the status and the JSON-RPC error of a tool that the list does not hold.
    (agent as Agent & { raw: typeof post }).raw = post;
    agents.set(personId, agent);
    return agent;
  };
  return { mem, deps, get state() { return mem.tables.state; }, as };
}

type Raw = (method: string, params: Record<string, unknown>, mcpName?: string) => Promise<{ status: number; body: { result?: Record<string, any>; error?: { code: number; message: string } } }>;
const rawOf = (agent: Agent): Raw => (agent as Agent & { raw: Raw }).raw;

const withSubCompany = (state: State) => {
  subCompaniesOf(state).sub_001 = { id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: null, createdBy: ADMIN, createdAt: '2026-10-01T09:00:00.000+03:00' };
};
const output = (result: Record<string, any>) => result.structuredContent?.output;
const errorOf = (result: Record<string, any>) => result.structuredContent?.error as { code: string; message: string; details?: { reason?: string; fields?: string[] } } | undefined;
const created = (state: State) => Object.values(state.events).filter((event) => event.verb === 'project.created');
/** A custom role that holds the Member switches, the AI switch of project set-up and the rights given. */
const setupRole = (off: Parameters<typeof roleWithout>[0] = []): CustomRole => roleWithout(off, ['ai.projectSetup']);

describe('the lists: who sees the four tools', () => {
  it('puts projects.create and clients.create on the right list, the two lists on the allow list, and none on the deny list', () => {
    expect(MCP_BY_RIGHT['projects.create']).toBe('project.create');
    expect(MCP_BY_RIGHT['clients.create']).toBe('client.create');
    for (const name of ['clients.list', 'projectTemplates.list']) expect(MCP_ALLOW as readonly string[], name).toContain(name);
    for (const name of FOUR) expect(MCP_DENY as readonly string[], name).not.toContain(name);
    // Both writes are changes, not additive ones: a client may ask its person first.
    for (const name of ['projects.create', 'clients.create']) {
      const tool = mcpTools({ admin: true }).find((item) => item.name === name)!;
      expect(tool.readOnly, name).toBe(false);
      expect(tool.takesStory, name).toBe(true);
      expect(tool.annotations.destructiveHint, name).toBe(true);
    }
    for (const name of ['clients.list', 'projectTemplates.list']) expect(mcpTools({ admin: true }).find((item) => item.name === name)!.readOnly, name).toBe(true);
  });

  it('gives the agent of an Admin the four tools, 158 in all', async () => {
    const names = await office().as(ADMIN).names();
    expect(names).toHaveLength(158);
    for (const name of FOUR) expect(names, name).toContain(name);
  });

  it('gives the agent of a default Member, Management or Accounting none of them, and the old counts', async () => {
    const o = office();
    for (const [person, count] of [[MEMBER, 118], [ACCOUNTING, 123], [MANAGEMENT, 124]] as const) {
      const names = await o.as(person).names();
      expect(names, person).toHaveLength(count);
      for (const name of FOUR) expect(names, `${person} ${name}`).not.toContain(name);
    }
  });

  it('fails a direct call of each tool for a default Member with forbidden and the reason ai_off, and changes nothing', async () => {
    const o = office(withSubCompany);
    const before = JSON.stringify(o.state.projects) + JSON.stringify(o.state.clients);
    for (const name of FOUR) {
      const result = await o.as(MEMBER).call(name, name === 'projects.create' ? { name: 'No way', subCompanyId: 'sub_001', codeParts: PARTS } : name === 'clients.create' ? { name: 'No Client' } : {});
      expect(result.isError, name).toBe(true);
      expect(errorOf(result)?.code, name).toBe('forbidden');
      expect(errorOf(result)?.details, name).toMatchObject({ reason: 'ai_off', right: 'ai.projectSetup' });
    }
    expect(JSON.stringify(o.state.projects) + JSON.stringify(o.state.clients)).toBe(before);
  });

  it('gives a custom role with ai.projectSetup the four tools, and a role with project.create off no projects.create', async () => {
    const holder = office((state) => giveRole(state, 'usr_004', setupRole()));
    const names = await holder.as('usr_004').names();
    for (const name of FOUR) expect(names, name).toContain(name);
    const noCreate = office((state) => giveRole(state, 'usr_004', setupRole(['project.create'])));
    const some = await noCreate.as('usr_004').names();
    expect(some).not.toContain('projects.create');
    for (const name of ['clients.create', 'clients.list', 'projectTemplates.list']) expect(some, name).toContain(name);
    // The right closes the tool only: the list never names it, so a direct call is an unknown tool.
    const unknown = await rawOf(noCreate.as('usr_004'))('tools/call', { name: 'projects.create', arguments: { name: 'X' } }, 'projects.create');
    expect(unknown.body.error).toBeDefined();
    const noClient = office((state) => giveRole(state, 'usr_004', setupRole(['client.create'])));
    const rest = await noClient.as('usr_004').names();
    expect(rest).not.toContain('clients.create');
    for (const name of ['projects.create', 'clients.list', 'projectTemplates.list']) expect(rest, name).toContain(name);
  });

  it('gives a custom role without the AI switch none of them, also with both rights on', async () => {
    const o = office((state) => giveRole(state, 'usr_004', roleWithout([])));
    const names = await o.as('usr_004').names();
    for (const name of FOUR) expect(names, name).not.toContain(name);
  });

  it('gives a role with ai.connect off no tool at all, and the connection answers 403', async () => {
    const o = office((state) => giveRole(state, 'usr_004', setupRole(['ai.connect'])));
    const raw = await rawOf(o.as('usr_004'))('tools/list', {});
    expect(raw.status).toBe(403);
    expect(raw.body.result).toBeUndefined();
  });
});

describe('a role saved before this change does not get the new switch', () => {
  it('leaves ai.projectSetup off for a stored role with its own rights and its own off list', () => {
    const roles = {
      rights: { management: ['payment.view', 'people.invite'], accounting: ['payment.view'], member: [] },
      off: { member: ['task.assign'], management: ['dashboard.view'] },
      custom: [{ id: 'rol_001', name: 'Old role', nameAr: 'دور قديم', rights: ['payment.view'], off: ['file.share'] }, { id: 'rol_002', name: 'Empty', nameAr: 'فارغ', rights: [] }],
    } as never;
    const person = (systemRole: 'member' | 'management' | 'accounting', roleId?: string) => ({ ...seed.users.usr_002, systemRole, ...(roleId ? { roleId } : {}) });
    for (const user of [person('member'), person('management'), person('accounting'), person('member', 'rol_001'), person('member', 'rol_002')]) {
      const held = rightsOf(user, roles);
      expect(held, `${user.systemRole} ${user.roleId ?? ''}`).not.toContain('ai.projectSetup');
      expect(held, `${user.systemRole} ${user.roleId ?? ''}`).toContain('ai.projects');
    }
    for (const role of [{ id: 'rol_001', name: 'x', nameAr: 'x', rights: [] }] as CustomRole[]) expect(heldRightsOfRole(roles, role)).not.toContain('ai.projectSetup');
    // With no stored settings at all, the built-in roles hold nothing new either.
    for (const role of ['member', 'management', 'accounting'] as const) expect(rightsOf(person(role), undefined), role).not.toContain('ai.projectSetup');
  });

  it('gives the switch to the Admin, and to a custom role only when the role lists it', () => {
    expect(OFFICE_RIGHTS).toContain('ai.projectSetup');
    expect(rightsOf({ ...seed.users.usr_001 }, undefined)).toContain('ai.projectSetup');
    const roles = { custom: [{ id: 'rol_001', name: 'Project managers', nameAr: 'مديرو المشاريع', rights: ['ai.projectSetup'] }] } as never;
    expect(heldRightsOfRole(roles, (roles as { custom: CustomRole[] }).custom[0])).toContain('ai.projectSetup');
    // The need: a role that turns ai.connect off holds no AI switch, also not this one.
    const off = { custom: [{ id: 'rol_001', name: 'Off', nameAr: 'مغلق', rights: ['ai.projectSetup'], off: [...OFFICE_RIGHTS.filter((id) => id.startsWith('ai.'))] }] } as never;
    expect(heldRightsOfRole(off, (off as { custom: CustomRole[] }).custom[0])).not.toContain('ai.projectSetup');
  });
});

describe('projects.create over MCP', () => {
  it('lets the agent of an Admin make a project: the answer has the code, the person leads it, and the History names both', async () => {
    const o = office(withSubCompany);
    const agent = o.as(ADMIN);
    const story = output(await agent.call('story.start')).storyId as string;
    const result = await agent.call('projects.create', { name: 'Gulf Crest villa', clientId: 'cli_001', subCompanyId: 'sub_001', leader: 'me', codeParts: PARTS, storyId: story });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const detail = output(result);
    expect(detail.project.code).toMatch(/^2610\d\dGCH-RES-Villa$/);
    expect(detail.project).toMatchObject({ name: 'Gulf Crest villa', clientId: 'cli_001', subCompanyId: 'sub_001', leaderId: ADMIN, status: 'active' });
    expect(detail.stages.length).toBeGreaterThan(0);
    // The client had no initials: the code gives them (and the History says so).
    expect(o.state.clients.cli_001.initials).toBe('GCH');
    const event = created(o.state).find((item) => item.correlationId === story)!;
    expect(event).toMatchObject({ actorId: agent.agentId, actorKind: 'agent', actingForId: ADMIN, projectId: detail.project.id, targetType: 'project' });
    const history = output(await agent.call('events.list', { projectId: detail.project.id })) as { event: { verb: string; actingForId: string }; actor: { id: string } }[];
    const line = history.find((item) => item.event.verb === 'project.created')!;
    expect(line.actor.id).toBe(agent.agentId);
    expect(line.event.actingForId).toBe(ADMIN);
    expect(o.state.projects[detail.project.id].createdBy).toBe(agent.agentId);
  });

  it('lets the agent of a custom role with the switch make a project and name another leader, who gets the notice', async () => {
    const o = office((state) => { withSubCompany(state); giveRole(state, 'usr_004', setupRole()); });
    const result = await o.as('usr_004').call('projects.create', { name: 'Dune hall', clientId: 'cli_002', subCompanyId: 'sub_001', leader: 'usr_003', teamIds: ['usr_005'], codeParts: { initials: 'DLD', classification: 'COM', type: 'Hall' } });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(output(result).project.leaderId).toBe('usr_003');
  });

  it('tells the leader and each team member once, and the person behind the agent never', async () => {
    const o = office(withSubCompany);
    const result = await o.as(ADMIN).call('projects.create', { name: 'Notice test', clientId: 'cli_003', subCompanyId: 'sub_001', leader: 'usr_003', teamIds: ['usr_005', 'usr_006'], codeParts: { initials: 'ESS', classification: 'IND', type: 'School' } });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const projectId = output(result).project.id as string;
    const notices = Object.values(o.state.notifications).filter((item) => item.targetId === projectId && item.trigger === 'added_to_project');
    const byUser = (id: string) => notices.filter((item) => item.userId === id).length;
    expect(byUser('usr_003')).toBe(1);
    expect(byUser('usr_005')).toBe(1);
    expect(byUser('usr_006')).toBe(1);
    expect(byUser(ADMIN)).toBe(0);
    expect(byUser('usr_004')).toBe(0);
  });

  it('makes a project from a template with a start date, and refuses stages beside the template', async () => {
    const o = office(withSubCompany);
    const agent = o.as(ADMIN);
    const lean = output(await agent.call('projectTemplates.list')) as { id: string; name: string }[];
    const template = lean[0];
    const refused = await agent.call('projects.create', { name: 'With stages', clientId: 'cli_004', subCompanyId: 'sub_001', codeParts: { initials: 'NRG', classification: 'COM', type: 'Shop' }, stages: ['One'], template: { templateId: template.id, startDate: '2026-10-11', roles: {}, fixedTaskIds: [] } });
    expect(refused.isError).toBe(true);
    expect(errorOf(refused)?.code).toBe('invalid_input');
    expect(Object.keys(o.state.projects)).toHaveLength(Object.keys(seed.projects).length);
    const made = await agent.call('projects.create', { name: 'From template', clientId: 'cli_004', subCompanyId: 'sub_001', codeParts: { initials: 'NRG', classification: 'COM', type: 'Shop' }, template: { templateId: template.id, startDate: '2026-10-11', roles: {}, fixedTaskIds: [] } });
    expect(made.isError, JSON.stringify(made)).toBeUndefined();
    expect(output(made).project.templateId ?? o.state.projects[output(made).project.id].templateLink?.templateId).toBe(template.id);
  });
});

describe('refusals change nothing', () => {
  const base = { name: 'Refused', clientId: 'cli_001', subCompanyId: 'sub_001', codeParts: PARTS };
  /** A short fingerprint of the whole office, so a failure does not print the office. */
  const everything = (o: Office) => createHash('sha1').update(JSON.stringify(o.state)).digest('hex');

  async function refuse(o: Office, args: Record<string, unknown>, code: string, reason?: string, person = ADMIN) {
    const agent = o.as(person);
    const before = everything(o);
    const result = await agent.call('projects.create', args);
    expect(result.isError, JSON.stringify(result)).toBe(true);
    expect(errorOf(result)?.code).toBe(code);
    if (reason) expect(errorOf(result)?.details?.reason).toBe(reason);
    expect(everything(o), 'the refusal changed the office').toBe(before);
    return errorOf(result)!;
  }

  it('refuses a client project with no sub-company when the office has one', async () => {
    const o = office(withSubCompany);
    await refuse(o, { ...base, subCompanyId: undefined }, 'invalid_input', 'sub_company_required');
  });

  it('refuses an unknown sub-company, an unknown client, an inactive leader and an agent in the team', async () => {
    const o = office((state) => { withSubCompany(state); state.users.usr_004 = { ...state.users.usr_004, active: false }; });
    await refuse(o, { ...base, subCompanyId: 'sub_999' }, 'not_found');
    await refuse(o, { ...base, clientId: 'cli_999' }, 'invalid_input');
    await refuse(o, { ...base, leader: 'usr_004' }, 'invalid_input');
    await refuse(o, { ...base, teamIds: ['usr_009'] }, 'invalid_input');
  });

  it('refuses a typed code outside the office pattern, and a taken series, unless codeAnyway', async () => {
    const o = office(withSubCompany);
    await refuse(o, { name: 'Typed', clientId: 'cli_001', subCompanyId: 'sub_001', code: 'abc' }, 'invalid_input', 'code_format');
    const first = await o.as(ADMIN).call('projects.create', base);
    expect(first.isError, JSON.stringify(first)).toBeUndefined();
    const taken = (output(first).project.code as string).slice(0, 6);
    await refuse(o, { name: 'Clash', clientId: 'cli_001', subCompanyId: 'sub_001', code: `${taken}GCH-COM-Other` }, 'invalid_input', 'code_taken');
    const anyway = await o.as(ADMIN).call('projects.create', { name: 'Clash kept', clientId: 'cli_001', subCompanyId: 'sub_001', code: `${taken}GCH-COM-Other`, codeAnyway: true });
    expect(anyway.isError, JSON.stringify(anyway)).toBeUndefined();
  });

  it('refuses initials that differ from the initials of the client', async () => {
    const o = office((state) => { withSubCompany(state); state.clients.cli_001 = { ...state.clients.cli_001, initials: 'GCH' }; });
    await refuse(o, { ...base, codeParts: { ...PARTS, initials: 'XYZ' } }, 'invalid_input', 'initials_mismatch');
  });

  it('refuses a client field beside kind internal', async () => {
    const o = office(withSubCompany);
    await refuse(o, { name: 'Inside', kind: 'internal', clientId: 'cli_001' }, 'invalid_input', 'internal_project');
    await refuse(o, { name: 'Inside', kind: 'internal', codeParts: PARTS }, 'invalid_input', 'internal_project');
  });

  it('refuses the call of a default Member that the AI switch closes, and the call of a role without project.create', async () => {
    const o = office((state) => { withSubCompany(state); giveRole(state, 'usr_004', setupRole(['project.create'])); });
    const agent = o.as('usr_004');
    const before = everything(o);
    // The tool is not on the list of this person, so the call is an unknown tool.
    const raw = await rawOf(agent)('tools/call', { name: 'projects.create', arguments: base }, 'projects.create');
    expect(raw.body.error).toBeDefined();
    expect(everything(o)).toBe(before);
  });
});

describe('Undo', () => {
  it('has no Undo for a new project: events.undo answers conflict and the project stays', async () => {
    const o = office(withSubCompany);
    const agent = o.as(ADMIN);
    const made = await agent.call('projects.create', { name: 'Stays', clientId: 'cli_001', subCompanyId: 'sub_001', codeParts: PARTS });
    const id = output(made).project.id as string;
    const event = created(o.state).find((item) => item.projectId === id)!;
    const undo = await agent.call('events.undo', { eventId: event.id });
    expect(undo.isError).toBe(true);
    expect(errorOf(undo)?.code).toBe('conflict');
    expect(o.state.projects[id]).toBeDefined();
    expect(o.state.events[event.id].undoneBy).toBeFalsy();
  });

  it('fails events.undoStory for a story that holds a new project, and the project stays', async () => {
    const o = office(withSubCompany);
    const agent = o.as(ADMIN);
    const story = output(await agent.call('story.start')).storyId as string;
    const made = await agent.call('projects.create', { name: 'Story project', clientId: 'cli_001', subCompanyId: 'sub_001', codeParts: PARTS, storyId: story });
    const id = output(made).project.id as string;
    const task = await agent.call('tasks.create', { projectId: id, title: 'Same story task', storyId: story });
    expect(task.isError, JSON.stringify(task)).toBeUndefined();
    const taskId = Object.values(o.state.tasks).find((item) => item.projectId === id)!.id;
    const undo = await agent.call('events.undoStory', { correlationId: story });
    expect(undo.isError).toBe(true);
    expect(errorOf(undo)?.code).toBe('conflict');
    expect(o.state.projects[id]).toBeDefined();
    // The refusal rolls the whole story back to its state: the other write of the story stays too.
    expect(o.state.tasks[taskId]).toBeDefined();
  });

  it('lets the leader archive a wrong project with projects.setStatus', async () => {
    const o = office(withSubCompany);
    const agent = o.as(ADMIN);
    const id = output(await agent.call('projects.create', { name: 'Wrong', clientId: 'cli_001', subCompanyId: 'sub_001', codeParts: PARTS })).project.id as string;
    const archived = await agent.call('projects.setStatus', { id, status: 'archived' });
    expect(archived.isError, JSON.stringify(archived)).toBeUndefined();
    expect(o.state.projects[id].status).toBe('archived');
  });

  it('follows the Undo rule of client.created for clients.create: the agent of the same person takes it back', async () => {
    const o = office();
    const agent = o.as(ADMIN);
    const made = await agent.call('clients.create', { name: 'Brand New Co', initials: 'BNC' });
    expect(made.isError, JSON.stringify(made)).toBeUndefined();
    const id = output(made).id as string;
    expect(o.state.clients[id]).toMatchObject({ name: 'Brand New Co', initials: 'BNC' });
    const event = Object.values(o.state.events).find((item) => item.verb === 'client.created' && item.targetId === id)!;
    expect(event).toMatchObject({ actorKind: 'agent', actingForId: ADMIN });
    const undo = await agent.call('events.undo', { eventId: event.id });
    expect(undo.isError, JSON.stringify(undo)).toBeUndefined();
    expect(o.state.clients[id]).toBeUndefined();
  });
});

describe('the lean lists for the agent', () => {
  it('gives clients.list the id, the names and the initials, with no contact name, phone or email', async () => {
    const o = office((state) => { state.clients.cli_002 = { ...state.clients.cli_002, initials: 'DLD' }; });
    const rows = output(await o.as(ADMIN).call('clients.list')) as Record<string, unknown>[];
    expect(rows).toHaveLength(Object.keys(seed.clients).length);
    for (const row of rows) expect(Object.keys(row).sort(), String(row.id)).toEqual(['id', 'initials', 'name', 'nameAr']);
    expect(rows.find((row) => row.id === 'cli_002')).toMatchObject({ initials: 'DLD', name: 'Dune Line Developments' });
    const text = JSON.stringify(rows);
    for (const client of Object.values(seed.clients)) {
      expect(text).not.toContain(client.phone);
      expect(text).not.toContain(client.email);
    }
    expect(text).not.toContain('contactName');
  });

  it('gives projectTemplates.list the roles, the stage names and the task count, with no task text and no followers', async () => {
    const o = office();
    const rows = output(await o.as(ADMIN).call('projectTemplates.list')) as { id: string; name: string; roles: Record<string, unknown>[]; stageNames: string[]; taskCount: number }[];
    const templates = Object.values(o.state.projectTemplates ?? {});
    expect(templates.length).toBeGreaterThan(0);
    expect(rows).toHaveLength(templates.length);
    for (const row of rows) {
      expect(Object.keys(row).sort(), row.id).toEqual(['id', 'name', 'roles', 'stageNames', 'taskCount']);
      const template = o.state.projectTemplates![row.id];
      expect(row.stageNames).toEqual(template.stages.map((stage) => stage.name));
      expect(row.taskCount).toBe(template.tasks.length);
      expect(row.roles).toEqual(template.roles.map((role) => ({ id: role.id, name: role.name, defaultUserId: role.defaultUserId })));
    }
    const text = JSON.stringify(rows);
    expect(text).not.toContain('followers');
    expect(text).not.toContain('createdBy');
    for (const template of templates) for (const task of template.tasks) expect(text, task.title).not.toContain(task.title);
    expect(templates.some((template) => template.tasks.length > 0)).toBe(true);
  });

  it('gives the same lean rows to the agent of a custom role with the switch', async () => {
    const o = office((state) => giveRole(state, 'usr_004', setupRole()));
    const rows = output(await o.as('usr_004').call('clients.list')) as Record<string, unknown>[];
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['id', 'initials', 'name', 'nameAr']);
  });
});

describe('leaks: a role with ai.projectSetup and project.create but not project.hidden', () => {
  const HIDDEN = 'prj_005';
  const SECRET_KEY = '261007HID';
  const OPEN_KEY = '261008VIS';
  const hiddenOffice = () => office((state) => {
    withSubCompany(state);
    giveRole(state, 'usr_004', setupRole());
    state.projects[HIDDEN] = { ...state.projects[HIDDEN], code: `${SECRET_KEY}-RES-Secret`, access: { hidden: true, viewerIds: [] } };
    state.projects.prj_002 = { ...state.projects.prj_002, code: `${OPEN_KEY}-RES-Open` };
  });
  const swap = (value: unknown, id: string) => JSON.parse(JSON.stringify(value ?? null).split(id).join('@')) as unknown;

  it('answers sameContractAs of a hidden project as for a project that does not exist', async () => {
    const o = hiddenOffice();
    const agent = o.as('usr_004');
    const args = { name: 'Copycat', clientId: 'cli_001', subCompanyId: 'sub_001' };
    const hidden = await agent.call('projects.create', { ...args, sameContractAs: HIDDEN });
    const gone = await agent.call('projects.create', { ...args, sameContractAs: 'prj_999' });
    expect(errorOf(hidden)?.code).toBe('invalid_input');
    expect(swap(errorOf(hidden), HIDDEN)).toEqual(swap(errorOf(gone), 'prj_999'));
    // The same call for a project the person sees works, so the refusal above is about the hidden project and not about the call.
    const open = await agent.call('projects.create', { ...args, sameContractAs: 'prj_002' });
    expect(open.isError, JSON.stringify(open)).toBeUndefined();
    expect(output(open).project.code).toBe(`${OPEN_KEY}-RES-Open`);
  });

  it('leaves the key and the name of a hidden project out of code_taken, and names a project the person sees', async () => {
    const o = hiddenOffice();
    const agent = o.as('usr_004');
    const base = { name: 'Clash', clientId: 'cli_001', subCompanyId: 'sub_001' };
    const hidden = errorOf(await agent.call('projects.create', { ...base, code: `${SECRET_KEY}-COM-Other` }))!;
    expect(hidden.details?.reason).toBe('code_taken');
    expect(JSON.stringify(hidden)).not.toContain('HID');
    expect(JSON.stringify(hidden)).not.toContain('Secret');
    expect(JSON.stringify(hidden)).not.toContain(HIDDEN);
    // The control: the same refusal for an open project names its key, so the check above can see a key.
    const open = errorOf(await agent.call('projects.create', { ...base, code: `${OPEN_KEY}-COM-Other` }))!;
    expect(open.details?.reason).toBe('code_taken');
    expect(open.message).toContain(OPEN_KEY);
  });

  it('answers not_found to the agent of an outsider for an internal project that another agent made', async () => {
    const o = hiddenOffice();
    const maker = o.as('usr_004');
    const made = await maker.call('projects.create', { name: 'Private portfolio', kind: 'internal' });
    expect(made.isError, JSON.stringify(made)).toBeUndefined();
    const id = output(made).project.id as string;
    expect(output(made).project.code).toMatch(/^INT-26-\d+$/);
    expect(o.state.projects[id].access).toEqual({ hidden: true, viewerIds: [] });
    const task = await maker.call('tasks.create', { projectId: id, title: 'Secret internal task' });
    expect(task.isError, JSON.stringify(task)).toBeUndefined();
    const taskId = Object.values(o.state.tasks).find((item) => item.projectId === id)!.id;

    // The maker, the team and the Admin (project.hidden) read it.
    expect(output(await maker.call('projects.get', { id })).project.id).toBe(id);
    expect(output(await o.as(ADMIN).call('projects.get', { id })).project.id).toBe(id);

    // An outsider (a default Member, and Management) gets the answer for a project that does not exist.
    for (const outsider of [MEMBER, MANAGEMENT]) {
      const agent = o.as(outsider);
      const probes: [string, Record<string, unknown>, Record<string, unknown>, string][] = [
        ['projects.get', { id }, { id: 'prj_998' }, id],
        ['tasks.list', { projectId: id }, { projectId: 'prj_998' }, id],
        ['comments.list', { targetType: 'task', targetId: taskId }, { targetType: 'task', targetId: 'tsk_998' }, taskId],
        ['events.list', { projectId: id }, { projectId: 'prj_998' }, id],
      ];
      for (const [name, real, gone, token] of probes) {
        const a = await agent.call(name, real);
        const b = await agent.call(name, gone);
        const missing = JSON.stringify(gone).match(/"([a-z]{3}_998)"/)![1];
        expect(swap(a.isError ? errorOf(a) : output(a), token), `${outsider} ${name}`).toEqual(swap(b.isError ? errorOf(b) : output(b), missing));
        // The outsider learns nothing from the answer: no name, no id of the hidden project.
        expect(JSON.stringify(a), `${outsider} ${name}`).not.toContain('Private portfolio');
        expect(JSON.stringify(a), `${outsider} ${name}`).not.toContain('Secret internal task');
      }
      const listed = JSON.stringify(output(await agent.call('projects.list', { status: 'all' })));
      expect(listed, outsider).not.toContain(id);
      const found = JSON.stringify(output(await agent.call('search.query', { text: 'Private portfolio' })));
      expect(found, outsider).not.toContain('Private portfolio');
      const history = JSON.stringify(output(await agent.call('events.list', { limit: 500 })));
      expect(history, outsider).not.toContain(id);
    }
  });

  it('sends the signals of a new internal project to its audience only, and the signal of a client project to the office', async () => {
    const o = hiddenOffice();
    const admins = Object.values(o.state.users).filter((user) => user.systemRole === 'admin' && user.active && user.kind === 'human').map((user) => `person:${user.id}`);
    const before = o.deps.signal.sent.length;
    const made = await o.as('usr_004').call('projects.create', { name: 'Signal portfolio', kind: 'internal' });
    expect(made.isError, JSON.stringify(made)).toBeUndefined();
    const id = output(made).project.id as string;
    const signals = o.deps.signal.sent.slice(before);
    expect(signals.length).toBeGreaterThan(0);
    const channels = signals.map((signal) => signal.channel);
    expect(channels).not.toContain('office');
    for (const channel of channels) expect([...admins, 'person:usr_004'], channel).toContain(channel);
    for (const outsider of [MEMBER, MANAGEMENT, ACCOUNTING, 'usr_003']) expect(channels, outsider).not.toContain(`person:${outsider}`);
    for (const signal of signals) if (signal.projects) expect(signal.projects).toEqual([id]);

    // The control: a client project is an office project, so the office hears it. The check above can see an office signal.
    const mark = o.deps.signal.sent.length;
    const open = await o.as('usr_004').call('projects.create', { name: 'Open project', clientId: 'cli_001', subCompanyId: 'sub_001', codeParts: PARTS });
    expect(open.isError, JSON.stringify(open)).toBeUndefined();
    expect(o.deps.signal.sent.slice(mark).map((signal) => signal.channel)).toContain('office');
  });
});

describe('the words for the agent', () => {
  it('tells the agent in projects.create that there is no Undo and that it must ask first, in 600 characters or fewer', () => {
    const doc = TOOL_DOCS['projects.create'];
    expect(doc.title).toBe('Create a project');
    for (const word of ['no Undo', 'ask your person first', 'codeParts', 'sub-company', 'leader', 'teamIds', 'template', 'kind internal', 'After a timeout, list before you try again']) {
      expect(doc.description, word).toContain(word);
    }
  });

  it('keeps the four texts short, plain and free of an em-dash, and keeps phone and email out of the client list', () => {
    for (const name of FOUR) {
      const doc = TOOL_DOCS[name];
      expect(doc, name).toBeDefined();
      expect(doc.description.length, name).toBeGreaterThanOrEqual(40);
      expect(doc.description.length, name).toBeLessThanOrEqual(600);
      expect(doc.description, name).not.toMatch(/[–—]/);
    }
    expect(TOOL_DOCS['clients.list'].description).not.toMatch(/phone|email/i);
    expect(TOOL_DOCS['clients.create'].description).toContain('client.create');
    expect(TOOL_DOCS['projectTemplates.list'].description).toContain('template.templateId');
  });

  it('has a "New projects:" paragraph in the instructions and no longer says that an agent cannot make a project', () => {
    expect(INSTRUCTIONS).not.toContain('You cannot make a project');
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('New projects: '));
    expect(line).toBeDefined();
    for (const word of ['projects.create', 'ask your person for the name, the client, the sub-company, the leader and the team', 'Never choose a leader or a team yourself', 'no Undo', 'archived', 'projects.setStatus', 'Only an Admin deletes', 'clients.create', 'projects.list before you try again']) {
      expect(line, word).toContain(word);
    }
    expect(line).not.toMatch(/[–—]/);
    expect(INSTRUCTIONS).toContain('You make one with projects.create and kind internal.');
  });
});
