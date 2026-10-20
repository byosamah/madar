import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from './calls';
import { addDirectConversation, addGroupConversation, addProjectConversation } from './chatState';
import { isLiveMessage, namesPerson, notifyLevelOf, replyRefOf } from './chatNaming';
import type { Comment, Conversation, Message } from './contract/entities';
import { emptyReactions } from './contract/entities';
import { chatReadKey } from './rowKeys';
import type { State } from './store';
import { cardOf } from './views';
import { firstLineOf } from '../lib/text';
import { NOW, STAMP, makeTask, makeWorld, testApi } from '../test/factories';
import { setNow } from '../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The world of makeWorld(): usr_002 Faisal leads prj_001, usr_003 Sara is on its team, usr_004 Omar is outside, usr_005 is the agent
 * of Sara. A project chat of prj_001, a direct chat of Faisal and Sara, and a group of Omar alone with Faisal (Sara is not in it).
 */
const OLD = 'msg_001';
const GROUP_SECRET_ID = 'msg_050';
const SARA_COMMENT = 'cmt_001';
const OLD_BODY = '@[Sara Team](usr_003) the east wall needs a new footing\nCan you approve?';

let seq: number;
let state: State;
let projectChat: Conversation;
let directChat: Conversation;
let group: Conversation;

function msg(over: Partial<Message> = {}): Message {
  seq += 1;
  return {
    id: `msg_${String(100 + seq)}`, conversationId: projectChat.id, authorId: 'usr_002', actingForId: 'usr_002', body: 'Hello', mentions: [],
    createdAt: STAMP, editedAt: null, ...over,
  };
}

function comment(over: Partial<Comment> = {}): Comment {
  seq += 1;
  return {
    id: `cmt_${String(100 + seq)}`, targetType: 'task', targetId: 'tsk_001', authorId: 'usr_002', body: 'Hello', reactions: emptyReactions(),
    createdAt: STAMP, editedAt: null, ...over,
  };
}

beforeEach(() => {
  seq = 0;
  state = makeWorld();
  state.tasks.tsk_001 = makeTask();
  state.tasks.tsk_002 = makeTask({ id: 'tsk_002', title: 'Roof plan' });
  projectChat = addProjectConversation(state, 'prj_001', STAMP);
  directChat = addDirectConversation(state, 'usr_002', 'usr_003', STAMP);
  group = addGroupConversation(state, 'Private pair', 'usr_004', ['usr_004', 'usr_002'], STAMP);
  state.messages[OLD] = { ...msg({ id: OLD, body: OLD_BODY, mentions: ['usr_003'] }) };
  state.messages[GROUP_SECRET_ID] = msg({ id: GROUP_SECRET_ID, conversationId: group.id, authorId: 'usr_004', actingForId: 'usr_004', body: 'Secret 7731 stays here' });
  state.comments[SARA_COMMENT] = comment({ id: SARA_COMMENT, authorId: 'usr_003', body: 'First fix is done.' });
  state.comments.cmt_002 = comment({ id: 'cmt_002', targetId: 'tsk_002', authorId: 'usr_003', body: 'Other task words 5512' });
  state.comments.cmt_003 = comment({ id: 'cmt_003', authorId: 'usr_005', body: 'The agent of Sara says hello.' });
});

describe('isLiveMessage', () => {
  it('reads a deleted message as not live', () => {
    expect(isLiveMessage(msg({}))).toBe(true);
    expect(isLiveMessage(msg({ deletedAt: STAMP }))).toBe(false);
  });
});

describe('namesPerson', () => {
  it('names a person by a mention or a reply, and never the author', () => {
    expect(namesPerson(state, msg({ mentions: ['usr_003'] }), 'usr_003')).toBe(true);
    expect(namesPerson(state, msg({ mentions: ['usr_004'] }), 'usr_003')).toBe(false);
    expect(namesPerson(state, msg({ actingForId: 'usr_003', mentions: ['usr_003'] }), 'usr_003')).toBe(false);
    expect(namesPerson(state, comment({ body: '@[Sara Team](usr_003) look' }), 'usr_003')).toBe(true);
    expect(namesPerson(state, comment({ authorId: 'usr_002', replyToId: SARA_COMMENT }), 'usr_003')).toBe(true);
    expect(namesPerson(state, comment({ authorId: 'usr_003', replyToId: SARA_COMMENT }), 'usr_003')).toBe(false);
    expect(namesPerson(state, comment({ authorId: 'usr_002', replyToId: 'cmt_999' }), 'usr_003')).toBe(false);
  });

  it('counts the person behind an agent as the author of an agent comment, and as the owner of an agent comment that is answered', () => {
    // The agent of Sara writes a comment that names Sara: it is Sara own words, so it names nobody.
    expect(namesPerson(state, comment({ authorId: 'usr_005', body: '@[Sara Team](usr_003) hi' }), 'usr_003')).toBe(false);
    // Faisal answers a comment of the agent of Sara: the comment belongs to Sara, so the reply names Sara.
    expect(namesPerson(state, comment({ authorId: 'usr_002', replyToId: 'cmt_003' }), 'usr_003')).toBe(true);
  });
});

describe('notifyLevelOf', () => {
  it('gives the Notify me level of a person and a chat', () => {
    expect(notifyLevelOf(state, projectChat, 'usr_003')).toBe('named');
    expect(notifyLevelOf(state, directChat, 'usr_003')).toBe('all');
    expect(notifyLevelOf(state, group, 'usr_002')).toBe('all');
    state.chatReads[chatReadKey(projectChat.id, 'usr_003')] = { conversationId: projectChat.id, userId: 'usr_003', lastReadAt: STAMP, notify: 'all' };
    expect(notifyLevelOf(state, projectChat, 'usr_003')).toBe('all');
    // The choice belongs to the person: another person keeps the start value.
    expect(notifyLevelOf(state, projectChat, 'usr_002')).toBe('named');
  });

  it('reads a stored level on a direct chat', () => {
    state.chatReads[chatReadKey(directChat.id, 'usr_003')] = { conversationId: directChat.id, userId: 'usr_003', lastReadAt: STAMP, notify: 'named' };
    expect(notifyLevelOf(state, directChat, 'usr_003')).toBe('named');
    expect(notifyLevelOf(state, directChat, 'usr_002')).toBe('all');
  });
});

describe('replyRefOf', () => {
  it('gives the reply link of a message, and no text of a deleted or foreign message', () => {
    expect(replyRefOf(state, msg({}), 'usr_003')).toBeNull();
    expect(replyRefOf(state, msg({ replyToId: OLD }), 'usr_003')).toEqual({
      id: OLD, author: cardOf(state, 'usr_002'), firstLine: '@Sara Team the east wall needs a new footing', deleted: false,
    });
    state.messages[OLD].deletedAt = STAMP;
    expect(replyRefOf(state, msg({ replyToId: OLD }), 'usr_003')).toMatchObject({ id: OLD, firstLine: '', deleted: true });
    const foreign = replyRefOf(state, msg({ replyToId: GROUP_SECRET_ID }), 'usr_003');
    expect(foreign).toMatchObject({ deleted: true, firstLine: '' });
    expect(JSON.stringify(foreign)).not.toContain('Secret 7731');
  });

  it('gives the same answer for a missing message and for a message of another chat', () => {
    const missing = replyRefOf(state, msg({ replyToId: 'msg_999' }), 'usr_003');
    const foreign = replyRefOf(state, msg({ replyToId: GROUP_SECRET_ID }), 'usr_003');
    expect(missing).toMatchObject({ id: 'msg_999', deleted: true, firstLine: '' });
    expect(foreign).toMatchObject({ id: GROUP_SECRET_ID, deleted: true, firstLine: '' });
    // The author of a deleted link is the author of the reply, never a person of the other place.
    expect(missing?.author).toEqual(cardOf(state, 'usr_002'));
    expect(foreign?.author).toEqual(cardOf(state, 'usr_002'));
  });

  it('names the person behind an agent as the author of the old message', () => {
    state.messages.msg_060 = msg({ id: 'msg_060', authorId: 'usr_005', actingForId: 'usr_003', body: 'Written by the agent of Sara' });
    expect(replyRefOf(state, msg({ replyToId: 'msg_060' }), 'usr_002')?.author).toEqual(cardOf(state, 'usr_003'));
  });

  it('gives the reply link of a comment of the same task only', () => {
    expect(replyRefOf(state, comment({}), 'usr_002')).toBeNull();
    expect(replyRefOf(state, comment({ replyToId: SARA_COMMENT }), 'usr_002')).toEqual({
      id: SARA_COMMENT, author: cardOf(state, 'usr_003'), firstLine: 'First fix is done.', deleted: false,
    });
    const other = replyRefOf(state, comment({ replyToId: 'cmt_002' }), 'usr_002');
    expect(other).toMatchObject({ id: 'cmt_002', firstLine: '', deleted: true });
    expect(JSON.stringify(other)).not.toContain('5512');
    expect(replyRefOf(state, comment({ replyToId: 'cmt_999' }), 'usr_002')).toMatchObject({ deleted: true, firstLine: '' });
  });

  it('names the person behind an agent as the author of the old comment', () => {
    expect(replyRefOf(state, comment({ replyToId: 'cmt_003' }), 'usr_002')?.author).toEqual(cardOf(state, 'usr_003'));
  });
});

describe('firstLineOf', () => {
  it('cuts the first line of a body', () => {
    expect(firstLineOf('@[Sara Team](usr_003) the east wall\nsecond line')).toBe('@Sara Team the east wall');
    expect(firstLineOf('a '.repeat(300)).length).toBeLessThanOrEqual(200);
    expect(firstLineOf('👍'.repeat(150)).length).toBeLessThanOrEqual(200);
    expect(Array.from(firstLineOf('👍'.repeat(150))).length).toBeLessThanOrEqual(100);
  });

  it('puts runs of white space in one space and keeps a short line whole', () => {
    expect(firstLineOf('Check   the\tfooting')).toBe('Check the footing');
    expect(firstLineOf('One line')).toBe('One line');
  });

  it('adds the mark of a cut', () => {
    expect(firstLineOf('word '.repeat(60))).toMatch(/…$/);
  });
});

describe('chats.archive keeps the Notify me choice', () => {
  it('keeps the Notify me choice when a person archives a chat', async () => {
    const t = testApi(calls, state);
    state.chatReads[chatReadKey(directChat.id, 'usr_003')] = { conversationId: directChat.id, userId: 'usr_003', lastReadAt: STAMP, notify: 'named' };
    t.as('usr_003');
    await t.api.call('chats.archive', { conversationId: directChat.id, archived: true });
    expect(t.store.state.chatReads[chatReadKey(directChat.id, 'usr_003')].notify).toBe('named');
    expect(t.store.state.chatReads[chatReadKey(directChat.id, 'usr_003')].archivedAt).not.toBeNull();
    await t.api.call('chats.archive', { conversationId: directChat.id, archived: false });
    expect(t.store.state.chatReads[chatReadKey(directChat.id, 'usr_003')]).toMatchObject({ notify: 'named', archivedAt: null });
  });
});
