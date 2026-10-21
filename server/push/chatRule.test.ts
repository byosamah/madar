import { describe, expect, it } from 'vitest';
import { chatReadKey } from '../../src/api/rowKeys';
import { isChatItemNotice, planPushes, type CommentFact, type MessageFact, type PushFacts, type PushPerson } from './chatRule';

/**
 * The pure push rule of a chat message and a task comment (chat design items 19, 20, 21 and 23). People: usr_001 is an Admin, usr_002
 * to usr_004 are people, usr_005 is the agent of usr_003, usr_006 has no device and usr_007 is not active.
 */
const person = (id: string, over: Partial<PushPerson> = {}): PushPerson => ({ id, kind: 'human', active: true, admin: false, ownerId: null, device: true, ...over });
const PEOPLE: PushPerson[] = [
  person('usr_001', { admin: true }), person('usr_002'), person('usr_003'), person('usr_004'),
  person('usr_005', { kind: 'agent', ownerId: 'usr_003' }), person('usr_006', { device: false }), person('usr_007', { active: false }),
];

const msg = (over: Partial<MessageFact> = {}): MessageFact => ({
  kind: 'message', id: 'msg_1', chatId: 'cnv_d', chatKind: 'direct', memberIds: ['usr_002', 'usr_003'], teamIds: [], authorId: 'usr_002', actingForId: 'usr_002',
  mentions: [], isNew: true, ...over,
});
const cmt = (over: Partial<CommentFact> = {}): CommentFact => ({
  kind: 'comment', id: 'cmt_1', taskId: 'tsk_1', office: false, leadId: 'usr_003', makerId: 'usr_001', helperIds: [], authorId: 'usr_002', body: 'Done.',
  replyAuthorId: null, line: false, isNew: true, ...over,
});
const facts = (over: Partial<PushFacts> = {}): PushFacts => ({ people: PEOPLE, items: [], levels: {}, notices: [], undo: false, ...over });
const one = (chatId: string, itemId: string) => [{ chatId, itemId }];

describe('planPushes: who gets the push of a chat message or a task comment', () => {
  it('pushes a direct or group message to the other members after the wait, never to its author', () => {
    expect(planPushes(facts({ items: [msg()] }))).toEqual({ now: [], waited: [{ userId: 'usr_003', items: one('cnv_d', 'msg_1') }] });
  });

  it('skips a member who picked Only when I am named, unless the message names them', () => {
    const levels = { [chatReadKey('cnv_d', 'usr_003')]: 'named' as const };
    expect(planPushes(facts({ items: [msg()], levels })).waited).toEqual([]);
    expect(planPushes(facts({ items: [msg({ mentions: ['usr_003'] })], levels })).waited).toHaveLength(1);
  });

  it('pushes a project message only to the people it names: the team, the leader and the Admins start at named', () => {
    const project = msg({ chatId: 'cnv_p', chatKind: 'project', memberIds: [], teamIds: ['usr_002', 'usr_003', 'usr_004'], mentions: ['usr_004', 'usr_001'] });
    expect(planPushes(facts({ items: [project] })).waited.map((w) => w.userId)).toEqual(['usr_001', 'usr_004']);
  });

  it('pushes every project message to a person who picked All messages, an Admin outside the team too (item 23)', () => {
    const project = msg({ chatId: 'cnv_p', chatKind: 'project', memberIds: [], teamIds: ['usr_002', 'usr_003'], mentions: [] });
    const levels = { [chatReadKey('cnv_p', 'usr_003')]: 'all' as const, [chatReadKey('cnv_p', 'usr_001')]: 'all' as const };
    expect(planPushes(facts({ items: [project], levels })).waited.map((w) => w.userId)).toEqual(['usr_001', 'usr_003']);
  });

  it('pushes a project chat to a person outside the team (the holder of chat.project.all) only when the message names the person', () => {
    // usr_004 is no Admin and no member of the team: a holder of chat.project.all opens the chat but is no candidate of a plain push.
    const plain = msg({ chatId: 'cnv_p', chatKind: 'project', memberIds: [], teamIds: ['usr_002', 'usr_003'], mentions: [] });
    const levels = { [chatReadKey('cnv_p', 'usr_004')]: 'all' as const };
    expect(planPushes(facts({ items: [plain], levels })).waited).toEqual([]);
    const named = msg({ chatId: 'cnv_p', chatKind: 'project', memberIds: [], teamIds: ['usr_002', 'usr_003'], mentions: ['usr_004'] });
    const notices = [{ userId: 'usr_004', targetType: 'chat', targetId: 'cnv_p', messageId: 'msg_1' }];
    expect(planPushes(facts({ items: [named], notices })).waited).toEqual([{ userId: 'usr_004', items: one('cnv_p', 'msg_1') }]);
  });

  it('never pushes the author, the person an agent wrote for, a person with no device or a person who left', () => {
    const group = msg({ chatKind: 'group', memberIds: ['usr_003', 'usr_005', 'usr_006', 'usr_007', 'usr_002'], authorId: 'usr_005', actingForId: 'usr_003' });
    expect(planPushes(facts({ items: [group] })).waited.map((w) => w.userId)).toEqual(['usr_002']);
  });

  it('pushes the task lead, and the maker of an office task, for a comment of another person (item 19, T)', () => {
    expect(planPushes(facts({ items: [cmt()] })).waited).toEqual([{ userId: 'usr_003', items: one('tsk_1', 'cmt_1') }]);
    expect(planPushes(facts({ items: [cmt({ office: true })] })).waited.map((w) => w.userId)).toEqual(['usr_001', 'usr_003']);
    expect(planPushes(facts({ items: [cmt({ authorId: 'usr_003' })] })).waited).toEqual([]);
  });

  it('pushes a person named in a comment, or the author of the comment it replies to, and nobody else', () => {
    // No lead, so only the names count. The old comment is by usr_005, the agent of usr_003: its person gets the push.
    const named = cmt({ leadId: null, body: '@[Omar](usr_004) see', replyAuthorId: 'usr_005' });
    expect(planPushes(facts({ items: [named] })).waited.map((w) => w.userId)).toEqual(['usr_003', 'usr_004']);
    expect(planPushes(facts({ items: [cmt({ leadId: null })] })).waited).toEqual([]);
  });

  it('pushes no named person who may not see an office task', () => {
    expect(planPushes(facts({ items: [cmt({ office: true, body: '@[Omar](usr_004) see' })] })).waited.map((w) => w.userId)).toEqual(['usr_001', 'usr_003']);
  });

  it('pushes nobody for a quiet line, or for a comment that an Undo brings back', () => {
    expect(planPushes(facts({ items: [cmt({ line: true })] })).waited).toEqual([]);
    expect(planPushes(facts({ items: [cmt()], undo: true })).waited).toEqual([]);
  });

  it('pushes a plain notice at once, and gives that person no waited push from the same save', () => {
    const notices = [{ userId: 'usr_003', targetType: 'task', targetId: 'tsk_1', messageId: null }];
    expect(planPushes(facts({ items: [cmt()], notices }))).toEqual({ now: ['usr_003'], waited: [] });
  });

  it('joins the mention notice of a new message to the push of that message: one push for one message', () => {
    const notices = [{ userId: 'usr_003', targetType: 'chat', targetId: 'cnv_d', messageId: 'msg_1' }];
    expect(planPushes(facts({ items: [msg({ mentions: ['usr_003'] })], notices }))).toEqual({ now: [], waited: [{ userId: 'usr_003', items: one('cnv_d', 'msg_1') }] });
  });

  it('pushes an edit notice only to a person whom the chat does not push for every message', () => {
    const old = msg({ isNew: false, mentions: ['usr_003'] });
    const notices = [{ userId: 'usr_003', targetType: 'chat', targetId: 'cnv_d', messageId: 'msg_1' }];
    expect(planPushes(facts({ items: [old], notices })).waited).toEqual([]);
    const levels = { [chatReadKey('cnv_d', 'usr_003')]: 'named' as const };
    expect(planPushes(facts({ items: [old], notices, levels })).waited).toHaveLength(1);
  });

  it('pushes a named person whose mention switch is off: the push reads the names, not the notices', () => {
    const project = msg({ chatId: 'cnv_p', chatKind: 'project', memberIds: [], teamIds: ['usr_002', 'usr_003'], mentions: ['usr_003'] });
    expect(planPushes(facts({ items: [project], notices: [] })).waited.map((w) => w.userId)).toEqual(['usr_003']);
  });

  it('tells a notice that points to a chat message or a task comment', () => {
    expect(isChatItemNotice({ targetType: 'chat', messageId: 'msg_1' })).toBe(true);
    expect(isChatItemNotice({ targetType: 'task', messageId: 'cmt_1' })).toBe(true);
    expect(isChatItemNotice({ targetType: 'update', messageId: 'cmt_2' })).toBe(false);
    expect(isChatItemNotice({ targetType: 'chat', messageId: null })).toBe(false);
  });
});
