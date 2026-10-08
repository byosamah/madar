import { describe, expect, it } from 'vitest';
import { ar, en } from '../../../i18n/trees';
import { ADMIN_GROUPS, ADMIN_SECTIONS, groupsFor, sectionsFor } from './sections';

const word = (tree: object, key: string) => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree);
const ids = (list: readonly { id: string }[]) => list.map((section) => section.id);

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
    }
    for (const group of ADMIN_GROUPS) {
      expect(typeof word(en, `adminNav.groups.${group}`)).toBe('string');
      expect(typeof word(ar, `adminNav.groups.${group}`)).toBe('string');
    }
  });

  it('gives the Admin every section in group order, and Usage only in the real build', () => {
    expect(ids(sectionsFor('admin', false))).toEqual(['people', 'teams', 'office', 'clients', 'project-templates', 'task-templates', 'feedback']);
    expect(ids(sectionsFor('admin', true))).toEqual(['people', 'teams', 'office', 'clients', 'project-templates', 'task-templates', 'feedback', 'usage']);
  });

  it('gives Management People and Teams only, and Accounting and a member nothing', () => {
    expect(ids(sectionsFor('management', true))).toEqual(['people', 'teams']);
    expect(sectionsFor('accounting', true)).toEqual([]);
    expect(sectionsFor('member', true)).toEqual([]);
  });

  it('orders the sections by group, whatever the place of a line in the list', () => {
    // A section added at the end of the list (as the merge lead adds Clients) still shows inside its own group.
    const late = { id: 'late', group: 'office' as const, titleKey: 'admin.office', roles: ['admin' as const], Component: () => null };
    expect(ids(sectionsFor('admin', false, [...ADMIN_SECTIONS, late]))).toEqual(['people', 'teams', 'office', 'clients', 'late', 'project-templates', 'task-templates', 'feedback']);
  });

  it('groups the sections for the list, and leaves out a group with no section for the role', () => {
    const groups = groupsFor(sectionsFor('management', true));
    expect(groups.map((group) => group.group)).toEqual(['people']);
    expect(ids(groups[0].sections)).toEqual(['people', 'teams']);
    expect(groupsFor(sectionsFor('admin', false)).map((group) => group.group)).toEqual(['people', 'office', 'templates', 'system']);
  });
});
