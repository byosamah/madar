import { describe, expect, it } from 'vitest';
import { ADMIN_PAGE_RIGHTS } from '../../../api/rights';
import { ar, en } from '../../../i18n/trees';
import { ADMIN_GROUPS, ADMIN_SECTIONS, groupsFor, sectionsFor } from './sections';

const word = (tree: object, key: string) => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree);
const ids = (list: readonly { id: string }[]) => list.map((section) => section.id);
/** A person with the role and no rights of the office settings, so the defaults of the role apply. */
const as = (systemRole: 'admin' | 'management' | 'accounting' | 'member') => ({ systemRole });

describe('the Admin section registry', () => {
  it('keeps the groups in the order of the owner: People, Office, Templates, System', () => {
    expect(ADMIN_GROUPS).toEqual(['people', 'office', 'templates', 'system']);
  });

  it('gives each section a unique link part, a known group, and a word in both languages', () => {
    expect(new Set(ids(ADMIN_SECTIONS)).size).toBe(ADMIN_SECTIONS.length);
    for (const section of ADMIN_SECTIONS) {
      expect(section.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(ADMIN_GROUPS).toContain(section.group);
      expect(typeof word(en, section.titleKey), section.titleKey).toBe('string');
      expect(typeof word(ar, section.titleKey), section.titleKey).toBe('string');
      expect(section.roles.length).toBeGreaterThan(0);
      // A section that a right opens names a right that opens the Admin page (PersonMenu reads the same list).
      if (section.right !== undefined) expect(ADMIN_PAGE_RIGHTS, section.id).toContain(section.right);
    }
    for (const group of ADMIN_GROUPS) {
      expect(typeof word(en, `adminNav.groups.${group}`)).toBe('string');
      expect(typeof word(ar, `adminNav.groups.${group}`)).toBe('string');
    }
  });

  it('gives the Admin every section in group order, and Usage only in the real build', () => {
    expect(ids(sectionsFor(as('admin'), false))).toEqual(['people', 'teams', 'roles', 'office', 'clients', 'sub-companies', 'project-templates', 'task-templates', 'feedback']);
    expect(ids(sectionsFor(as('admin'), true))).toEqual(['people', 'teams', 'roles', 'office', 'clients', 'sub-companies', 'project-templates', 'task-templates', 'feedback', 'usage']);
  });

  it('gives Management People and Teams only, and Accounting and a member nothing', () => {
    expect(ids(sectionsFor(as('management'), true))).toEqual(['people', 'teams']);
    expect(sectionsFor(as('accounting'), true)).toEqual([]);
    expect(sectionsFor(as('member'), true)).toEqual([]);
  });

  it('opens a section for a person with the right that the section names, whatever the role', () => {
    expect(ids(sectionsFor({ systemRole: 'member', officeRights: ['people.manage'] }, false))).toEqual(['people', 'teams']);
    expect(ids(sectionsFor({ systemRole: 'member', officeRights: ['templates.manageAll'] }, false))).toEqual(['project-templates', 'task-templates']);
    expect(ids(sectionsFor({ systemRole: 'member', officeRights: ['clients.manage'] }, false))).toEqual(['clients']);
  });

  it('takes the People section away from Management that lost the people right', () => {
    expect(sectionsFor({ systemRole: 'management', officeRights: ['report.office'] }, true)).toEqual([]);
  });

  it('opens no section for a right that no section names', () => {
    expect(sectionsFor({ systemRole: 'member', officeRights: ['payment.manage', 'report.office', 'project.editCode'] }, true)).toEqual([]);
  });

  it('shows the Roles section to the Admin only, whatever the rights say', () => {
    expect(ids(sectionsFor({ systemRole: 'management', officeRights: ['people.manage'] }, false))).not.toContain('roles');
    expect(ids(sectionsFor({ systemRole: 'member', officeRights: ['people.manage', 'clients.manage', 'templates.manageAll'] }, false))).not.toContain('roles');
  });

  it('orders the sections by group, whatever the place of a line in the list', () => {
    // A section added at the end of the list (as the merge lead adds Clients) still shows inside its own group.
    const late = { id: 'late', group: 'office' as const, titleKey: 'admin.office', roles: ['admin' as const], Component: () => null };
    expect(ids(sectionsFor(as('admin'), false, [...ADMIN_SECTIONS, late]))).toEqual(['people', 'teams', 'roles', 'office', 'clients', 'sub-companies', 'late', 'project-templates', 'task-templates', 'feedback']);
  });

  it('groups the sections for the list, and leaves out a group with no section for the role', () => {
    const groups = groupsFor(sectionsFor(as('management'), true));
    expect(groups.map((group) => group.group)).toEqual(['people']);
    expect(ids(groups[0].sections)).toEqual(['people', 'teams']);
    expect(groupsFor(sectionsFor(as('admin'), false)).map((group) => group.group)).toEqual(['people', 'office', 'templates', 'system']);
  });
});
