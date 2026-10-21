import { beforeEach, describe, expect, it } from 'vitest';
import { setNow } from '../lib/dates';
import { makeUser, makeWorld, NOW, testApi } from '../test/factories';
import { canSeeConversation, addProjectConversation } from './chatState';
import { mayShareProjectFile } from './handlers/attach';
import { historyCalls } from './handlers/history';
import { tasksCreate, taskCalls } from './handlers/tasks';
import type { Ctx } from './registry';
import { withRights } from './rights';

beforeEach(() => setNow(NOW));

/**
 * Role rights version 2 (design section 6.3): a person with no rights attached holds none, so a place that asks can() for another
 * person must attach the rights first. One test for each place of the list. A Member keeps what a Member does today.
 * Covered by older tests that fail without the attach (they failed first, in the build of this track):
 * - the mention filter and the chat people list: handlers/chats.test.ts ("chat mentions"), chatsEdit.test.ts, chatsReply.test.ts;
 * - the notice recipients and the links of a notice: handlers/noticeLinks.test.ts, noticeMessage.test.ts, chatsNotices.test.ts;
 * - adminCopies.ts: handlers/adminReachCopies.test.ts;
 * - the files of a chat: handlers/attachments.test.ts, chatsGroupLeaks.test.ts;
 * - server/files/rights.ts and server/calls/files.ts: server/files/rights.test.ts, server/calls/meetingFiles.test.ts;
 * - the push rule (server/push/chatRule.ts, chatFacts.ts) reads no can(): server/push/chatRule.test.ts.
 */

function world() {
  const state = makeWorld();
  state.users.usr_006 = makeUser('usr_006', { name: 'Outside Member' });
  const room = addProjectConversation(state, 'prj_001', '2026-10-01T08:00:00+03:00');
  return { state, room };
}

describe('canSeeConversation reads the rights of any person of the office', () => {
  it('lets a Member on the team open the project chat, with no rights attached by the caller', () => {
    const { state, room } = world();
    // The caller passes the plain record of the person: the check attaches the rights of the office settings.
    expect(canSeeConversation(state, room, state.users.usr_003)).toBe(true);
    expect(canSeeConversation(state, room, state.users.usr_002)).toBe(true);
    expect(canSeeConversation(state, room, state.users.usr_001)).toBe(true);
  });

  it('keeps the person outside the team out of the project chat', () => {
    const { state, room } = world();
    expect(canSeeConversation(state, room, state.users.usr_006)).toBe(false);
  });

  it('follows the chat switch of the office: the team switch off closes the chat, the all switch opens it to a person outside', () => {
    const { state, room } = world();
    state.settings.roles = { off: { member: ['chat.project.team'] } };
    expect(canSeeConversation(state, room, state.users.usr_003)).toBe(false);
    state.settings.roles = { rights: { member: ['chat.project.all'] } };
    expect(canSeeConversation(state, room, state.users.usr_006)).toBe(true);
  });
});

describe('the people who may share a project file', () => {
  it('lets the team, the leader and the Admin share, and not a person outside', () => {
    const { state } = world();
    const ctx = { state } as unknown as Ctx;
    expect(mayShareProjectFile(ctx, 'prj_001', 'usr_003')).toBe(true);
    expect(mayShareProjectFile(ctx, 'prj_001', 'usr_002')).toBe(true);
    expect(mayShareProjectFile(ctx, 'prj_001', 'usr_001')).toBe(true);
    expect(mayShareProjectFile(ctx, 'prj_001', 'usr_006')).toBe(false);
  });
});

describe('the History of an office to-do', () => {
  it('shows a Member the changes of the office to-do that the Member made, and hides them from a person who is not on it', async () => {
    const t = testApi({ ...taskCalls, ...historyCalls });
    t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Outside Member' });
    t.as('usr_003');
    const made = await t.api.call('tasks.create', { title: 'Private to-do' });
    const mine = await t.api.call('events.list', { targetType: 'task', targetId: made.task.id });
    expect(mine.length).toBeGreaterThan(0);
    t.as('usr_006');
    expect(await t.api.call('events.list', { targetType: 'task', targetId: made.task.id })).toEqual([]);
    expect(typeof tasksCreate).toBe('object');
  });
});

describe('withRights keeps the person and adds the rights once', () => {
  it('gives a Member the basic switches', () => {
    const { state } = world();
    const actor = withRights(state, state.users.usr_003);
    expect(actor.officeRights).toHaveLength(64);
  });
});
