import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { addDirectConversation, addProjectConversation } from '../chatState';
import { MAX_REACTION_KINDS } from '../contract/emoji';
import { Comment, Message, emptyReactions, type Comment as CommentRec, type Message as MessageRec } from '../contract/entities';
import { NOW, STAMP, makeTask, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/** Reactions with any one emoji (chat presence design E5, base B1). Faisal (usr_002) leads prj_001, Sara (usr_003) is on its team. */
const T1 = '2026-09-30T08:10:00.000+03:00';
const MESSAGE = 'msg_001';
const COMMENT = 'cmt_001';

function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.tasks.tsk_001 = makeTask();
  state.counters.tsk = 1;
  const direct = addDirectConversation(state, 'usr_002', 'usr_003', STAMP).id;
  addProjectConversation(state, 'prj_001', STAMP);
  const message: MessageRec = { id: MESSAGE, conversationId: direct, authorId: 'usr_002', actingForId: 'usr_002', body: 'The wall is 40 cm higher.', mentions: [], createdAt: T1, editedAt: null };
  state.messages[MESSAGE] = message;
  state.counters.msg = 1;
  const comment: CommentRec = { id: COMMENT, targetType: 'task', targetId: 'tsk_001', authorId: 'usr_002', body: 'A task note', reactions: emptyReactions(), createdAt: T1, editedAt: null };
  state.comments[COMMENT] = comment;
  state.counters.cmt = 1;
  return { t, state, direct };
}

type MessageViewOf = { message: MessageRec };
const failureOf = (promise: Promise<unknown>) => promise.then(() => null, (error: { code: string; message: string }) => error);

describe('reactions with any one emoji', () => {
  it('puts 🎉 on a chat message and on a comment', async () => {
    const { t } = world();
    t.as('usr_003');
    const onMessage = await t.api.call('reactions.toggle', { messageId: MESSAGE, emoji: '🎉' });
    expect(onMessage).toMatchObject({ message: { reactions: { '🎉': ['usr_003'] } } });
    const onComment = await t.api.call('reactions.toggle', { commentId: COMMENT, emoji: '🎉' });
    expect(onComment).toMatchObject({ comment: { reactions: { '🎉': ['usr_003'] } } });
    const off = (await t.api.call('reactions.toggle', { messageId: MESSAGE, emoji: '🎉' })) as MessageViewOf;
    expect(off.message.reactions).not.toHaveProperty('🎉');
  });

  it('refuses a reaction that is not one emoji', async () => {
    const { t } = world();
    t.as('usr_003');
    for (const emoji of ['ok', '👍👍', '<b>', '', '👍'.repeat(17)]) {
      expect(await failureOf(t.api.call('reactions.toggle', { messageId: MESSAGE, emoji })), emoji).toMatchObject({ code: 'invalid_input' });
      expect(await failureOf(t.api.call('reactions.toggle', { commentId: COMMENT, emoji })), emoji).toMatchObject({ code: 'invalid_input' });
    }
    expect(t.store.state.messages[MESSAGE].reactions).toBeUndefined();
    expect(t.store.state.comments[COMMENT].reactions).toEqual(emptyReactions());
  });

  it('refuses a 21st kind and takes a toggle of a kind that is there', async () => {
    const { t } = world();
    const kinds = ['🎉', '🙏', '🔥', '😂', '❤️', '😮', '😢', '😡', '🤔', '🙌', '💯', '🚀', '⭐', '🌟', '🍕', '☕', '🎯', '📌', '🧠', '🫡'];
    expect(kinds).toHaveLength(MAX_REACTION_KINDS);
    t.as('usr_003');
    for (const emoji of kinds) await t.api.call('reactions.toggle', { messageId: MESSAGE, emoji });
    const error = await failureOf(t.api.call('reactions.toggle', { messageId: MESSAGE, emoji: '🦄' }));
    expect(error).toMatchObject({ code: 'invalid_input', message: 'This message has the most reactions.' });
    expect(t.store.state.messages[MESSAGE].reactions).not.toHaveProperty('🦄');
    // A kind that is there still toggles, and a second person joins it.
    t.as('usr_002');
    const joined = (await t.api.call('reactions.toggle', { messageId: MESSAGE, emoji: '🎉' })) as MessageViewOf;
    expect(joined.message.reactions?.['🎉']).toEqual(['usr_003', 'usr_002']);
    t.as('usr_003');
    await t.api.call('reactions.toggle', { messageId: MESSAGE, emoji: '🎉' });
    t.as('usr_002');
    await t.api.call('reactions.toggle', { messageId: MESSAGE, emoji: '🎉' });
    // The kind has no people now: it goes, and a new kind fits.
    expect(t.store.state.messages[MESSAGE].reactions).not.toHaveProperty('🎉');
    t.as('usr_003');
    const added = (await t.api.call('reactions.toggle', { messageId: MESSAGE, emoji: '🦄' })) as MessageViewOf;
    expect(added.message.reactions?.['🦄']).toEqual(['usr_003']);
  });

  it('loads a stored three-key record and a record with 🎉', () => {
    const base = { id: 'msg_002', conversationId: 'cnv_001', authorId: 'usr_002', actingForId: 'usr_002', body: 'Hi', mentions: [], createdAt: T1, editedAt: null };
    expect(Message.safeParse({ ...base, reactions: { '👍': ['usr_003'], '✅': [], '👀': [] } }).success).toBe(true);
    expect(Message.safeParse({ ...base, reactions: { '🎉': ['usr_003'] } }).success).toBe(true);
    expect(Message.safeParse({ ...base, reactions: { 'ok': ['usr_003'] } }).success).toBe(false);
    const comment = { id: COMMENT, targetType: 'task', targetId: 'tsk_001', authorId: 'usr_002', body: 'Note', createdAt: T1, editedAt: null };
    expect(Comment.safeParse({ ...comment, reactions: { '👍': [], '✅': [], '👀': [] } }).success).toBe(true);
    expect(Comment.safeParse({ ...comment, reactions: { '🎉': ['usr_003'] } }).success).toBe(true);
  });

  it('does not count 🎉 as an answer for Waits for your reply', async () => {
    const { t, direct } = world();
    t.as('usr_003');
    // Faisal wrote the last message of the direct chat: it waits for Sara.
    const waiting = async () => (await t.api.call('chats.waiting', {})).map((row) => row.id);
    expect(await waiting()).toContain(direct);
    await t.api.call('reactions.toggle', { messageId: MESSAGE, emoji: '🎉' });
    expect(await waiting()).toContain(direct);
    await t.api.call('reactions.toggle', { messageId: MESSAGE, emoji: '👍' });
    expect(await waiting()).not.toContain(direct);
    expect(t.store.state.messages[MESSAGE].reactions?.['🎉']).toEqual(['usr_003']);
  });
});
