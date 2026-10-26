import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BASIC_ON, CATALOG_RIGHT_IDS, CATALOG_SECTIONS, DEFAULT_EXTRA, expandRights, isLegacyRight, LEGACY_RIGHT_IDS, LEGACY_RIGHTS, MCP_TOOLS_BY_SWITCH,
  RIGHT_INFO, RIGHT_NEEDS, RIGHT_SCOPE, STORED_RIGHT_IDS, switchesOfPower, withNeeds,
} from './rightsCatalog';

type Json = {
  sections: { key: string; powers: { power: string; mcpTools?: string[]; switches: { id: string; scope: string | null; basic: boolean; newPower: boolean; needs: string[]; defaults: Record<'member' | 'management' | 'accounting', boolean> }[] }[] }[];
  legacy: Record<string, string[]>;
};
const json = JSON.parse(readFileSync(resolve(process.cwd(), 'docs/superpowers/specs/2026-10-21-madar-role-rights-v2-catalog.json'), 'utf8')) as Json;
const switches = json.sections.flatMap((s) => s.powers.flatMap((p) => p.switches));

describe('the catalog module equals the catalog JSON in docs', () => {
  it('has the same sections, powers, switches, scopes, needs and AI tools in the same order', () => {
    const fromModule = CATALOG_SECTIONS.map((s) => ({
      key: s.key,
      powers: s.powers.map((p) => ({
        power: p.power, ...(p.mcpTools ? { mcpTools: p.mcpTools } : {}),
        switches: p.switches.map((w) => ({ id: w.id, scope: w.scope, basic: w.basic, newPower: w.newPower === true, needs: w.needs })),
      })),
    }));
    const fromJson = json.sections.map((s) => ({
      key: s.key,
      powers: s.powers.map((p) => ({
        power: p.power, ...(p.mcpTools ? { mcpTools: p.mcpTools } : {}),
        switches: p.switches.map((w) => ({ id: w.id, scope: w.scope, basic: w.basic, newPower: w.newPower, needs: w.needs })),
      })),
    }));
    expect(fromModule).toEqual(fromJson);
  });

  it('counts 13 sections, 91 powers and 120 switches (Mention everyone added 1 power and 1 switch on 2026-10-22; hidden projects added 3 powers and 4 switches; AI project set-up added 1 power and 1 switch on 2026-10-25; the two AI switches of the MCP parity track added 2 powers and 2 switches on 2026-10-26)', () => {
    expect(CATALOG_SECTIONS).toHaveLength(13);
    expect(CATALOG_SECTIONS.flatMap((s) => s.powers)).toHaveLength(91);
    expect(CATALOG_RIGHT_IDS).toHaveLength(120);
    expect(new Set(CATALOG_RIGHT_IDS).size).toBe(120);
    expect(CATALOG_RIGHT_IDS).toEqual(switches.map((w) => w.id));
  });

  it('holds BASIC_ON as the 68 basic switches, and the default extras of the catalog defaults', () => {
    expect(BASIC_ON).toHaveLength(68);
    expect(BASIC_ON).toEqual(switches.filter((w) => w.basic).map((w) => w.id));
    for (const role of ['management', 'accounting', 'member'] as const) {
      expect(DEFAULT_EXTRA[role]).toEqual(switches.filter((w) => w.defaults[role] && !w.basic).map((w) => w.id));
      // A basic switch is on for every role by default.
      for (const w of switches.filter((item) => item.basic)) expect(w.defaults[role], `${role} ${w.id}`).toBe(true);
    }
    expect(BASIC_ON.length + DEFAULT_EXTRA.management.length).toBe(78);
    expect(BASIC_ON.length + DEFAULT_EXTRA.accounting.length).toBe(72);
  });

  it('holds the legacy map of the JSON, and the 17 old names', () => {
    expect(LEGACY_RIGHTS).toEqual(json.legacy);
    expect(LEGACY_RIGHT_IDS).toEqual(Object.keys(json.legacy));
    expect(LEGACY_RIGHT_IDS).toHaveLength(17);
  });

  it('gives the scope, the needs and the power of each id', () => {
    for (const w of switches) {
      expect(RIGHT_SCOPE[w.id as keyof typeof RIGHT_SCOPE]).toBe(w.scope);
      expect(RIGHT_NEEDS[w.id as keyof typeof RIGHT_NEEDS]).toEqual(w.needs);
    }
    expect(RIGHT_INFO['project.details.lead']).toMatchObject({ power: 'project.details', section: 'projects', scope: 'lead', basic: true });
    expect(RIGHT_INFO['project.delete.all']).toMatchObject({ newPower: true, basic: false });
    // The AI switch of project set-up (owner, 2026-10-25): a new power, off for every built-in role except the Admin, and it needs ai.connect.
    expect(RIGHT_INFO['ai.projectSetup']).toMatchObject({ power: 'ai.projectSetup', section: 'ai', scope: null, basic: false, newPower: true, needs: ['ai.connect'] });
    expect(MCP_TOOLS_BY_SWITCH['ai.projectSetup']).toEqual([
      'projects.create', 'clients.create', 'clients.list', 'projectTemplates.list', 'stageTemplates.list', 'stageTemplates.save', 'stageTemplates.delete',
      'projectTemplates.save', 'projectTemplates.delete', 'projectTemplates.matchPlan', 'projectTemplates.link', 'projectTemplates.usage', 'projectTemplates.syncPlan', 'projectTemplates.syncApply',
    ]);
    // The two AI switches of the MCP parity track (owner, 2026-10-26): Admin work is off for every built-in role, and the own marks and settings are on, as the other basic AI switches.
    expect(RIGHT_INFO['ai.admin']).toMatchObject({ power: 'ai.admin', section: 'ai', scope: null, basic: false, newPower: true, needs: ['ai.connect'] });
    expect(RIGHT_INFO['ai.myState']).toMatchObject({ power: 'ai.myState', section: 'ai', scope: null, basic: true, needs: ['ai.connect'] });
    expect(BASIC_ON).not.toContain('ai.admin');
    expect(BASIC_ON).toContain('ai.myState');
    for (const role of ['member', 'management', 'accounting'] as const) expect(DEFAULT_EXTRA[role]).not.toContain('ai.admin');
    expect(BASIC_ON).not.toContain('ai.projectSetup');
    for (const role of ['member', 'management', 'accounting'] as const) expect(DEFAULT_EXTRA[role]).not.toContain('ai.projectSetup');
    expect(switchesOfPower('task.add')).toEqual(['task.add.office', 'task.add.team', 'task.add.all']);
    expect(MCP_TOOLS_BY_SWITCH['ai.readChats']).toEqual(['chats.list', 'chats.messages', 'chats.waiting', 'chats.unreadCount']);
    // pictures.get came after the catalog was written (owner, 2026-10-21): it reads work data, with the rights of the screens.
    expect(MCP_TOOLS_BY_SWITCH['ai.readWork']).toContain('pictures.get');
    expect(MCP_TOOLS_BY_SWITCH['ai.readWork']).toHaveLength(22);
    expect(Object.values(MCP_TOOLS_BY_SWITCH).flatMap((tools) => [...(tools ?? [])])).toHaveLength(151);
  });

  it('keeps every need inside the catalog, and every .all switch needs its .lead or .team sibling', () => {
    for (const id of CATALOG_RIGHT_IDS) {
      for (const need of RIGHT_NEEDS[id]) expect(CATALOG_RIGHT_IDS).toContain(need);
      if (id.endsWith('.all') && !id.startsWith('ai.')) {
        const sibling = RIGHT_NEEDS[id].some((need) => need.endsWith('.lead') || need.endsWith('.team'));
        expect(sibling, id).toBe(true);
      }
    }
  });
});

describe('expandRights and withNeeds', () => {
  it('maps an old right to its new switches and keeps a new id', () => {
    expect(expandRights(['payment.manage'])).toEqual(['payment.view', 'payment.add', 'payment.change', 'payment.receive']);
    expect(expandRights(['project.editAny'])).toEqual(LEGACY_RIGHTS['project.editAny']);
    expect(expandRights(['report.office', 'task.add.team'])).toEqual(['task.add.team', 'report.office']);
    expect(expandRights(['unknown.id'])).toEqual([]);
  });

  it('lists each id once, in the order of the catalog', () => {
    expect(expandRights(['payment.view', 'payment.manage', 'payment.add'])).toEqual(['payment.view', 'payment.add', 'payment.change', 'payment.receive']);
  });

  it('adds the needed switches, also through two steps', () => {
    expect(withNeeds(['payment.add'])).toEqual(['payment.view', 'payment.add']);
    expect(withNeeds(['ai.undoOthers.all'])).toEqual(['ai.connect', 'ai.undoOthers.lead', 'ai.undoOthers.all']);
    expect(withNeeds(['project.details.all'])).toEqual(['project.details.lead', 'project.details.all']);
  });

  it('marks old names, and the stored form holds both the new ids and the old names', () => {
    expect(isLegacyRight('people.manage')).toBe(true);
    expect(isLegacyRight('people.invite')).toBe(false);
    for (const id of CATALOG_RIGHT_IDS) expect(STORED_RIGHT_IDS).toContain(id);
    for (const id of LEGACY_RIGHT_IDS) expect(STORED_RIGHT_IDS).toContain(id);
    expect(new Set(STORED_RIGHT_IDS).size).toBe(STORED_RIGHT_IDS.length);
    expect(STORED_RIGHT_IDS).toHaveLength(120 + 12);
  });
});
