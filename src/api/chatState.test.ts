import { describe, expect, it } from 'vitest';
import { notifyLevelOf } from './chatNaming';
import { adminReachOf, addDirectConversation, addGroupConversation, addProjectConversation, chatMemberIds, countsNamedOnly, hiddenByReach, levelFromRead, typingRecipients } from './chatState';
import { NOTIFY_LEVELS, type Conversation } from './contract/entities';
import { memberKey } from './rowKeys';
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

describe('chatMemberIds and typingRecipients: the members of a chat today (chat presence design B and C4)', () => {
  // usr_001 Admin (outside the team), usr_002 leads prj_001, usr_003 on its team, usr_004 outside, usr_005 an agent of usr_003.
  it('gives the two people of a direct chat, the people of a group, and the leader and team of a project chat', () => {
    const state = makeWorld();
    const direct = addDirectConversation(state, 'usr_002', 'usr_003', STAMP);
    const group = addGroupConversation(state, 'A group', 'usr_002', ['usr_002', 'usr_003', 'usr_001'], STAMP);
    const project = addProjectConversation(state, 'prj_001', STAMP);
    expect(chatMemberIds(state, direct)).toEqual(['usr_002', 'usr_003']);
    expect(chatMemberIds(state, group)).toEqual(['usr_002', 'usr_003', 'usr_001']);
    expect(chatMemberIds(state, project).sort()).toEqual(['usr_002', 'usr_003']);
  });

  it('leaves out a person who is off, an agent, and the Admin who is not on the team', () => {
    const state = makeWorld();
    const group = addGroupConversation(state, 'A group', 'usr_002', ['usr_002', 'usr_003', 'usr_004', 'usr_005'], STAMP);
    const project = addProjectConversation(state, 'prj_001', STAMP);
    state.users.usr_004.active = false;
    expect(chatMemberIds(state, group)).toEqual(['usr_002', 'usr_003']);
    state.users.usr_003.active = false;
    expect(chatMemberIds(state, project)).toEqual(['usr_002']);
    expect(chatMemberIds(state, project)).not.toContain('usr_001');
    // A person taken off the team is no member any more.
    state.users.usr_003.active = true;
    delete state.members[memberKey('prj_001', 'usr_003')];
    expect(chatMemberIds(state, project)).toEqual(['usr_002']);
  });

  it('gives the other members for a typist, [] for a person who may see the chat and is no member, and null when the chat is hidden or missing', () => {
    const state = makeWorld();
    const direct = addDirectConversation(state, 'usr_002', 'usr_003', STAMP);
    const group = addGroupConversation(state, 'A group', 'usr_002', ['usr_002', 'usr_003', 'usr_001'], STAMP);
    const project = addProjectConversation(state, 'prj_001', STAMP);
    expect(typingRecipients(state, direct.id, 'usr_002')).toEqual(['usr_003']);
    expect(typingRecipients(state, group.id, 'usr_003')).toEqual(['usr_002', 'usr_001']);
    expect(typingRecipients(state, project.id, 'usr_003')).toEqual(['usr_002']);
    // The Admin may open a project chat without being on the team: no member, so nobody hears.
    expect(typingRecipients(state, project.id, 'usr_001')).toEqual([]);
    // An outsider, a person who is off, and an id that was never made give null.
    expect(typingRecipients(state, direct.id, 'usr_004')).toBeNull();
    expect(typingRecipients(state, group.id, 'usr_004')).toBeNull();
    expect(typingRecipients(state, project.id, 'usr_004')).toBeNull();
    expect(typingRecipients(state, 'cnv_999', 'usr_002')).toBeNull();
    state.users.usr_003.active = false;
    expect(typingRecipients(state, direct.id, 'usr_003')).toBeNull();
    expect(typingRecipients(state, direct.id, 'usr_002')).toEqual([]);
  });
});
