import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyReactions, type ChatRead, type Comment, type Message } from '../contract/entities';
import type { ChatRow } from '../contract/views';
import { canSeeConversation } from '../chatState';
import { principalOf } from '../permissions';
import { chatReadKey, unreadCountKey, type State } from '../store';
import { buildSeed } from '../../data/seed';
import { setNow } from '../../lib/dates';
import { testApi } from '../../test/factories';
import { chatCalls } from './chats';

/**
 * Unread counts (plan 4.13, A9). A server loader puts the unread number of each chat and task thread in State.counts and leaves
 * the unread rows out, so a chat with a long history never loads it. The handlers read the count first and scan without it.
 */

const TODAY = '2026-10-04';
const NOW = new Date('2026-10-04T06:00:00Z');
let seed: State;

beforeAll(async () => {
  seed = await buildSeed(TODAY, async () => undefined);
});
beforeEach(() => setNow(NOW));

/** The sample office, with an unread message by an agent of usr_002 and a task thread with a mark and a comment by usr_006. */
function office(): State {
  const state = structuredClone(seed);
  const agent = Object.values(state.users).find((u) => u.kind === 'agent' && u.ownerId)!;
  const room = Object.values(state.conversations).find((c) => c.kind === 'project' && canSeeConversation(state, c, state.users[agent.ownerId!]))!;
  const add = (id: string, authorId: string, actingForId: string, at: string) => {
    state.messages[id] = { id, conversationId: room.id, authorId, actingForId, body: id, mentions: [], fileIds: [], createdAt: at, editedAt: null };
  };
  add('msg_901', agent.id, agent.ownerId!, '2026-10-03T08:00:00.000+03:00');
  add('msg_902', 'usr_001', 'usr_001', '2026-10-03T09:00:00.000+03:00');
  const thread = Object.values(state.tasks).find((t) => t.ownerId !== null && t.ownerId !== 'usr_006' && state.projects[t.projectId!].leaderId !== 'usr_006')!;
  const lead = thread.ownerId as string;
  const comment = (id: string, authorId: string, at: string) => {
    state.comments[id] = { id, targetType: 'task', targetId: thread.id, authorId, body: id, reactions: emptyReactions(), fileIds: [], createdAt: at, editedAt: null };
  };
  comment('cmt_901', lead, '2026-10-01T09:00:00.000+03:00');
  comment('cmt_902', 'usr_006', '2026-10-02T09:00:00.000+03:00');
  comment('cmt_903', lead, '2026-10-03T09:00:00.000+03:00');
  comment('cmt_904', lead, '2026-10-03T11:00:00.000+03:00');
  state.chatReads[chatReadKey(thread.id, 'usr_006')] = { conversationId: thread.id, userId: 'usr_006', lastReadAt: '2026-10-03T10:00:00.000+03:00' };
  return state;
}

/** The task thread that the person marked read. */
const threadOf = (state: State, userId: string) => Object.values(state.chatReads).find((read) => read.userId === userId && read.conversationId.startsWith('tsk_'))!.conversationId;
const humans = (state: State) => Object.values(state.users).filter((u) => u.kind === 'human' && u.active).map((u) => u.id);
const byStamp = <T extends { createdAt: string; id: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * What the loader gives one person, written from the rule and not from the handler: the unread number of every chat and task
 * thread in counts, the newest message of each chat, and the newest comment and newest own comment of each thread. Nothing else.
 */
function scoped(state: State, userId: string): State {
  const counts: Record<string, number> = {};
  const mark = (id: string) => state.chatReads[chatReadKey(id, userId)]?.lastReadAt ?? '';
  const messages: Record<string, Message> = {};
  for (const room of Object.values(state.conversations)) {
    const all = Object.values(state.messages).filter((m) => m.conversationId === room.id).sort(byStamp);
    counts[unreadCountKey(room.id, userId)] = all.filter((m) => m.createdAt > mark(room.id) && principalOf(state, m.authorId) !== userId && m.actingForId !== userId).length;
    const newest = all.at(-1);
    if (newest) messages[newest.id] = newest;
  }
  const comments: Record<string, Comment> = {};
  const byTask = new Map<string, Comment[]>();
  for (const c of Object.values(state.comments)) if (c.targetType === 'task') byTask.set(c.targetId, [...(byTask.get(c.targetId) ?? []), c]);
  for (const [taskId, list] of byTask) {
    list.sort(byStamp);
    const mineAt = list.findLastIndex((c) => principalOf(state, c.authorId) === userId);
    counts[unreadCountKey(taskId, userId)] = list.filter((c, i) => i > mineAt && c.createdAt > mark(taskId) && principalOf(state, c.authorId) !== userId).length;
    for (const keep of [list.at(-1), mineAt >= 0 ? list[mineAt] : undefined]) if (keep) comments[keep.id] = keep;
  }
  const reads: Record<string, ChatRead> = Object.fromEntries(Object.entries(state.chatReads).filter(([, read]) => read.userId === userId));
  return { ...structuredClone(state), messages: structuredClone(messages), comments: structuredClone(comments), chatReads: structuredClone(reads), counts };
}

async function answers(state: State, userId: string): Promise<{ list: ChatRow[]; unread: number }> {
  const t = testApi(chatCalls, structuredClone(state));
  t.as(userId);
  return { list: await t.api.call('chats.list', {}), unread: (await t.api.call('chats.unreadCount', {})).unread };
}

describe('unread counts (plan 4.13, A9)', () => {
  it('names the key of an unread count', () => {
    expect(unreadCountKey('cnv_001', 'usr_002')).toBe('unread:cnv_001:usr_002');
    expect(unreadCountKey('tsk_001', 'usr_002')).toBe('unread:tsk_001:usr_002');
  });

  it('gives the numbers of a full scan when the counts stand in for the unread rows', async () => {
    const state = office();
    let some = 0;
    for (const userId of humans(state)) {
      const whole = await answers(state, userId);
      some += whole.unread;
      expect(await answers(scoped(state, userId), userId), userId).toEqual(whole);
    }
    expect(some).toBeGreaterThan(0);
  });

  it('reads the count before the rows', async () => {
    const state = office();
    const userId = 'usr_001';
    const room = Object.values(state.conversations).find((c) => canSeeConversation(state, c, state.users[userId]))!;
    state.counts = { [unreadCountKey(room.id, userId)]: 7 };
    const { list } = await answers(state, userId);
    expect(list.find((row) => row.id === room.id)?.unread).toBe(7);
  });

  it('changes nothing without counts: the scan answers, and a read mark adds no counts', async () => {
    const state = office();
    const t = testApi(chatCalls, structuredClone(state));
    t.as('usr_006');
    const before = await t.api.call('chats.unreadCount', {});
    expect(before.unread).toBeGreaterThan(0);
    const thread = threadOf(state, 'usr_006');
    await t.api.call('chats.markRead', { conversationId: thread });
    expect(t.store.state.counts).toBeUndefined();
  });

  it('chats.markRead sets the count of the marked chat or task thread to 0, and the total counts the rest', async () => {
    const state = office();
    const userId = 'usr_006';
    const counted = scoped(state, userId);
    const thread = threadOf(state, userId);
    expect(counted.counts![unreadCountKey(thread, userId)]).toBe(1);
    const t = testApi(chatCalls, counted);
    t.as(userId);
    const whole = testApi(chatCalls, structuredClone(state));
    whole.as(userId);
    const total = (await whole.api.call('chats.unreadCount', {})).unread;
    const after = await t.api.call('chats.markRead', { conversationId: thread });
    expect(t.store.state.counts![unreadCountKey(thread, userId)]).toBe(0);
    expect(after).toEqual(await whole.api.call('chats.markRead', { conversationId: thread }));
    expect(after.unread).toBe(total - 1);

    const admin = 'usr_001';
    const adminCounted = scoped(state, admin);
    const room = Object.values(state.conversations).find((c) => canSeeConversation(state, c, state.users[admin]) && adminCounted.counts![unreadCountKey(c.id, admin)] > 0)!;
    expect(room).toBeDefined();
    const a = testApi(chatCalls, adminCounted);
    a.as(admin);
    whole.as(admin);
    const roomAfter = await a.api.call('chats.markRead', { conversationId: room.id });
    expect(a.store.state.counts![unreadCountKey(room.id, admin)]).toBe(0);
    expect(roomAfter).toEqual(await whole.api.call('chats.markRead', { conversationId: room.id }));
  });
});
