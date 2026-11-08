import { beforeAll, describe, expect, it } from 'vitest';
import { emptyReactions, type Comment } from '../../../src/api/contract/entities';
import { sharedCalls, type SharedCallName } from '../../../src/api/sharedCalls';
import { type State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { mentionMarkup } from '../../../src/lib/text';
import { runBoth } from './compare';
import { HIDDEN_PROJECT, HIDDEN_VIEWER } from './sweep';

/**
 * Who is part of a to-do thread, on the server (chat report, owner 2026-11-08). A helper of the to-do and a person named with @ in a
 * message are part of the thread, as the lead, the leader and a commenter are. The handler (chats.ts, taskThreads) and the loader
 * (threadsSql and its twins, taskRowsUnread) read the one rule of src/api/taskUnread.ts, so the scoped load gives the answer of the
 * whole office for chats.list, chats.unreadCount, chats.waiting, chats.markRead and tasks.list. The view rule stays.
 */

const TODAY = '2026-10-04';
const NOW = new Date('2026-10-04T06:00:00Z');
let seed: State;

beforeAll(async () => {
  seed = await buildSeed(TODAY, async () => undefined);
});

const day = (n: number) => `2026-10-03T08:${String(n % 60).padStart(2, '0')}:00.000+03:00`;

/** Runs a call both ways, expects the same answer, and gives the answer. */
async function same(state: State, name: SharedCallName, input: unknown, actor: string) {
  const { whole, scoped, loaded } = await runBoth(state, name, input, actor, { now: NOW, correlationId: 'cor_test' });
  expect(scoped, `${name} as ${actor}`).toEqual(whole);
  return { out: whole.outcome.output, loaded };
}

type Row = { id: string; kind: string; unread: number; lastAt: string; preview: string };
const rows = async (state: State, actor: string) => (await same(state, 'chats.list', {}, actor)).out as Row[];

/** A project to-do with a lead and a leader, and a person who is neither (and does not comment). */
function office() {
  const state = structuredClone(seed);
  const task = Object.values(state.tasks).find((t) => t.projectId !== null && t.projectId !== HIDDEN_PROJECT && t.ownerId !== null
    && !state.projects[t.projectId].access?.hidden && Object.values(state.comments).every((c) => c.targetId !== t.id))!;
  const lead = task.ownerId as string;
  const leader = state.projects[task.projectId!].leaderId as string;
  const people = Object.values(state.users).filter((u) => u.kind === 'human' && u.active && u.systemRole !== 'admin' && u.id !== lead && u.id !== leader).map((u) => u.id);
  const [helper, named, other] = people as [string, string, string];
  let n = 0;
  const add = (authorId: string, body: string, extra: Partial<Comment> = {}) => {
    n += 1;
    const id = `cmt_96${n}`;
    state.comments[id] = { id, targetType: 'task', targetId: task.id, authorId, body, reactions: emptyReactions(), fileIds: [], createdAt: day(n), editedAt: null, ...extra } as Comment;
    return id;
  };
  return { state, task, lead, leader, helper, named, other, add };
}

describe('a helper and a person named with @ have the thread, and the scoped load agrees with the whole office', () => {
  it('gives a helper who never commented the thread, the badge, the to-do row number and the mark read', async () => {
    const { state, task, lead, leader, helper, add } = office();
    state.tasks[task.id].helperIds = [helper];
    add(lead, 'Please send the plan.');
    add(leader, 'And the sections.');
    const list = await rows(state, helper);
    expect(list.find((row) => row.id === task.id)).toMatchObject({ kind: 'task', unread: 2 });
    const badge = ((await same(state, 'chats.unreadCount', {}, helper)).out as { unread: number }).unread;
    expect(badge).toBe(list.reduce((sum, row) => sum + row.unread, 0));
    const todos = (await same(state, 'tasks.list', {}, helper)).out as { task: { id: string }; unreadCount: number }[];
    expect(todos.find((row) => row.task.id === task.id)?.unreadCount).toBe(2);
    await same(state, 'chats.waiting', {}, helper);
    await same(state, 'chats.markRead', { conversationId: task.id }, helper);
  });

  it('gives a person named with @ in a message the thread, with every unread message', async () => {
    const { state, task, lead, leader, named, add } = office();
    add(lead, 'Start of the work.');
    add(leader, `${mentionMarkup(state.users[named].name, named)} please check the door.`);
    add(lead, 'One more note.');
    const list = await rows(state, named);
    expect(list.find((row) => row.id === task.id)).toMatchObject({ kind: 'task', unread: 3 });
    const badge = ((await same(state, 'chats.unreadCount', {}, named)).out as { unread: number }).unread;
    expect(badge).toBe(list.reduce((sum, row) => sum + row.unread, 0));
    const todos = (await same(state, 'tasks.list', {}, named)).out as { task: { id: string }; unreadCount: number }[];
    expect(todos.find((row) => row.task.id === task.id)?.unreadCount).toBe(3);
    await same(state, 'chats.waiting', {}, named);
    await same(state, 'chats.markRead', { conversationId: task.id }, named);
    await same(state, 'chats.archive', { conversationId: task.id, archived: true }, named);
  });

  it('gives a third person nothing, and a quiet line that holds a name makes nobody part of the thread', async () => {
    const { state, task, lead, named, other, add } = office();
    add(lead, 'A message with no name.');
    add(lead, `${mentionMarkup(state.users[named].name, named)} (reason)`, { kind: 'reopened' } as Partial<Comment>);
    for (const person of [named, other]) expect((await rows(state, person)).find((row) => row.id === task.id), person).toBeUndefined();
    const todos = (await same(state, 'tasks.list', {}, named)).out as { task: { id: string }; unreadCount: number }[];
    expect(todos.find((row) => row.task.id === task.id)?.unreadCount ?? 0).toBe(0);
  });

  it('counts a thread that a helper has, also when it is the only thread, in the newest 100', async () => {
    const { state, task, lead, helper, add } = office();
    state.tasks[task.id].helperIds = [helper];
    add(lead, 'Only message.');
    const list = await rows(state, helper);
    expect(list.filter((row) => row.kind === 'task').map((row) => row.id)).toContain(task.id);
  });
});

describe('the view rule stays on the scoped load (chat, 2026-11-08)', () => {
  it('gives a named person and a helper nothing of a hidden project, on the whole office and on the scoped load', async () => {
    const state = structuredClone(seed);
    state.projects[HIDDEN_PROJECT].access = { hidden: true, viewerIds: [HIDDEN_VIEWER] };
    const hidden = Object.values(state.tasks).filter((t) => t.projectId === HIDDEN_PROJECT && t.ownerId !== null);
    const outsiders = Object.values(state.users).filter((u) => u.kind === 'human' && u.active && u.systemRole !== 'admin' && u.id !== HIDDEN_VIEWER
      && u.id !== state.projects[HIDDEN_PROJECT].leaderId && !hidden.some((t) => t.ownerId === u.id)
      && !Object.values(state.members).some((m) => m.projectId === HIDDEN_PROJECT && m.userId === u.id)).map((u) => u.id);
    const [helper, named] = outsiders;
    expect(helper && named).toBeTruthy();
    let n = 0;
    for (const task of hidden) {
      state.tasks[task.id].helperIds = [helper];
      n += 1;
      state.comments[`cmt_95${n}`] = {
        id: `cmt_95${n}`, targetType: 'task', targetId: task.id, authorId: task.ownerId as string, body: `${mentionMarkup('X', named)} secret`, reactions: emptyReactions(), fileIds: [],
        createdAt: day(n), editedAt: null,
      } as Comment;
    }
    for (const person of [helper, named]) {
      for (const name of ['chats.list', 'chats.unreadCount', 'chats.waiting', 'tasks.list'] as const) {
        const { out, loaded } = await same(state, name, {}, person);
        const text = JSON.stringify(out);
        for (const task of hidden) expect(text, `${name} ${person} ${task.id}`).not.toContain(`"${task.id}"`);
        for (const task of hidden) expect(Object.keys(loaded.counts ?? {}).filter((key) => key.includes(task.id)), `${name} ${person} counts`).toEqual([]);
      }
      for (const task of hidden) {
        const run = await runBoth(state, 'chats.markRead', { conversationId: task.id }, person, { now: NOW, correlationId: 'cor_test' });
        expect(run.scoped, `markRead ${person}`).toEqual(run.whole);
        expect(run.whole.outcome.error?.code, `markRead ${person}`).toBe('not_found');
      }
    }
  });

  it('gives a named person or a helper nothing of an office to-do that the person may not see', async () => {
    const state = structuredClone(seed);
    const [first] = Object.values(state.tasks).filter((t) => t.projectId !== null && t.ownerId !== null);
    const lead = 'usr_003';
    state.tasks.tsk_971 = { ...first, id: 'tsk_971', projectId: null, stageId: null, ownerId: lead, createdBy: lead, helperIds: [], title: 'Office secret' } as never;
    const outsiders = Object.values(state.users).filter((u) => u.kind === 'human' && u.active && u.systemRole !== 'admin' && u.id !== lead);
    const [named] = outsiders;
    state.comments.cmt_971 = {
      id: 'cmt_971', targetType: 'task', targetId: 'tsk_971', authorId: lead, body: `${mentionMarkup('X', named.id)} secret`, reactions: emptyReactions(), fileIds: [], createdAt: day(1), editedAt: null,
    } as Comment;
    for (const name of ['chats.list', 'chats.unreadCount', 'chats.waiting', 'tasks.list'] as const) {
      const { out, loaded } = await same(state, name, {}, named.id);
      expect(JSON.stringify(out), name).not.toContain('"tsk_971"');
      expect(Object.keys(loaded.counts ?? {}).filter((key) => key.includes('tsk_971')), name).toEqual([]);
    }
    // The helper of an office to-do sees it, and has the thread.
    state.tasks.tsk_971.helperIds = [named.id];
    expect(((await rows(state, named.id)).find((row) => row.id === 'tsk_971'))).toMatchObject({ kind: 'task', unread: 1 });
    // The lead keeps it.
    expect(((await rows(state, lead)).find((row) => row.id === 'tsk_971'))).toMatchObject({ kind: 'task' });
    expect(sharedCalls['chats.list']).toBeDefined();
  });
});
