import { describe, expect, it } from 'vitest';
import { notifyLevelOf } from './chatNaming';
import { addDirectConversation, addGroupConversation, addProjectConversation, levelFromRead } from './chatState';
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
