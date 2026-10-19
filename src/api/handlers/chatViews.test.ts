import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { addDirectConversation, addGroupConversation, addProjectConversation } from '../chatState';
import { emptyReactions, type Comment, type Message } from '../contract/entities';
import { chatReadKey } from '../rowKeys';
import { NOW, STAMP, makeTask, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The views of a message and of a comment (base B5) give the link of a reply, the names-you mark, the read time before the open and
 * the Notify me level. Faisal (usr_002) leads prj_001, Sara (usr_003) is on its team, Omar (usr_004) is outside. The old message names
 * Sara, and Sara answers it.
 */
const OLD = 'msg_001';
const REPLY = 'msg_002';
const FOREIGN_REPLY = 'msg_003';
const GROUP_SECRET = 'msg_004';
const SARA_COMMENT = 'cmt_001';
const FAISAL_REPLY = 'cmt_002';
const EARLIER = '2026-09-30T08:00:00.000+03:00';
const T1 = '2026-09-30T08:10:00.000+03:00';
const T2 = '2026-09-30T08:20:00.000+03:00';
const OLD_BODY = '@[Sara Team](usr_003) the east wall needs a new footing\nCan you approve?';

function message(id: string, conversationId: string, over: Partial<Message>): Message {
  return { id, conversationId, authorId: 'usr_002', actingForId: 'usr_002', body: 'Hello', mentions: [], createdAt: T1, editedAt: null, ...over };
}

function comment(id: string, over: Partial<Comment>): Comment {
  return { id, targetType: 'task', targetId: 'tsk_001', authorId: 'usr_002', body: 'Hello', reactions: emptyReactions(), createdAt: T1, editedAt: null, ...over };
}

function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.tasks.tsk_001 = makeTask();
  state.counters.tsk = 1;
  const projectChat = addProjectConversation(state, 'prj_001', STAMP).id;
  const direct = addDirectConversation(state, 'usr_002', 'usr_003', STAMP).id;
  const group = addGroupConversation(state, 'Private pair', 'usr_004', ['usr_004', 'usr_002'], STAMP).id;
  state.messages[OLD] = message(OLD, projectChat, { body: OLD_BODY, mentions: ['usr_003'] });
  state.messages[REPLY] = message(REPLY, projectChat, { authorId: 'usr_003', actingForId: 'usr_003', body: 'Approved.', mentions: ['usr_002'], replyToId: OLD, createdAt: T2 });
  state.messages[GROUP_SECRET] = message(GROUP_SECRET, group, { authorId: 'usr_004', actingForId: 'usr_004', body: 'Secret 7731 stays in the group.' });
  // A reply that points into another chat: stored data that the chat rules keep out, planted to prove the view leaks nothing.
  state.messages[FOREIGN_REPLY] = message(FOREIGN_REPLY, projectChat, { authorId: 'usr_003', actingForId: 'usr_003', body: 'Odd link.', replyToId: GROUP_SECRET, createdAt: T2 });
  state.comments[SARA_COMMENT] = comment(SARA_COMMENT, { authorId: 'usr_003', body: 'First fix is done.\nSecond line.' });
  state.comments[FAISAL_REPLY] = comment(FAISAL_REPLY, { authorId: 'usr_002', body: 'Thanks, checked.', replyToId: SARA_COMMENT, createdAt: T2 });
  state.counters.msg = 4;
  state.counters.cmt = 2;
  return { t, state, projectChat, direct, group };
}

describe('the views of a message', () => {
  it('gives the reply link and the names-you mark of each message, for its reader only', async () => {
    const { t, projectChat } = world();
    t.as('usr_003');
    const page = await t.api.call('chats.messages', { conversationId: projectChat });
    const reply = page.messages.find((v) => v.message.id === REPLY)!;
    expect(reply.replyTo).toMatchObject({ id: OLD, firstLine: '@Sara Team the east wall needs a new footing', deleted: false });
    expect(reply.replyTo?.author).toMatchObject({ id: 'usr_002' });
    expect(page.messages.find((v) => v.message.id === OLD)!.namesMe).toBe(true);
    expect(page.messages.find((v) => v.message.id === OLD)!.replyTo).toBeNull();
    // Sara wrote the reply herself: it names Faisal, not Sara.
    expect(reply.namesMe).toBe(false);
    t.as('usr_002');
    const forFaisal = await t.api.call('chats.messages', { conversationId: projectChat });
    expect(forFaisal.messages.find((v) => v.message.id === OLD)!.namesMe).toBe(false);
    expect(forFaisal.messages.find((v) => v.message.id === REPLY)!.namesMe).toBe(true);
  });

  it('shows a deleted old message as deleted, with no text', async () => {
    const { t, state, projectChat } = world();
    state.messages[OLD].deletedAt = T2;
    t.as('usr_003');
    const page = await t.api.call('chats.messages', { conversationId: projectChat });
    expect(page.messages.some((v) => v.message.id === OLD)).toBe(false);
    const reply = page.messages.find((v) => v.message.id === REPLY)!;
    expect(reply.replyTo).toMatchObject({ id: OLD, firstLine: '', deleted: true });
    expect(JSON.stringify(page)).not.toContain('east wall');
  });

  it('gives no text of a message in another chat through a reply link', async () => {
    const { t, projectChat } = world();
    t.as('usr_003');
    const page = await t.api.call('chats.messages', { conversationId: projectChat });
    const odd = page.messages.find((v) => v.message.id === FOREIGN_REPLY)!;
    expect(odd.replyTo).toMatchObject({ id: GROUP_SECRET, firstLine: '', deleted: true });
    expect(JSON.stringify(page)).not.toContain('Secret 7731');
  });

  it('gives the read time before the mark, and the level of the reader', async () => {
    const { t, state, projectChat, direct } = world();
    state.chatReads[chatReadKey(projectChat, 'usr_003')] = { conversationId: projectChat, userId: 'usr_003', lastReadAt: EARLIER };
    t.as('usr_003');
    expect(await t.api.call('chats.messages', { conversationId: projectChat })).toMatchObject({ readUpTo: EARLIER, notify: 'named' });
    expect((await t.api.call('chats.messages', { conversationId: direct })).readUpTo).toBeNull();
    expect((await t.api.call('chats.messages', { conversationId: direct })).notify).toBe('all');
    // A read of the chat marks it read, but the read time of that answer is the one before. The next read gives the new time.
    await t.api.call('chats.markRead', { conversationId: projectChat });
    expect((await t.api.call('chats.messages', { conversationId: projectChat })).readUpTo).toBe(STAMP);
  });

  it('gives the stored Notify me level of the reader, and the start level to another reader', async () => {
    const { t, state, projectChat } = world();
    state.chatReads[chatReadKey(projectChat, 'usr_003')] = { conversationId: projectChat, userId: 'usr_003', lastReadAt: EARLIER, notify: 'all' };
    t.as('usr_003');
    expect((await t.api.call('chats.messages', { conversationId: projectChat })).notify).toBe('all');
    t.as('usr_002');
    expect((await t.api.call('chats.messages', { conversationId: projectChat })).notify).toBe('named');
  });
});

describe('the views of a task comment', () => {
  it('gives the reply link and the names-you mark of each task comment', async () => {
    const { t } = world();
    t.as('usr_003');
    const forSara = await t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_001' });
    const reply = forSara.find((v) => v.comment.id === FAISAL_REPLY)!;
    expect(reply.replyTo).toMatchObject({ id: SARA_COMMENT, firstLine: 'First fix is done.', deleted: false });
    expect(reply.namesMe).toBe(true);
    expect(forSara.find((v) => v.comment.id === SARA_COMMENT)).toMatchObject({ replyTo: null, namesMe: false });
    t.as('usr_002');
    const forFaisal = await t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_001' });
    expect(forFaisal.find((v) => v.comment.id === FAISAL_REPLY)).toMatchObject({ namesMe: false });
  });

  it('shows a comment reply whose old comment is gone as deleted, with no text', async () => {
    const { t, state } = world();
    delete state.comments[SARA_COMMENT];
    t.as('usr_003');
    const forSara = await t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_001' });
    expect(forSara.find((v) => v.comment.id === FAISAL_REPLY)!.replyTo).toMatchObject({ id: SARA_COMMENT, firstLine: '', deleted: true });
    expect(forSara.find((v) => v.comment.id === FAISAL_REPLY)!.namesMe).toBe(false);
  });

  it('gives the same fields in the answer of a reaction', async () => {
    const { t } = world();
    t.as('usr_003');
    const view = await t.api.call('reactions.toggle', { commentId: FAISAL_REPLY, emoji: '👍' });
    expect(view.replyTo).toMatchObject({ id: SARA_COMMENT, deleted: false });
    expect(view.namesMe).toBe(true);
  });
});
