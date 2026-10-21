import { describe, expect, it } from 'vitest';
import { ChatRead, Comment, Message, NOTIFY_LEVELS, Notification, NotifyLevel, emptyReactions } from './entities';
import { NOTIFY_LEVELS as PLAIN_NOTIFY_LEVELS } from './limits';
import { ChatThread, CommentView, MessageView, ReplyRef } from './views';

const STAMP = '2026-10-19T09:00:00.000+03:00';
const CARD = { id: 'usr_002', name: 'Faisal Leader', avatarUrl: null, kind: 'human' as const, discipline: 'Architect' };

// The records as they are stored today, before the fields of reply, reactions, delete and Notify me.
const OLD_MESSAGE = {
  id: 'msg_001', conversationId: 'cnv_001', authorId: 'usr_002', actingForId: 'usr_002', body: 'The east wall needs a new footing.',
  mentions: [], createdAt: STAMP, editedAt: null,
};
const OLD_COMMENT = {
  id: 'cmt_001', targetType: 'task' as const, targetId: 'tsk_001', authorId: 'usr_003', body: 'Done.', reactions: emptyReactions(),
  createdAt: STAMP, editedAt: null,
};
const OLD_READ = { conversationId: 'cnv_001', userId: 'usr_003', lastReadAt: STAMP };
const OLD_NOTICE = {
  id: 'ntf_001', userId: 'usr_003', trigger: 'mention' as const, actorId: 'usr_002', targetType: 'chat' as const, targetId: 'cnv_001', read: false,
  createdAt: STAMP, dedupeKey: null,
};

const OLD_MESSAGE_VIEW = { message: OLD_MESSAGE, author: CARD, actingFor: null, mine: false, files: [] };
const OLD_COMMENT_VIEW = { comment: OLD_COMMENT, author: CARD, canEdit: false, files: [] };
const OLD_THREAD = {
  chat: {
    kind: 'direct' as const, id: 'cnv_001', title: 'Faisal', project: null, person: CARD, taskId: null, makerId: null, members: [],
    preview: 'Hello', previewAuthor: CARD, previewMine: false, lastAt: STAMP, unread: 0, personLeft: false, archived: false,
  },
  people: [CARD],
  messages: [OLD_MESSAGE_VIEW],
};

describe('chat fields of reply, reactions, delete and Notify me (base B1)', () => {
  it('loads a message, a comment, a read mark and a notice saved before the new fields', () => {
    expect(Message.parse(OLD_MESSAGE)).toEqual(OLD_MESSAGE);
    expect(Comment.parse(OLD_COMMENT)).toEqual(OLD_COMMENT);
    expect(ChatRead.parse(OLD_READ)).toEqual(OLD_READ);
    expect(Notification.parse(OLD_NOTICE)).toEqual(OLD_NOTICE);
  });

  it('takes the new fields and refuses wrong values', () => {
    const msg = Message.parse({ ...OLD_MESSAGE, replyToId: 'msg_002', reactions: { '👍': ['usr_003'], '✅': [], '👀': [] }, deletedAt: STAMP });
    expect(msg).toMatchObject({ replyToId: 'msg_002', deletedAt: STAMP });
    expect(Comment.parse({ ...OLD_COMMENT, replyToId: 'cmt_002' }).replyToId).toBe('cmt_002');
    expect(ChatRead.parse({ ...OLD_READ, notify: 'named' }).notify).toBe('named');
    expect(() => ChatRead.parse({ ...OLD_READ, notify: 'none' })).toThrow();
    expect(Notification.parse({ ...OLD_NOTICE, messageId: 'msg_002', reply: true })).toMatchObject({ messageId: 'msg_002', reply: true });
    expect(() => Notification.parse({ ...OLD_NOTICE, reply: false })).toThrow();
    expect(NOTIFY_LEVELS).toEqual(['all', 'named']);
  });

  it('keeps the levels as a plain value that the Inbox chunk reads with no zod', () => {
    expect(PLAIN_NOTIFY_LEVELS).toBe(NOTIFY_LEVELS);
    expect(NotifyLevel.parse('named')).toBe('named');
    expect(NotifyLevel.safeParse('none').success).toBe(false);
  });

  it('takes a message reaction record with a key missing, refuses a key that is not one emoji, and refuses a bad reply or message id', () => {
    expect(Message.safeParse({ ...OLD_MESSAGE, reactions: { '👍': [] } }).success).toBe(true);
    expect(Message.safeParse({ ...OLD_MESSAGE, reactions: { ok: [] } }).success).toBe(false);
    expect(Message.safeParse({ ...OLD_MESSAGE, replyToId: 'cmt_001' }).success).toBe(false);
    expect(Comment.safeParse({ ...OLD_COMMENT, replyToId: 'msg_001' }).success).toBe(false);
    expect(Notification.safeParse({ ...OLD_NOTICE, messageId: '' }).success).toBe(false);
  });

  it('parses an older answer with the defaults', () => {
    expect(MessageView.parse(OLD_MESSAGE_VIEW)).toMatchObject({ replyTo: null, namesMe: false });
    expect(CommentView.parse(OLD_COMMENT_VIEW)).toMatchObject({ replyTo: null, namesMe: false });
    expect(ChatThread.parse(OLD_THREAD)).toMatchObject({ readUpTo: null, notify: 'all' });
  });

  it('takes a reply link and the thread fields', () => {
    const replyTo = { id: 'msg_001', author: CARD, firstLine: 'The east wall', deleted: false };
    expect(MessageView.parse({ ...OLD_MESSAGE_VIEW, replyTo, namesMe: true })).toMatchObject({ replyTo, namesMe: true });
    expect(CommentView.parse({ ...OLD_COMMENT_VIEW, replyTo, namesMe: true })).toMatchObject({ replyTo, namesMe: true });
    expect(ChatThread.parse({ ...OLD_THREAD, readUpTo: STAMP, notify: 'named' })).toMatchObject({ readUpTo: STAMP, notify: 'named' });
    expect(ChatThread.safeParse({ ...OLD_THREAD, notify: 'none' }).success).toBe(false);
  });

  it('refuses a reply first line over 200 characters', () => {
    expect(() => ReplyRef.parse({ id: 'msg_001', author: CARD, firstLine: 'x'.repeat(201), deleted: false })).toThrow();
    expect(ReplyRef.parse({ id: 'msg_001', author: CARD, firstLine: 'x'.repeat(200), deleted: false }).firstLine).toHaveLength(200);
  });
});
