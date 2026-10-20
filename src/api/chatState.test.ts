import { describe, expect, it } from 'vitest';
import { notifyLevelOf } from './chatNaming';
import { adminReachOf, addDirectConversation, addGroupConversation, addProjectConversation, countsNamedOnly, hiddenByReach, levelFromRead } from './chatState';
import { NOTIFY_LEVELS, type Conversation } from './contract/entities';
import { STAMP, makeUser, makeWorld } from '../test/factories';

describe('levelFromRead: the Notify me level without a State (chat design item 21)', () => {
  it('gives the default level of each chat kind, as notifyLevelOf does', () => {
    const state = makeWorld();
    const conversationOf = (kind: Conversation['kind']): Conversation =>
      kind === 'project' ? addProjectConversation(state, 'prj_001', STAMP)
        : kind === 'direct' ? addDirectConversation(state, 'usr_002', 'usr_003', STAMP)
          : addGroupConversation(state, 'A group', 'usr_002', ['usr_002', 'usr_003'], STAMP);
    for (const kind of ['project', 'direct', 'group'] as const) {
      const c = conversationOf(kind);
      expect(levelFromRead(undefined, kind)).toBe(notifyLevelOf(state, c, 'usr_003'));
      for (const notify of NOTIFY_LEVELS) expect(levelFromRead({ notify }, kind)).toBe(notify);
    }
    expect(levelFromRead(undefined, 'project')).toBe('named');
    expect(levelFromRead(undefined, 'group')).toBe('all');
    expect(levelFromRead({}, 'direct')).toBe('all');
  });
});

describe('countsNamedOnly: the Admin count of a project chat (chat design item 23)', () => {
  it('counts only named messages for an Admin outside the project who did not pick All messages', () => {
    const state = makeWorld();
    const project = addProjectConversation(state, 'prj_001', STAMP);
    const group = addGroupConversation(state, 'A group', 'usr_002', ['usr_002', 'usr_003'], STAMP);
    expect(countsNamedOnly('other', project, 'named')).toBe(true);
    expect(countsNamedOnly('team', project, 'named')).toBe(false);
    expect(countsNamedOnly('leader', project, 'named')).toBe(false);
    expect(countsNamedOnly('other', project, 'all')).toBe(false);
    expect(countsNamedOnly('other', group, 'named')).toBe(false);
  });
});

describe('adminReachOf: what reaches the Admin (owner, 2026-10-23)', () => {
  const prefs = (adminReach?: 'mine' | 'mixed' | 'all') => ({ ...makeUser('usr_x').preferences, ...(adminReach ? { adminReach } : {}) });

  it('reads "mixed" for an Admin who never picked', () => {
    expect(adminReachOf(makeUser('usr_x', { systemRole: 'admin' }))).toBe('mixed');
  });

  it('reads the stored choice for an Admin', () => {
    for (const choice of ['mine', 'mixed', 'all'] as const) {
      expect(adminReachOf(makeUser('usr_x', { systemRole: 'admin', preferences: prefs(choice) }))).toBe(choice);
    }
  });

  it('reads "mixed" for every person who is not an Admin, whatever is stored', () => {
    for (const systemRole of ['management', 'accounting', 'member'] as const) {
      expect(adminReachOf(makeUser('usr_x', { systemRole, preferences: prefs('all') }))).toBe('mixed');
      expect(adminReachOf(makeUser('usr_x', { systemRole, preferences: prefs('mine') }))).toBe('mixed');
    }
  });
});

describe('the Admin choice in the count rules', () => {
  it('counts every message of a chat outside the project when the Admin picked Everything', () => {
    const state = makeWorld();
    const project = addProjectConversation(state, 'prj_001', STAMP);
    expect(countsNamedOnly('other', project, 'named', 'all')).toBe(false);
    expect(countsNamedOnly('other', project, 'named', 'mixed')).toBe(true);
    expect(countsNamedOnly('other', project, 'named', 'mine')).toBe(true);
    expect(countsNamedOnly('other', project, 'named')).toBe(true);
  });

  it('hides the project chats with the role other, and only those, when the Admin picked Only my work', () => {
    const state = makeWorld();
    const project = addProjectConversation(state, 'prj_001', STAMP);
    const group = addGroupConversation(state, 'A group', 'usr_002', ['usr_002', 'usr_003'], STAMP);
    const direct = addDirectConversation(state, 'usr_002', 'usr_003', STAMP);
    expect(hiddenByReach('other', project, 'mine')).toBe(true);
    expect(hiddenByReach('leader', project, 'mine')).toBe(false);
    expect(hiddenByReach('team', project, 'mine')).toBe(false);
    expect(hiddenByReach('other', group, 'mine')).toBe(false);
    expect(hiddenByReach('other', direct, 'mine')).toBe(false);
    expect(hiddenByReach('other', project, 'mixed')).toBe(false);
    expect(hiddenByReach('other', project, 'all')).toBe(false);
  });
});
