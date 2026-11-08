import { beforeAll, describe, expect, it } from 'vitest';
import { emptyReactions, type Comment } from '../../../src/api/contract/entities';
import type { SharedCallName } from '../../../src/api/sharedCalls';
import { chatReadKey, type State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { runBoth } from './compare';
import { memorySource } from './memorySource';
import { HIDDEN_PROJECT } from './sweep';

/**
 * Date lines in the Inbox on the server (owner, 2026-11-08: "only real messages lift it"). The time and the preview of a to-do thread
 * come from its newest MESSAGE; a quiet line (a due date move, a start date move, a shift, a reopening) sets them only for a thread that
 * holds nothing else. The handler (chats.ts, threadLast) and the loader (threadsSql and its twins, threadsMiddle) read the one rule, so the
 * scoped load gives the answer of the whole office for chats.list, chats.unreadCount, chats.waiting and the archive.
 */

const TODAY = '2026-10-04';
const NOW = new Date('2026-10-04T06:00:00Z');
let seed: State;

beforeAll(async () => {
  seed = await buildSeed(TODAY, async () => undefined);
});

const day = (n: number) => `2026-10-03T08:${String(n % 60).padStart(2, '0')}:00.000+03:00`;
const MOVE = { from: { startDate: null, dueDate: '2026-10-10' }, to: { startDate: null, dueDate: '2026-10-12' } };

async function same(state: State, name: SharedCallName, input: unknown, actor: string) {
  const { whole, scoped } = await runBoth(state, name, input, actor, { now: NOW, correlationId: 'cor_test' });
  expect(scoped, `${name} as ${actor}`).toEqual(whole);
  return whole.outcome.output;
}

type Row = { id: string; kind: string; unread: number; lastAt: string; preview: string; previewKind: string | null; archived: boolean };

/** Two to-dos of one lead, each with comments. The lead is part of both threads. */
function office() {
  const state = structuredClone(seed);
  const [first, second] = Object.values(state.tasks).filter((t) => t.projectId !== null && t.projectId !== HIDDEN_PROJECT && t.ownerId !== null
    && !state.projects[t.projectId].access?.hidden && Object.values(state.comments).every((c) => c.targetId !== t.id) && t.ownerId === 'usr_003');
  const lead = first.ownerId as string;
  const other = Object.values(state.users).find((u) => u.kind === 'human' && u.active && u.id !== lead && u.systemRole !== 'admin')!.id;
  let n = 0;
  const add = (taskId: string, authorId: string, body: string, minute: number, extra: Partial<Comment> = {}) => {
    n += 1;
    const id = `cmt_94${n}`;
    state.comments[id] = { id, targetType: 'task', targetId: taskId, authorId, body, reactions: emptyReactions(), fileIds: [], createdAt: day(minute), editedAt: null, ...extra } as Comment;
  };
  return { state, first, second, lead, other, add };
}

describe('a quiet line never sets the time or the preview of a thread, and the scoped load agrees with the whole office', () => {
  it('keeps the last message as the time and the preview, for every kind of line', async () => {
    const { state, first, lead, other, add } = office();
    add(first.id, other, 'A real message.', 10);
    add(first.id, other, 'Due date moved.', 20, { dates: MOVE });
    add(first.id, other, 'Start moved.', 25, { dates: { from: { startDate: '2026-10-01', dueDate: '2026-10-10' }, to: { startDate: '2026-10-03', dueDate: '2026-10-10' } } });
    add(first.id, other, 'Shifted.', 30, { dates: { ...MOVE, byTaskId: 'tsk_001', lateDays: 2 } });
    add(first.id, other, 'Opens again.', 40, { kind: 'reopened' });
    const list = (await same(state, 'chats.list', {}, lead)) as Row[];
    expect(list.find((row) => row.id === first.id)).toMatchObject({ lastAt: day(10), preview: 'A real message.', previewKind: null, unread: 1 });
    await same(state, 'chats.unreadCount', {}, lead);
    await same(state, 'chats.waiting', {}, lead);
    await same(state, 'chats.markRead', { conversationId: first.id }, lead);
  });

  it('sorts a thread by its newest message', async () => {
    const { state, first, second, lead, other, add } = office();
    add(first.id, other, 'The older message.', 10);
    add(second.id, other, 'The newer message.', 20);
    add(first.id, other, 'A date reason.', 40, { dates: MOVE });
    const order = ((await same(state, 'chats.list', {}, lead)) as Row[]).filter((row) => row.kind === 'task').map((row) => row.id);
    expect(order.indexOf(second.id)).toBeLessThan(order.indexOf(first.id));
  });

  it('keeps the newest line for a thread with only quiet lines', async () => {
    const { state, first, lead, other, add } = office();
    add(first.id, other, 'Moved once.', 10, { dates: MOVE });
    add(first.id, other, 'Moved twice.', 30, { dates: MOVE });
    const row = ((await same(state, 'chats.list', {}, lead)) as Row[]).find((r) => r.id === first.id);
    expect(row).toMatchObject({ lastAt: day(30), preview: 'Moved twice.', previewKind: 'due_date', unread: 0 });
  });

  it('does not bring an archived thread back for a line, for the list and for the badge', async () => {
    const { state, first, lead, other, add } = office();
    add(first.id, other, 'A real message.', 10);
    state.chatReads[chatReadKey(first.id, lead)] = { conversationId: first.id, userId: lead, lastReadAt: day(0), archivedAt: day(15) };
    add(first.id, other, 'A date line after the archive.', 30, { dates: MOVE });
    const row = ((await same(state, 'chats.list', {}, lead)) as Row[]).find((r) => r.id === first.id);
    expect(row).toMatchObject({ archived: true, unread: 1 });
    const badge = (await same(state, 'chats.unreadCount', {}, lead)) as { unread: number };
    const rows = (await same(state, 'chats.list', {}, lead)) as Row[];
    expect(badge.unread).toBe(rows.filter((r) => !r.archived).reduce((sum, r) => sum + r.unread, 0));
  });

  it('cuts the 100 newest threads by the time of the newest message, the same on the source and on the whole office', async () => {
    const { state, first, second, lead, other, add } = office();
    add(first.id, other, 'A message.', 10);
    add(second.id, other, 'A message.', 20);
    add(first.id, other, 'A late line.', 50, { dates: MOVE });
    const found = await memorySource(state).threads({ owner: lead, led: [], me: [lead], limit: 100, admin: false, seen: Object.keys(state.projects) });
    expect(found.find((thread) => thread.id === first.id)?.last).toBe(day(10));
    expect(found.find((thread) => thread.id === second.id)?.last).toBe(day(20));
    // A cut just after the thread with the newer message keeps that thread and drops the thread with the older message, although the
    // older one has the newest line of all.
    const at = found.findIndex((thread) => thread.id === second.id);
    const cut = await memorySource(state).threads({ owner: lead, led: [], me: [lead], limit: at + 1, admin: false, seen: Object.keys(state.projects) });
    expect(cut.map((thread) => thread.id)).toContain(second.id);
    expect(cut.map((thread) => thread.id)).not.toContain(first.id);
  });
});
