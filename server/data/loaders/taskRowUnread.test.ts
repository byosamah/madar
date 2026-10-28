import { beforeAll, describe, expect, it } from 'vitest';
import { emptyReactions, type Comment } from '../../../src/api/contract/entities';
import { sharedCalls } from '../../../src/api/sharedCalls';
import { chatReadKey, unreadCountKey, type State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { snapshotOf } from '../officeCache';
import { runBoth } from './compare';
import { loadFor } from './index';
import { memorySource } from './memorySource';
import type { CountSelect, Select } from './query';
import type { Source } from './source';
import { HIDDEN_PROJECT, HIDDEN_VIEWER } from './sweep';

/**
 * The unread number of a to-do row on the server (fbk_071, owner 2026-10-27). tasks.list gives the handler the unread numbers as counts,
 * so the loaded answer equals the answer on the whole office, for every person. The loader sends a fixed number of statements, however many
 * to-dos the list has.
 */

const TODAY = '2026-10-04';
const NOW = new Date('2026-10-04T06:00:00Z');
let seed: State;

beforeAll(async () => {
  seed = await buildSeed(TODAY, async () => undefined);
});

/** A time on 2026-10-03: n counts minutes, so a later n is a later time. */
const day = (n: number) => `2026-10-03T08:${String(n % 60).padStart(2, '0')}:00.000+03:00`;

/** One to-do with comments from several people, read marks, an own comment, an own agent and a thread marked unread. */
function talk(): { state: State; taskIds: string[] } {
  const state = structuredClone(seed);
  const tasks = Object.values(state.tasks).filter((t) => t.projectId !== null && t.ownerId !== null).slice(0, 6);
  const humans = Object.values(state.users).filter((u) => u.kind === 'human' && u.active).map((u) => u.id);
  const agent = Object.values(state.users).find((u) => u.kind === 'agent' && u.ownerId);
  let n = 0;
  const add = (taskId: string, authorId: string, extra: Partial<Comment> = {}) => {
    n += 1;
    const id = `cmt_${700 + n}`;
    state.comments[id] = { id, targetType: 'task', targetId: taskId, authorId, body: id, reactions: emptyReactions(), fileIds: [], createdAt: day(n), editedAt: null, ...extra } as Comment;
  };
  for (const [index, task] of tasks.entries()) {
    const lead = task.ownerId as string;
    const other = humans.find((id) => id !== lead)!;
    add(task.id, other);
    add(task.id, lead);
    add(task.id, other);
    add(task.id, humans.find((id) => id !== lead && id !== other)!);
    if (index % 2 === 0 && agent?.ownerId) add(task.id, agent.id);
    // A quiet line of a reason is never unread.
    if (index === 1) add(task.id, other, { kind: 'reopened' } as Partial<Comment>);
    // A read mark in the middle of the thread, for the lead, and a thread that the lead marked unread.
    if (index === 2) state.chatReads[chatReadKey(task.id, lead)] = { conversationId: task.id, userId: lead, lastReadAt: day(n) };
    if (index === 3) state.chatReads[chatReadKey(task.id, lead)] = { conversationId: task.id, userId: lead, lastReadAt: day(n), markedUnread: true };
  }
  return { state, taskIds: tasks.map((t) => t.id) };
}

describe('tasks.list unread numbers on the scoped load', () => {
  it('give every person the answer of the whole office, with the numbers of the threads that the person is part of', async () => {
    const { state } = talk();
    let some = 0;
    for (const user of Object.values(state.users).filter((u) => u.kind === 'human' && u.active)) {
      const { whole, scoped } = await runBoth(state, 'tasks.list', {}, user.id, { now: NOW, correlationId: 'cor_test' });
      expect(scoped, user.id).toEqual(whole);
      const rows = whole.outcome.output as { task: { id: string }; unreadCount: number; commentCount: number }[];
      some += rows.filter((row) => row.unreadCount > 0).length;
      for (const row of rows) expect(row.unreadCount).toBeLessThanOrEqual(row.commentCount);
    }
    expect(some).toBeGreaterThan(3);
  });

  it('give the Inbox number of the thread, for the lead of each to-do', async () => {
    const { state, taskIds } = talk();
    for (const id of taskIds) {
      const lead = state.tasks[id].ownerId as string;
      const rows = (await runBoth(state, 'tasks.list', {}, lead, { now: NOW, correlationId: 'cor_test' })).scoped.outcome.output as { task: { id: string }; unreadCount: number }[];
      const inbox = (await runBoth(state, 'chats.list', {}, lead, { now: NOW, correlationId: 'cor_test' })).scoped.outcome.output as { id: string; unread: number }[] | undefined;
      expect(inbox, `chats.list as ${lead}`).toBeDefined();
      const thread = inbox!.find((row) => row.id === id);
      if (thread) expect(rows.find((row) => row.task.id === id)?.unreadCount, id).toBe(thread.unread);
    }
  });

  it('read nothing for each row: the statements stay the same for 5 and for 60 to-dos', async () => {
    const small = talk().state;
    const big = talk().state;
    const [template] = Object.values(big.tasks).filter((t) => t.projectId !== null && t.ownerId !== null);
    for (let n = 0; n < 55; n += 1) {
      const id = `tsk_9${String(n).padStart(2, '0')}`;
      big.tasks[id] = { ...template, id, title: `Extra ${n}` };
      big.comments[`cmt_9${n}`] = { id: `cmt_9${n}`, targetType: 'task', targetId: id, authorId: 'usr_001', body: 'x', reactions: emptyReactions(), fileIds: [], createdAt: day(20), editedAt: null } as Comment;
    }
    const statements = async (state: State) => {
      const reads: unknown[] = [];
      const base = memorySource(state);
      const src: Source = {
        ...base,
        select: async (s: Select) => (reads.push(s), base.select(s)),
        countWhere: async (s: CountSelect) => (reads.push(s), base.countWhere(s)),
        batch: undefined,
      };
      const lead = template.ownerId as string;
      await loadFor('tasks.list', sharedCalls['tasks.list'].input.parse({}), { src, office: snapshotOf(state, 1), actorId: lead, write: false, now: NOW });
      return reads.filter((read) => JSON.stringify(read).includes('"comments"')).length;
    };
    expect(await statements(big)).toBe(await statements(small));
  });

  it('read nothing for a to-do with no comment: it is no thread and has nothing unread (rows of the office object, tsk_481)', async () => {
    const { state } = talk();
    const commented = new Set(Object.values(state.comments).map((c) => c.targetId));
    const quiet = Object.values(state.tasks).filter((t) => t.projectId !== null && !commented.has(t.id)).map((t) => t.id);
    expect(quiet.length).toBeGreaterThan(3);
    const reads: unknown[] = [];
    const base = memorySource(state);
    const src: Source = {
      ...base,
      select: async (s: Select) => (reads.push(s), base.select(s)),
      countWhere: async (s: CountSelect) => (reads.push(s), base.countWhere(s)),
      batch: undefined,
    };
    await loadFor('tasks.list', sharedCalls['tasks.list'].input.parse({}), { src, office: snapshotOf(state, 1), actorId: 'usr_001', write: false, now: NOW });
    // No read mark, no comment read and no count names a to-do with no comment.
    const text = JSON.stringify(reads);
    for (const id of quiet) expect(text, id).not.toContain(id);
    // The row of such a to-do still gives 0 unread and 0 comments.
    const rows = (await runBoth(state, 'tasks.list', {}, 'usr_001', { now: NOW, correlationId: 'cor_test' })).scoped.outcome.output as { task: { id: string }; unreadCount: number; commentCount: number }[];
    const shown = rows.filter((row) => quiet.includes(row.task.id));
    expect(shown.length).toBeGreaterThan(3);
    for (const row of shown) expect(row, row.task.id).toMatchObject({ unreadCount: 0, commentCount: 0 });
  });

  it('count only the to-dos of the threads that the person is part of', async () => {
    const { state, taskIds } = talk();
    const outsider = Object.values(state.users).find((u) => u.kind === 'human' && u.active && !taskIds.some((id) => state.tasks[id].ownerId === u.id)
      && !Object.values(state.projects).some((p) => p.leaderId === u.id) && u.systemRole !== 'admin')!;
    const run = await runBoth(state, 'tasks.list', {}, outsider.id, { now: NOW, correlationId: 'cor_test' });
    expect(run.scoped).toEqual(run.whole);
    // The loaded state keeps no count for a thread of a task that the person is no part of.
    const counts = run.loaded.counts ?? {};
    for (const id of taskIds) {
      const commented = Object.values(state.comments).some((c) => c.targetId === id && c.authorId === outsider.id);
      if (!commented) expect(counts[unreadCountKey(id, outsider.id)], id).toBeUndefined();
    }
  });
});

describe('the unread numbers never leak a thread of a hidden project or an office task (fbk_071)', () => {
  /** A hidden project and an office task of Sara, each with comments of other people. */
  function secret() {
    const state = structuredClone(seed);
    state.projects[HIDDEN_PROJECT].access = { hidden: true, viewerIds: [HIDDEN_VIEWER] };
    const hidden = Object.values(state.tasks).filter((t) => t.projectId === HIDDEN_PROJECT && t.ownerId !== null);
    const office = { ...hidden[0], id: 'tsk_970', projectId: null, stageId: null, ownerId: 'usr_003', createdBy: 'usr_003', helperIds: [], title: 'Office secret' };
    state.tasks[office.id] = office as never;
    let n = 0;
    for (const task of [...hidden, office]) {
      for (const authorId of ['usr_001', 'usr_002']) {
        n += 1;
        state.comments[`cmt_97${n}`] = { id: `cmt_97${n}`, targetType: 'task', targetId: task.id, authorId, body: 'secret', reactions: emptyReactions(), fileIds: [], createdAt: day(n), editedAt: null } as Comment;
      }
    }
    return { state, hidden: hidden.map((t) => t.id), office: office.id };
  }

  it('gives an outsider no row and no count for the hidden project or the office task, on the whole office and on the scoped load', async () => {
    const { state, hidden, office } = secret();
    const outsiders = Object.values(state.users).filter((u) => u.kind === 'human' && u.active && u.systemRole !== 'admin' && u.id !== HIDDEN_VIEWER
      && u.id !== state.projects[HIDDEN_PROJECT].leaderId && u.id !== 'usr_003'
      && !Object.values(state.members).some((m) => m.projectId === HIDDEN_PROJECT && m.userId === u.id));
    expect(outsiders.length).toBeGreaterThan(2);
    for (const person of outsiders) {
      const run = await runBoth(state, 'tasks.list', {}, person.id, { now: NOW, correlationId: 'cor_test' });
      expect(run.scoped, person.id).toEqual(run.whole);
      const rows = (run.whole.outcome.output as { task: { id: string } }[]).map((row) => row.task.id);
      for (const id of [...hidden, office]) {
        expect(rows, `${person.id} ${id}`).not.toContain(id);
        expect(Object.keys(run.loaded.counts ?? {}).filter((key) => key.includes(id)), `${person.id} counts of ${id}`).toEqual([]);
        expect(Object.values(run.loaded.comments ?? {}).filter((c) => c.targetId === id), `${person.id} comments of ${id}`).toEqual([]);
      }
    }
  });

  it('gives the chosen viewer and the lead of the office task their own numbers, and the scoped load agrees', async () => {
    const { state, hidden, office } = secret();
    const chosen = await runBoth(state, 'tasks.list', {}, HIDDEN_VIEWER, { now: NOW, correlationId: 'cor_test' });
    expect(chosen.scoped).toEqual(chosen.whole);
    expect((chosen.whole.outcome.output as { task: { id: string } }[]).map((row) => row.task.id)).toEqual(expect.arrayContaining(hidden));
    const maker = await runBoth(state, 'tasks.list', {}, 'usr_003', { now: NOW, correlationId: 'cor_test' });
    expect(maker.scoped).toEqual(maker.whole);
    const row = (maker.whole.outcome.output as { task: { id: string }; unreadCount: number }[]).find((r) => r.task.id === office);
    expect(row?.unreadCount).toBe(2);
  });
});

