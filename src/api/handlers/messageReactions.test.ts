import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { addDirectConversation, addGroupConversation, addProjectConversation } from '../chatState';
import { emptyReactions, type Comment, type Message } from '../contract/entities';
import { NOW, STAMP, makeTask, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * Reactions on a chat message (design item 12, base B10). Faisal (usr_002) leads prj_001, Sara (usr_003) is on its team, Omar (usr_004) is
 * outside, Hala (usr_001) is the Admin. A reaction makes no notice, no push and no unread mark.
 */
const T1 = '2026-09-30T08:10:00.000+03:00';
const SECRET = 'Secret 7731';
const FAISAL_MESSAGE = 'msg_001';
const GROUP_SECRET_ID = 'msg_901';
const DIRECT_SECRET_ID = 'msg_902';
const PROJECT_SECRET_ID = 'msg_903';

function message(id: string, conversationId: string, over: Partial<Message>): Message {
  return { id, conversationId, authorId: 'usr_002', actingForId: 'usr_002', body: 'Hello', mentions: [], createdAt: T1, editedAt: null, ...over };
}

function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.tasks.tsk_001 = makeTask();
  state.counters.tsk = 1;
  const direct = addDirectConversation(state, 'usr_002', 'usr_003', STAMP).id;
  const projectChat = addProjectConversation(state, 'prj_001', STAMP).id;
  const group = addGroupConversation(state, 'Secret group', 'usr_001', ['usr_001', 'usr_002', 'usr_003'], STAMP).id;
  state.messages[FAISAL_MESSAGE] = message(FAISAL_MESSAGE, direct, { body: 'The wall is 40 cm higher.' });
  state.messages[GROUP_SECRET_ID] = message(GROUP_SECRET_ID, group, { body: `${SECRET} in the group` });
  state.messages[DIRECT_SECRET_ID] = message(DIRECT_SECRET_ID, direct, { body: `${SECRET} in the direct chat` });
  state.messages[PROJECT_SECRET_ID] = message(PROJECT_SECRET_ID, projectChat, { body: `${SECRET} in the project chat` });
  state.counters.msg = 903;
  const comment: Comment = { id: 'cmt_001', targetType: 'task', targetId: 'tsk_001', authorId: 'usr_002', body: 'A task note', reactions: emptyReactions(), createdAt: T1, editedAt: null };
  state.comments.cmt_001 = comment;
  state.counters.cmt = 1;
  return { t, state, direct, projectChat, group };
}

const failureOf = (promise: Promise<unknown>) => promise.then(() => null, (error: { code: string; message: string; details?: { reason?: string } }) => error);

describe('reactions.toggle on a chat message', () => {
  it('toggles my reaction on a message, with no notice and no unread mark', async () => {
    const { t, state } = world();
    t.as('usr_002');
    const unreadOf = async (userId: string) => { t.as(userId); return (await t.api.call('chats.unreadCount', {})).unread; };
    const before = { notices: Object.keys(state.notifications).length, unread: await unreadOf('usr_002'), sara: await unreadOf('usr_003'), events: Object.keys(state.events).length };
    t.as('usr_003');
    const on = await t.api.call('reactions.toggle', { messageId: FAISAL_MESSAGE, emoji: '👍' });
    expect(on).toMatchObject({ message: { id: FAISAL_MESSAGE, reactions: { '👍': ['usr_003'], '✅': [], '👀': [] } } });
    expect(Object.keys(state.notifications)).toHaveLength(before.notices);
    expect(Object.keys(state.events)).toHaveLength(before.events);
    expect(await unreadOf('usr_002')).toBe(before.unread);
    expect(await unreadOf('usr_003')).toBe(before.sara);
    expect(state.messages[FAISAL_MESSAGE].createdAt).toBe(T1);
    t.as('usr_003');
    const off = await t.api.call('reactions.toggle', { messageId: FAISAL_MESSAGE, emoji: '👍' });
    expect(off).toMatchObject({ message: { reactions: { '👍': [], '✅': [], '👀': [] } } });
  });

  it('lets two people react with the same emoji, and keeps each reaction apart', async () => {
    const { t } = world();
    t.as('usr_003');
    await t.api.call('reactions.toggle', { messageId: FAISAL_MESSAGE, emoji: '✅' });
    t.as('usr_002');
    const second = await t.api.call('reactions.toggle', { messageId: FAISAL_MESSAGE, emoji: '✅' });
    expect(second).toMatchObject({ message: { reactions: { '✅': ['usr_003', 'usr_002'] } } });
    await t.api.call('reactions.toggle', { messageId: FAISAL_MESSAGE, emoji: '👀' });
    t.as('usr_003');
    const page = await t.api.call('chats.messages', { conversationId: t.store.state.messages[FAISAL_MESSAGE].conversationId });
    expect(page.messages.find((view) => view.message.id === FAISAL_MESSAGE)?.message.reactions).toEqual({ '👍': [], '✅': ['usr_003', 'usr_002'], '👀': ['usr_002'] });
  });

  it('reacts in a closed chat, and for the person behind an agent', async () => {
    const { t, state } = world();
    state.users.usr_002.active = false;
    t.as('usr_005');
    const view = await t.api.call('reactions.toggle', { messageId: FAISAL_MESSAGE, emoji: '👍' });
    // The reaction belongs to the person the agent acts for.
    expect(view).toMatchObject({ message: { reactions: { '👍': ['usr_003'] } } });
  });

  it('keeps the reactions of comments as they were', async () => {
    const { t, state } = world();
    t.as('usr_003');
    const view = await t.api.call('reactions.toggle', { commentId: 'cmt_001', emoji: '👍' });
    expect(view).toMatchObject({ comment: { id: 'cmt_001', reactions: { '👍': ['usr_003'] } } });
    expect(Object.values(state.events).map((event) => event.verb)).toContain('comment.reacted');
  });

  it('refuses an input with both ids or with none', async () => {
    const { t } = world();
    t.as('usr_003');
    expect(await failureOf(t.api.call('reactions.toggle', { commentId: 'cmt_001', messageId: FAISAL_MESSAGE, emoji: '👍' }))).toMatchObject({ code: 'invalid_input' });
    expect(await failureOf(t.api.call('reactions.toggle', { emoji: '👍' } as never))).toMatchObject({ code: 'invalid_input' });
    expect(t.store.state.messages[FAISAL_MESSAGE].reactions).toBeUndefined();
  });

  it('answers not_found for a message of a chat the person may not open, and for a deleted message', async () => {
    const { t } = world();
    t.as('usr_004');
    for (const messageId of [GROUP_SECRET_ID, DIRECT_SECRET_ID, PROJECT_SECRET_ID, 'msg_999']) {
      const error = await failureOf(t.api.call('reactions.toggle', { messageId, emoji: '👍' }));
      expect(error, messageId).toMatchObject({ code: 'not_found' });
      expect(JSON.stringify(error), messageId).not.toContain(SECRET);
    }
    expect(Object.values(t.store.state.messages).filter((m) => m.reactions !== undefined)).toEqual([]);
    t.store.state.messages[FAISAL_MESSAGE].deletedAt = STAMP;
    t.as('usr_003');
    expect(await failureOf(t.api.call('reactions.toggle', { messageId: FAISAL_MESSAGE, emoji: '👍' }))).toMatchObject({ code: 'not_found' });
  });
});
