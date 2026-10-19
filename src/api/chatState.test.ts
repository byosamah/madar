import { describe, expect, it } from 'vitest';
import { notifyLevelOf } from './chatNaming';
import { addDirectConversation, addGroupConversation, addProjectConversation, countsNamedOnly, levelFromRead } from './chatState';
import { NOTIFY_LEVELS, type Conversation } from './contract/entities';
import { STAMP, makeWorld } from '../test/factories';

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
