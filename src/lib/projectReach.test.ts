import { describe, expect, it } from 'vitest';
import { homeProjectsInput, isBareProjectsLink, projectsDefaultShow, reachOfSession } from './projectReach';

const link = (text: string) => new URLSearchParams(text);

describe('what "Only my work" does to the project lists (owner, 2026-10-26, fbk_065)', () => {
  it('gives the Admin the list of the office, and the Member list for "Only my work"', () => {
    expect(homeProjectsInput(true, 'mixed')).toEqual({ filter: 'all', sort: 'deadline' });
    expect(homeProjectsInput(true, 'all')).toEqual({ filter: 'all', sort: 'deadline' });
    expect(homeProjectsInput(true, 'mine')).toEqual({ filter: 'mine', status: 'all', sort: 'deadline' });
    expect(homeProjectsInput(false, 'mixed')).toEqual({ filter: 'mine', status: 'all', sort: 'deadline' });
  });

  it('reads the reach of a session answer, and "mixed" for a person who has no choice', () => {
    expect(reachOfSession({ user: { systemRole: 'admin', preferences: { adminReach: 'mine' } } })).toBe('mine');
    expect(reachOfSession({ user: { systemRole: 'admin', preferences: {} } })).toBe('mixed');
    expect(reachOfSession({ user: { systemRole: 'member', preferences: { adminReach: 'mine' } } })).toBe('mixed');
    expect(reachOfSession({ user: { systemRole: 'admin' } })).toBe('mixed');
    expect(reachOfSession(undefined)).toBe('mixed');
  });

  it('opens a bare link on "mine" only for "Only my work"', () => {
    expect(projectsDefaultShow('mine', link(''))).toBe('mine');
    expect(projectsDefaultShow('mixed', link(''))).toBe('all');
    expect(projectsDefaultShow('all', link(''))).toBe('all');
  });

  it.each(['filter=all', 'leader=usr_002', 'client=cli_001', 'team=team_001', 'stage=Permits', 'health=late', 'subCompany=sub_1', 'status=all', 'filter=no_area'])(
    'keeps "all" for a link with a filter key (%s)',
    (text) => {
      expect(isBareProjectsLink(link(text))).toBe(false);
      expect(projectsDefaultShow('mine', link(text))).toBe('all');
    },
  );
});
