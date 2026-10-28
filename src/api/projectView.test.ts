import { describe, expect, it } from 'vitest';
import { goneProjectsOf } from './projectView';

// The team of a deleted project whose delete event holds no team list (written before the list existed, security review F4). The rule
// replays the changes of the team rows. An Undo is a change of its own (verb "undo"), so an undone add must not count as a team member.
const P = 'prj_009';
const row = (userId: string) => ({ projectId: P, userId, role: 'member' });
const change = (seq: number, verb: string, before: unknown, after: unknown) => ({
  verb, projectId: P, targetType: 'member' as const, targetId: `${P}:usr_007`, seq, before, after,
});
const deleted = (seq: number, teamIds?: string[]) => ({
  verb: 'project.deleted', projectId: P, targetType: 'project' as const, targetId: P, seq,
  before: { id: P, leaderId: 'usr_001', access: { hidden: false, viewerIds: [] } }, after: null, ...(teamIds ? { teamIds } : {}),
});
const teamOf = (events: Parameters<typeof goneProjectsOf>[0]) => goneProjectsOf(events).get(P)?.teamIds;

describe('the team of a deleted project with no team list (security review F4)', () => {
  it('leaves out a person whose add was undone before the delete', () => {
    expect(teamOf([change(1, 'member.added', null, row('usr_007')), change(2, 'undo', row('usr_007'), null), deleted(3)])).toEqual([]);
  });

  it('keeps a person whose remove was undone before the delete', () => {
    const events = [change(1, 'member.added', null, row('usr_007')), change(2, 'member.removed', row('usr_007'), null), change(3, 'undo', null, row('usr_007')), deleted(4)];
    expect(teamOf(events)).toEqual(['usr_007']);
  });

  it('keeps a person whose row only changed its role, and ignores a change after the delete', () => {
    const events = [change(1, 'member.added', null, row('usr_007')), change(2, 'member.updated', row('usr_007'), { ...row('usr_007'), role: 'lead' }), deleted(3), change(4, 'member.removed', row('usr_007'), null)];
    expect(teamOf(events)).toEqual(['usr_007']);
  });

  it('reads the list of a delete event that holds one, and no change', () => {
    expect(teamOf([change(1, 'member.added', null, row('usr_007')), deleted(2, ['usr_003'])])).toEqual(['usr_003']);
  });
});
