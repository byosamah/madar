import { describe, expect, it } from 'vitest';
import { BASIC_ON, CATALOG_RIGHT_IDS, DEFAULT_EXTRA, withNeeds, type CatalogRightId } from '../../../api/rightsCatalog';
import type { TFunction } from 'i18next';
import {
  SHEET_SECTIONS, customRoleName, holdsLeaderWarning, leadSwitchesOff, powerKey, roleLabel, roleLineParts, saveShape, sectionState, standardListOf, withRight, withSection,
} from './roleSheetLogic';

const MEMBER: readonly CatalogRightId[] = withNeeds([...BASIC_ON]);

describe('the sections of the role sheet', () => {
  it('hold the 122 switches once each, in 13 sections', () => {
    expect(SHEET_SECTIONS).toHaveLength(13);
    expect(SHEET_SECTIONS.flatMap((section) => section.ids)).toEqual([...CATALOG_RIGHT_IDS]);
  });

  it('give each power a word key that no other power has', () => {
    const keys = SHEET_SECTIONS.flatMap((section) => section.powers.map((power) => power.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(93);
    expect(powerKey('project.create')).toBe('projectCreate');
    expect(powerKey('templates.taskSave')).toBe('templatesTaskSave');
    expect(powerKey('subCompanies.manage')).toBe('subCompaniesManage');
  });
});

describe('a switch and the switches it needs', () => {
  it('brings its needs along when it turns on', () => {
    const held = withRight([], 'payment.add', true);
    expect(held).toEqual(['payment.view', 'payment.add']);
    expect(withRight([], 'project.details.all', true)).toEqual(['project.details.lead', 'project.details.all']);
    expect(withRight([], 'ai.undoOthers.all', true)).toEqual(expect.arrayContaining(['ai.connect', 'ai.undoOthers.lead', 'ai.undoOthers.all']));
  });

  it('turns its dependants off when a need turns off', () => {
    const held = withNeeds(['payment.add', 'payment.change', 'payment.receive']);
    expect(withRight(held, 'payment.view', false)).toEqual([]);
    expect(withRight(held, 'payment.add', false)).toEqual(['payment.view', 'payment.change', 'payment.receive']);
    // The Dashboard goes, so the workload goes with it.
    expect(withRight(MEMBER, 'dashboard.view', false)).not.toContain('workload.view');
    // Every AI switch needs the connect switch.
    const ai = withRight(MEMBER, 'ai.connect', false);
    expect(ai.filter((id) => id.startsWith('ai.'))).toEqual([]);
    // Every `.all` needs its `.lead` sibling.
    expect(withRight(withRight(MEMBER, 'project.details.all', true), 'project.details.lead', false)).not.toContain('project.details.all');
  });

  it('keeps the order of the catalog and each switch once', () => {
    const held = withRight(withRight(MEMBER, 'payment.add', true), 'people.invite', true);
    expect(held).toEqual(CATALOG_RIGHT_IDS.filter((id) => held.includes(id)));
    expect(new Set(held).size).toBe(held.length);
  });
});

describe('the All switch of a section', () => {
  const projects = SHEET_SECTIONS[0];

  it('reads off, mixed or on', () => {
    expect(sectionState([], projects.ids)).toBe('off');
    expect(sectionState(MEMBER, projects.ids)).toBe('mixed');
    expect(sectionState(CATALOG_RIGHT_IDS, projects.ids)).toBe('on');
  });

  it('turns every switch of the section on, and leaves the other sections as they are', () => {
    const held = withSection(MEMBER, projects.ids, true);
    expect(projects.ids.every((id) => held.includes(id))).toBe(true);
    expect(held.filter((id) => !projects.ids.includes(id))).toEqual(MEMBER.filter((id) => !projects.ids.includes(id)));
  });

  it('turns every switch of the section off, with the dependants in other sections', () => {
    const held = withSection(CATALOG_RIGHT_IDS, projects.ids, false);
    expect(held.some((id) => projects.ids.includes(id))).toBe(false);
    const money = SHEET_SECTIONS.find((section) => section.key === 'money')!;
    expect(withSection(CATALOG_RIGHT_IDS, money.ids, false).includes('payment.add')).toBe(false);
  });
});

describe('the standard list and the save shape', () => {
  it('gives the Member list 68 switches and the default extras to the other roles', () => {
    expect(standardListOf('member')).toHaveLength(68);
    expect(standardListOf('management')).toEqual(withNeeds([...BASIC_ON, ...DEFAULT_EXTRA.management]));
    expect(standardListOf('accounting')).toHaveLength(68 + 5);
  });

  it('saves the switches that are not basic as rights, and the basic switches that are off as off', () => {
    expect(saveShape(MEMBER)).toEqual({ rights: [], off: [] });
    const held = withRight(withRight(MEMBER, 'payment.view', true), 'task.work', false);
    expect(saveShape(held)).toEqual({ rights: ['payment.view'], off: expect.arrayContaining(['task.work']) });
    expect(saveShape(standardListOf('management')).rights).toEqual(DEFAULT_EXTRA.management);
  });
});

describe('the leader warning', () => {
  it('counts the "Projects I lead" switches that are off in the Projects section', () => {
    expect(leadSwitchesOff(MEMBER)).toBe(1);
    expect(holdsLeaderWarning(MEMBER)).toBe(false);
  });

  it('shows when Create projects is on and three or more switches are off', () => {
    const three = withRight(withRight(MEMBER, 'project.details.lead', false), 'project.team.lead', false);
    expect(leadSwitchesOff(three)).toBe(3);
    expect(holdsLeaderWarning(three)).toBe(true);
    expect(holdsLeaderWarning(withRight(three, 'project.create', false))).toBe(false);
  });
});

describe('the line of a role in the person sheet', () => {
  it('counts the switches beyond and below the standard list', () => {
    expect(roleLineParts(MEMBER)).toEqual({ more: 0, less: 0 });
    expect(roleLineParts(standardListOf('management'))).toEqual({ more: 10, less: 0 });
    const held = withRight(withRight(withRight(withRight(MEMBER, 'people.invite', true), 'people.change', true), 'task.work', false), 'file.share', false);
    expect(roleLineParts(held)).toEqual({ more: 2, less: 2 });
  });
});

describe('the name of a role', () => {
  const designer = { id: 'role_1', name: 'Designer', nameAr: 'مصمم', rights: [], off: [] };
  const roles = { custom: [designer] };
  const t = ((key: string) => `[${key}]`) as unknown as TFunction;

  it('picks the English or the Arabic name of a custom role', () => {
    expect(customRoleName(designer, 'en')).toBe('Designer');
    expect(customRoleName(designer, 'ar')).toBe('مصمم');
  });

  it('gives the custom role of a person its own name', () => {
    expect(roleLabel(roles, 'role_1', 'member', 'en', t)).toBe('Designer');
    expect(roleLabel(roles, 'role_1', 'member', 'ar', t)).toBe('مصمم');
  });

  it('gives the word of the built-in role when the person has no custom role, or the role is gone', () => {
    expect(roleLabel(roles, undefined, 'management', 'en', t)).toBe('[admin.roles.management]');
    expect(roleLabel(roles, null, 'admin', 'ar', t)).toBe('[admin.roles.admin]');
    expect(roleLabel(roles, 'role_9', 'member', 'en', t)).toBe('[admin.roles.member]');
    expect(roleLabel(undefined, 'role_1', 'member', 'en', t)).toBe('[admin.roles.member]');
  });
});
