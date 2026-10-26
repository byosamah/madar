import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import { OFFICE_RIGHTS } from '../../src/api/permissions';
import { heldRightsOfRole } from '../../src/api/rights';
import { MCP_TOOLS_BY_SWITCH } from '../../src/api/rightsCatalog';
import { buildSeed } from '../../src/data/seed';
import { snapshotOf } from '../data/officeCache';
import { AI_SWITCH_LABELS, AI_SWITCHES, aiOffError, aiSwitchOf, assertMayConnect, mayConnect, toolsOfAiSwitch } from './aiSwitches';
import { roleWithout } from './aiRoles.testing';
import { MCP_ADMIN, MCP_ALLOW, MCP_BY_RIGHT, NO_CALL_TOOLS, READ_FIRST, mcpTools, visibleTools, toolOfOffSwitch, type ToolDef } from './tools';

/** The AI section of the catalog JSON in docs: the names and the tools of each AI switch. */
type Json = { sections: { key: string; powers: { power: string; en: string; mcpTools?: string[] }[] }[] };
const json = JSON.parse(readFileSync(resolve(process.cwd(), 'docs/superpowers/specs/2026-10-21-madar-role-rights-v2-catalog.json'), 'utf8')) as Json;
const aiPowers = json.sections.find((section) => section.key === 'ai')!.powers;

const allTools = [...MCP_ALLOW, ...MCP_ADMIN, ...Object.keys(MCP_BY_RIGHT)] as string[];
const CONNECT_ONLY = [READ_FIRST, 'story.start'];

describe('the map from each MCP tool to its AI switch (role rights version 2, design section 5.12)', () => {
  it('gives every tool of MCP_ALLOW and MCP_BY_RIGHT exactly one AI switch', () => {
    expect(allTools).toHaveLength(153);
    for (const tool of allTools) {
      const owners = AI_SWITCHES.filter((id) => toolsOfAiSwitch(id).includes(tool));
      expect(owners, tool).toHaveLength(1);
      expect(aiSwitchOf(tool), tool).toBe(owners[0]);
    }
  });

  it('puts madar.readFirst and story.start under ai.connect alone, and pictures.get under ai.readWork', () => {
    for (const tool of CONNECT_ONLY) expect(aiSwitchOf(tool), tool).toBe('ai.connect');
    expect(toolsOfAiSwitch('ai.connect')).toEqual(CONNECT_ONLY);
    expect(aiSwitchOf('pictures.get')).toBe('ai.readWork');
    expect(NO_CALL_TOOLS.has('pictures.get')).toBe(true);
    // The Undo of other agents has no tool of its own: the Undo rule of the History reads ai.undoOthers.
    expect(MCP_TOOLS_BY_SWITCH['ai.undoOthers.lead' as never]).toBeUndefined();
    expect(MCP_TOOLS_BY_SWITCH['ai.undoOthers.all' as never]).toBeUndefined();
  });

  it('maps the Undo tools to ai.undo and the other tools as the catalog lists them', () => {
    expect(aiSwitchOf('events.undo')).toBe('ai.undo');
    expect(aiSwitchOf('events.undoStory')).toBe('ai.undo');
    expect(aiSwitchOf('search.query')).toBe('ai.readWork');
    expect(aiSwitchOf('dashboard.get')).toBe('ai.readWork');
    expect(aiSwitchOf('payments.markReceived')).toBe('ai.payments');
    expect(aiSwitchOf('reports.office')).toBe('ai.report');
    expect(aiSwitchOf('feedback.setStatus')).toBe('ai.feedback');
    expect(aiSwitchOf('chats.send')).toBe('ai.messages');
    expect(aiSwitchOf('chats.waiting')).toBe('ai.readChats');
    expect(aiSwitchOf('meetings.saveMinutes')).toBe('ai.meetings');
    expect(aiSwitchOf('stages.setDates')).toBe('ai.projects');
    expect(aiSwitchOf('tasks.help')).toBe('ai.todos');
    expect(aiSwitchOf('tracker.close')).toBe('ai.tracker');
    expect(aiSwitchOf('comments.create')).toBe('ai.posts');
    expect(aiSwitchOf('projects.create')).toBe('ai.projectSetup');
    expect(aiSwitchOf('clients.create')).toBe('ai.projectSetup');
    expect(aiSwitchOf('clients.list')).toBe('ai.projectSetup');
    expect(aiSwitchOf('projectTemplates.list')).toBe('ai.projectSetup');
    expect(toolsOfAiSwitch('ai.projectSetup')).toEqual([
      'projects.create', 'clients.create', 'clients.list', 'projectTemplates.list', 'stageTemplates.list', 'stageTemplates.save', 'stageTemplates.delete',
      'projectTemplates.save', 'projectTemplates.delete', 'projectTemplates.matchPlan', 'projectTemplates.link', 'projectTemplates.usage', 'projectTemplates.syncPlan', 'projectTemplates.syncApply',
    ]);
    // The tools of the MCP parity track (owner, 2026-10-26) each have one switch of their area, and the Admin work has ai.admin.
    expect(aiSwitchOf('projects.setLeader')).toBe('ai.projects');
    expect(aiSwitchOf('tasks.delete')).toBe('ai.todos');
    expect(aiSwitchOf('comments.delete')).toBe('ai.posts');
    expect(aiSwitchOf('chats.editMessage')).toBe('ai.messages');
    expect(aiSwitchOf('chats.markRead')).toBe('ai.myState');
    expect(aiSwitchOf('chats.unreadCount')).toBe('ai.readChats');
    expect(aiSwitchOf('notifications.list')).toBe('ai.readWork');
    expect(aiSwitchOf('notifications.markRead')).toBe('ai.myState');
    expect(aiSwitchOf('me.updateProfile')).toBe('ai.myState');
    expect(aiSwitchOf('feedback.send')).toBe('ai.feedback');
    expect(aiSwitchOf('payments.delete')).toBe('ai.payments');
    expect(aiSwitchOf('meetings.delete')).toBe('ai.meetings');
    expect(aiSwitchOf('tracker.delete')).toBe('ai.tracker');
    expect(aiSwitchOf('users.create')).toBe('ai.admin');
    expect(aiSwitchOf('roles.update')).toBe('ai.admin');
    expect(aiSwitchOf('settings.update')).toBe('ai.admin');
    // The calls that stay closed have no switch: no tool of them exists.
    for (const name of ['projects.delete', 'files.upload', 'google.status', 'chats.typing', 'stages.replace']) expect(aiSwitchOf(name), name).toBeUndefined();
  });

  it('has no tool in the catalog that the lists lack, and no tool in the lists that the catalog lacks', () => {
    const fromCatalog = Object.values(MCP_TOOLS_BY_SWITCH).flatMap((tools) => [...(tools ?? [])]);
    expect(new Set(fromCatalog).size).toBe(fromCatalog.length);
    expect([...fromCatalog, ...CONNECT_ONLY].sort()).toEqual([...allTools].sort());
  });

  it('equals the AI section of the catalog JSON: the tools of each switch and its English name', () => {
    for (const power of aiPowers) {
      if (power.mcpTools) expect([...toolsOfAiSwitch(power.power as never)], power.power).toEqual(power.mcpTools);
      if ((AI_SWITCHES as readonly string[]).includes(power.power)) expect(AI_SWITCH_LABELS[power.power as keyof typeof AI_SWITCH_LABELS], power.power).toBe(power.en);
    }
    expect(aiPowers.map((power) => power.power).filter((id) => id !== 'ai.undoOthers')).toEqual([...AI_SWITCHES]);
  });

  it('keeps pictures.get in the catalog JSON and the module', () => {
    expect(MCP_TOOLS_BY_SWITCH['ai.readWork']).toContain('pictures.get');
    expect(aiPowers.find((power) => power.power === 'ai.readWork')!.mcpTools).toContain('pictures.get');
  });
});

describe('the list of tools for each AI switch', () => {
  const everything = mcpTools({ admin: true }).map((tool) => tool.name);
  const without = (id: string) => OFFICE_RIGHTS.filter((right) => right !== id);

  it('drops exactly the tools of one switch when only that switch is off, for each of the 16 switches', () => {
    for (const id of AI_SWITCHES) {
      const names = mcpTools({ rights: without(id), admin: true }).map((tool) => tool.name);
      expect(names, id).toEqual(everything.filter((name) => !toolsOfAiSwitch(id).includes(name)));
    }
  });

  it('lists only the tools of the switch that is on, with the rights of the Admin', () => {
    for (const id of AI_SWITCHES) {
      const names = mcpTools({ rights: OFFICE_RIGHTS.filter((right) => !right.startsWith('ai.') || right === id), admin: true }).map((tool) => tool.name);
      expect(names.sort(), id).toEqual([...toolsOfAiSwitch(id)].sort());
    }
  });

  it('lists nothing for a person with no AI switch at all', () => {
    expect(mcpTools({ rights: OFFICE_RIGHTS.filter((right) => !right.startsWith('ai.')) })).toEqual([]);
  });

  it('needs the right too for a right tool: ai.payments alone gives no payment tool, and the right alone gives none', () => {
    const base = OFFICE_RIGHTS.filter((right) => !right.startsWith('payment.') && right !== 'report.office' && right !== 'feedback.manage');
    const names = mcpTools({ rights: base }).map((tool) => tool.name);
    // A right tool shows exactly when the person holds its right: this list lacks the payment, report and feedback rights and keeps the others.
    const removed = ['payment.view', 'payment.add', 'payment.change', 'payment.receive', 'report.office', 'feedback.manage'];
    for (const [tool, right] of Object.entries(MCP_BY_RIGHT)) expect((names as string[]).includes(tool), tool).toBe(!removed.includes(right));
    expect(names).toContain('dashboard.get');
    const noAi = OFFICE_RIGHTS.filter((right) => right !== 'ai.payments').map(String);
    expect(mcpTools({ rights: noAi }).map((tool) => tool.name)).not.toContain('payments.create');
  });

  it('never lists a tool that no AI switch opens', () => {
    const [first] = mcpTools({ admin: true });
    const stranger: ToolDef = { ...first, name: 'projects.delete' as never };
    expect(visibleTools([stranger], () => true, true)).toEqual([]);
    expect(toolOfOffSwitch([stranger], () => false, 'projects.delete')).toBeUndefined();
  });

  it('finds the tool of a call only when its AI switch is off', () => {
    const all = mcpTools({ admin: true });
    const held = (id: string) => id !== 'ai.todos';
    expect(toolOfOffSwitch(all, held, 'tasks.create')?.name).toBe('tasks.create');
    // A role tool is unknown to a person without admin.manage, also when ai.admin is off; for the Admin the switch refusal shows.
    const noAdminSwitch = (id: string) => id !== 'ai.admin';
    expect(toolOfOffSwitch(all, noAdminSwitch, 'roles.update', false)).toBeUndefined();
    expect(toolOfOffSwitch(all, noAdminSwitch, 'roles.update', true)?.name).toBe('roles.update');
    expect(visibleTools(all, () => true, false).map((tool) => tool.name)).not.toContain('roles.update');
    expect(visibleTools(all, noAdminSwitch, true).map((tool) => tool.name)).not.toContain('roles.update');
    expect(visibleTools(all, () => true, true).map((tool) => tool.name)).toContain('roles.update');
    expect(toolOfOffSwitch(all, held, 'projects.get')).toBeUndefined();
    expect(toolOfOffSwitch(all, held, 'no.such.tool')).toBeUndefined();
  });
});

describe('the refusal of a switch that is off', () => {
  it('is forbidden with the reason ai_off, names the switch, and tells the agent to tell its person', () => {
    const error = aiOffError('ai.payments');
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('forbidden');
    expect(error.details).toEqual({ reason: 'ai_off', right: 'ai.payments' });
    expect(error.message).toBe('The Admin turned off "AI handles payments" (ai.payments) for the role of your person. Tell your person. Do not try another way.');
    expect(aiOffError('ai.connect').message).toContain('no AI assistant of this person works in Madar');
    for (const id of AI_SWITCHES) expect(aiOffError(id).message, id).not.toMatch(/[\u2013\u2014]/);
  });

  it('knows who may connect: the Admin and the roles that hold ai.connect, not a role that turns it off, and nobody who is not in the office', async () => {
    const lists = await buildSeed('2026-10-04', async () => undefined);
    const office = () => snapshotOf(lists, 1);
    expect(mayConnect(office(), 'usr_001')).toBe(true);
    expect(mayConnect(office(), 'usr_003')).toBe(true);
    expect(mayConnect(office(), 'usr_999')).toBe(false);
    lists.settings.roles = { custom: [roleWithout(['ai.connect'])] };
    lists.users.usr_003 = { ...lists.users.usr_003, systemRole: 'member', roleId: 'rol_001' };
    expect(mayConnect(office(), 'usr_003')).toBe(false);
    expect(() => assertMayConnect(office(), 'usr_003')).toThrowError(expect.objectContaining({ code: 'forbidden', details: { reason: 'ai_off', right: 'ai.connect' } }));
    expect(() => assertMayConnect(office(), 'usr_001')).not.toThrow();
    // A built-in role can turn it off too.
    const roles = { off: { management: [...OFFICE_RIGHTS.filter((id) => id.startsWith('ai.') && id !== 'ai.undoOthers.all')] } };
    lists.settings.roles = roles as never;
    lists.users.usr_004 = { ...lists.users.usr_004, systemRole: 'management' };
    expect(heldRightsOfRole(roles as never, 'management')).not.toContain('ai.connect');
    expect(mayConnect(office(), 'usr_004')).toBe(false);
  });
});
