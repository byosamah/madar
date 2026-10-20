import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { addDirectConversation, addGroupConversation, addProjectConversation } from '../chatState';
import { emptyReactions, type Comment, type Message, type Notification } from '../contract/entities';
import { NOW, STAMP, makeTask, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * A reply on the server (base B6) keeps a link to the old message and names its author. Faisal (usr_002) leads prj_001, Sara (usr_003)
 * is on its team, Omar (usr_004) is outside, usr_005 is the agent of Sara. A direct chat of Faisal and Sara holds the old message. A
 * group of Omar and Faisal holds a secret that no reply may reach.
 */
const OLD_BY_FAISAL = 'msg_001';
const OLD_BY_SARA = 'msg_002';
const AGENT_MESSAGE = 'msg_003';
const GROUP_SECRET_ID = 'msg_004';
const SARA_COMMENT = 'cmt_001';
const OTHER_TASK_COMMENT = 'cmt_002';
const POST_COMMENT = 'cmt_003';
const DATE_LINE = 'cmt_004';
const T1 = '2026-09-30T08:10:00.000+03:00';

function message(id: string, conversationId: string, over: Partial<Message>): Message {
  return { id, conversationId, authorId: 'usr_002', actingForId: 'usr_002', body: 'Hello', mentions: [], createdAt: T1, editedAt: null, ...over };
}

function comment(id: string, over: Partial<Comment>): Comment {
  return { id, targetType: 'task', targetId: 'tsk_001', authorId: 'usr_003', body: 'Hello', reactions: emptyReactions(), createdAt: T1, editedAt: null, ...over };
}

function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.tasks.tsk_001 = makeTask();
  state.tasks.tsk_002 = makeTask({ id: 'tsk_002', title: 'Roof plan' });
  state.updates.upd_001 = { id: 'upd_001', projectId: 'prj_001', authorId: 'usr_002', body: 'A post', fileIds: [], createdAt: T1, editedAt: null };
  state.counters.tsk = 2;
  state.counters.upd = 1;
  const direct = addDirectConversation(state, 'usr_002', 'usr_003', STAMP).id;
  const projectChat = addProjectConversation(state, 'prj_001', STAMP).id;
  const group = addGroupConversation(state, 'Private pair', 'usr_004', ['usr_004', 'usr_002'], STAMP).id;
  state.messages[OLD_BY_FAISAL] = message(OLD_BY_FAISAL, direct, { body: 'Can you approve the footing?' });
  state.messages[OLD_BY_SARA] = message(OLD_BY_SARA, direct, { authorId: 'usr_003', actingForId: 'usr_003', body: 'I own this one.' });
  state.messages[AGENT_MESSAGE] = message(AGENT_MESSAGE, direct, { authorId: 'usr_005', actingForId: 'usr_003', body: 'Sent by the agent of Sara.' });
  state.messages[GROUP_SECRET_ID] = message(GROUP_SECRET_ID, group, { authorId: 'usr_004', actingForId: 'usr_004', body: 'Secret 7731 stays in the group.' });
  state.counters.msg = 4;
  state.comments[SARA_COMMENT] = comment(SARA_COMMENT, { body: 'First fix is done.' });
  state.comments[OTHER_TASK_COMMENT] = comment(OTHER_TASK_COMMENT, { targetId: 'tsk_002', body: 'Other task words 5512' });
  state.comments[POST_COMMENT] = comment(POST_COMMENT, { targetType: 'update', targetId: 'upd_001', body: 'A comment on a post.' });
  state.comments[DATE_LINE] = comment(DATE_LINE, {
    body: 'The client moved the review.', dates: { from: { startDate: null, dueDate: '2026-10-10' }, to: { startDate: null, dueDate: '2026-10-12' } },
  });
  state.counters.cmt = 4;
  return { t, state, direct, projectChat, group };
}

const noticesOf = (state: { notifications: Record<string, Notification> }, userId: string) => Object.values(state.notifications).filter((n) => n.userId === userId);

/** The error of a call that fails. */
const failureOf = (promise: Promise<unknown>) => promise.then(() => null, (error: { code: string; message: string; details?: { reason?: string } }) => error);

describe('a reply to a chat message', () => {
  it('names the author of the old message, and gives that person one reply notice', async () => {
    const { t, direct } = world();
    t.as('usr_003');
    const sent = await t.api.call('chats.send', { conversationId: direct, body: 'Approved. Please book the lab.', replyToId: OLD_BY_FAISAL });
    expect(sent.message).toMatchObject({ replyToId: OLD_BY_FAISAL, mentions: ['usr_002'] });
    expect(sent.replyTo).toMatchObject({ id: OLD_BY_FAISAL, deleted: false });
    const notices = noticesOf(t.store.state, 'usr_002');
    expect(notices).toEqual([expect.objectContaining({ trigger: 'mention', targetType: 'chat', targetId: direct, messageId: sent.message.id, reply: true })]);
    // The sender gets nothing.
    expect(noticesOf(t.store.state, 'usr_003')).toEqual([]);
  });

  it('names nobody for a reply to an own message', async () => {
    const { t, direct } = world();
    t.as('usr_003');
    const sent = await t.api.call('chats.send', { conversationId: direct, body: 'One more thing.', replyToId: OLD_BY_SARA });
    expect(sent.message).toMatchObject({ replyToId: OLD_BY_SARA, mentions: [] });
    expect(Object.values(t.store.state.notifications)).toEqual([]);
  });

  it('names the person of an agent, never the agent and never the sender', async () => {
    const { t, direct } = world();
    // The agent of Sara answers Faisal: it names Faisal.
    t.as('usr_005');
    const fromAgent = await t.api.call('chats.send', { conversationId: direct, body: 'Checked.', replyToId: OLD_BY_FAISAL });
    expect(fromAgent.message).toMatchObject({ authorId: 'usr_005', actingForId: 'usr_003', mentions: ['usr_002'] });
    // Faisal answers the message of the agent: it names Sara, the person behind the agent.
    t.as('usr_002');
    const toAgent = await t.api.call('chats.send', { conversationId: direct, body: 'Thanks.', replyToId: AGENT_MESSAGE });
    expect(toAgent.message.mentions).toEqual(['usr_003']);
    expect(noticesOf(t.store.state, 'usr_005')).toEqual([]);
    // The agent of Sara answers a message of Sara: it names nobody.
    t.as('usr_005');
    const own = await t.api.call('chats.send', { conversationId: direct, body: 'Same person.', replyToId: OLD_BY_SARA });
    expect(own.message.mentions).toEqual([]);
  });

  it('gives one plain mention notice when the text names the author too', async () => {
    const { t, direct } = world();
    t.as('usr_003');
    const sent = await t.api.call('chats.send', { conversationId: direct, body: '@[Faisal Leader](usr_002) ok', replyToId: OLD_BY_FAISAL });
    expect(sent.message.mentions).toEqual(['usr_002']);
    const notices = noticesOf(t.store.state, 'usr_002');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ trigger: 'mention', messageId: sent.message.id });
    expect(notices[0]).not.toHaveProperty('reply');
  });

  it('gives a second person named in the text a plain notice, and the reply author a reply notice', async () => {
    const { t, projectChat, state } = world();
    state.messages.msg_005 = message('msg_005', projectChat, { body: 'Project question' });
    state.counters.msg = 5;
    t.as('usr_001');
    const sent = await t.api.call('chats.send', { conversationId: projectChat, body: '@[Sara Team](usr_003) please look.', replyToId: 'msg_005' });
    expect(sent.message.mentions.sort()).toEqual(['usr_002', 'usr_003']);
    expect(noticesOf(state, 'usr_003')[0]).not.toHaveProperty('reply');
    expect(noticesOf(state, 'usr_002')[0]).toMatchObject({ reply: true, messageId: sent.message.id });
  });

  it('does not name a reply author who cannot open the chat', async () => {
    const { t, state, projectChat } = world();
    // A message in the project chat by Omar, who is not on the team (stored data that the chat rules keep out, planted).
    state.messages.msg_006 = message('msg_006', projectChat, { authorId: 'usr_004', actingForId: 'usr_004', body: 'From outside' });
    state.counters.msg = 6;
    t.as('usr_003');
    const sent = await t.api.call('chats.send', { conversationId: projectChat, body: 'Noted.', replyToId: 'msg_006' });
    expect(sent.replyTo).toMatchObject({ id: 'msg_006', deleted: false });
    expect(sent.message.mentions).toEqual([]);
    expect(noticesOf(state, 'usr_004')).toEqual([]);
  });

  it('does not name a reply author who left the office', async () => {
    const { t, state, projectChat } = world();
    state.messages.msg_007 = message('msg_007', projectChat, { body: 'Question from a person who left' });
    state.counters.msg = 7;
    state.users.usr_002.active = false;
    t.as('usr_003');
    const sent = await t.api.call('chats.send', { conversationId: projectChat, body: 'Answered anyway.', replyToId: 'msg_007' });
    expect(sent.message.mentions).toEqual([]);
    expect(noticesOf(state, 'usr_002')).toEqual([]);
  });

  it('refuses a reply into another chat with the text of a missing message', async () => {
    const { t, direct } = world();
    t.as('usr_003');
    const elsewhere = await failureOf(t.api.call('chats.send', { conversationId: direct, body: 'x', replyToId: GROUP_SECRET_ID }));
    const missing = await failureOf(t.api.call('chats.send', { conversationId: direct, body: 'x', replyToId: 'msg_999' }));
    expect(elsewhere).toMatchObject({ code: 'invalid_input', details: { reason: 'reply_not_here' } });
    expect(missing).toMatchObject({ code: 'invalid_input', details: { reason: 'reply_not_here' } });
    expect(elsewhere?.message).toBe(missing?.message);
    expect(JSON.stringify(elsewhere)).not.toContain('Secret 7731');
    // Nothing was stored, and nobody got a notice.
    expect(Object.values(t.store.state.messages).filter((m) => m.replyToId !== undefined)).toEqual([]);
    expect(Object.values(t.store.state.notifications)).toEqual([]);
  });

  it('refuses a reply to a deleted message with the same refusal', async () => {
    const { t, state, direct } = world();
    state.messages[OLD_BY_FAISAL].deletedAt = T1;
    t.as('usr_003');
    const gone = await failureOf(t.api.call('chats.send', { conversationId: direct, body: 'x', replyToId: OLD_BY_FAISAL }));
    const missing = await failureOf(t.api.call('chats.send', { conversationId: direct, body: 'x', replyToId: 'msg_999' }));
    expect(gone).toMatchObject({ code: 'invalid_input', details: { reason: 'reply_not_here' } });
    expect(gone?.message).toBe(missing?.message);
  });

  it('answers a chat the person may not open as a chat that does not exist, before it looks at the reply', async () => {
    const { t, group, direct } = world();
    t.as('usr_003');
    const hidden = await failureOf(t.api.call('chats.send', { conversationId: group, body: 'x', replyToId: GROUP_SECRET_ID }));
    const never = await failureOf(t.api.call('chats.send', { conversationId: 'cnv_999', body: 'x', replyToId: GROUP_SECRET_ID }));
    expect(hidden).toMatchObject({ code: 'not_found' });
    expect(never).toMatchObject({ code: 'not_found' });
    expect(hidden?.message.replace(group, 'ID')).toBe(never?.message.replace('cnv_999', 'ID'));
    expect(JSON.stringify(hidden)).not.toContain('Secret 7731');
    expect(direct).toBeDefined();
  });

  it('keeps a message without a reply as before', async () => {
    const { t, direct } = world();
    t.as('usr_003');
    const sent = await t.api.call('chats.send', { conversationId: direct, body: 'Plain words.' });
    expect(sent.message).not.toHaveProperty('replyToId');
    expect(sent.replyTo).toBeNull();
  });
});

describe('a reply to a task comment', () => {
  it('answers a task comment and names its author', async () => {
    const { t, state } = world();
    t.as('usr_002');
    const view = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Done.', replyToId: SARA_COMMENT });
    expect(view.comment.replyToId).toBe(SARA_COMMENT);
    expect(view.replyTo).toMatchObject({ id: SARA_COMMENT, deleted: false });
    const notices = noticesOf(state, 'usr_003');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ trigger: 'mention', targetType: 'task', targetId: 'tsk_001', messageId: view.comment.id, reply: true });
  });

  it('names nobody for a reply to an own comment, and gives a plain notice when the text names the author', async () => {
    const { t, state } = world();
    t.as('usr_003');
    const own = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Also this.', replyToId: SARA_COMMENT });
    expect(own.replyTo).toMatchObject({ id: SARA_COMMENT });
    expect(Object.values(state.notifications)).toEqual([]);
    t.as('usr_002');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: '@[Sara Team](usr_003) thanks.', replyToId: SARA_COMMENT });
    const notices = noticesOf(state, 'usr_003');
    expect(notices).toHaveLength(1);
    expect(notices[0]).not.toHaveProperty('reply');
  });

  it('refuses a comment reply to another task, a post comment or a quiet line', async () => {
    const { t, state } = world();
    t.as('usr_002');
    for (const replyToId of [OTHER_TASK_COMMENT, POST_COMMENT, DATE_LINE, 'cmt_999']) {
      const failure = await failureOf(t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'x', replyToId }));
      expect(failure, replyToId).toMatchObject({ code: 'invalid_input', details: { reason: 'reply_not_here' } });
    }
    const same = await failureOf(t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'x', replyToId: OTHER_TASK_COMMENT }));
    const missing = await failureOf(t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'x', replyToId: 'cmt_999' }));
    expect(same?.message).toBe(missing?.message);
    expect(JSON.stringify(same)).not.toContain('5512');
    expect(Object.values(state.comments).filter((c) => c.replyToId !== undefined)).toEqual([]);
  });

  it('refuses a reply on a comment of a post, which has no reply in this batch', async () => {
    const { t } = world();
    t.as('usr_002');
    const failure = await failureOf(t.api.call('comments.create', { targetType: 'update', targetId: 'upd_001', body: 'x', replyToId: POST_COMMENT }));
    expect(failure).toMatchObject({ code: 'invalid_input', details: { reason: 'reply_not_here' } });
  });

  it('keeps a comment without a reply as before', async () => {
    const { t } = world();
    t.as('usr_002');
    const view = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Plain.' });
    expect(view.comment).not.toHaveProperty('replyToId');
    expect(view.replyTo).toBeNull();
  });
});
