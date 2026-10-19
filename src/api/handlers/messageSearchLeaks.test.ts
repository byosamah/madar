import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { historyCalls } from './history';
import { insightCalls } from './insights';
import { taskCalls } from './tasks';
import { addProjectConversation } from '../chatState';
import { nextId } from '../store';
import { makeTask, makeUser, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The leak tests of the message search (root CLAUDE.md, "A feature that hides a record from some people gets leak tests"): an outsider
 * on every read path that the search changes, the error texts, and no text or id of a hidden chat in any answer. Hala (usr_001) is the
 * Admin, Faisal (usr_002) leads prj_001, Sara (usr_003) is on its team, Omar (usr_004) is outside, usr_005 is the agent of Sara,
 * Reem (usr_006) is a person who is in the group only.
 */
async function world() {
  const t = testApi({ ...insightCalls, ...chatCalls, ...contentCalls, ...taskCalls, ...historyCalls });
  t.store.state.tasks.tsk_001 = makeTask();
  t.store.state.counters.tsk = 1;
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Reem Extra' });
  const room = addProjectConversation(t.store.state, 'prj_001', STAMP).id;
  t.as('usr_003');
  const direct = (await t.api.call('chats.openDirect', { userId: 'usr_002' })).id;
  t.as('usr_002');
  const group = (await t.api.call('chats.createGroup', { name: 'Hidden crew', memberIds: ['usr_003', 'usr_006'] })).id;
  let minute = 0;
  for (const chat of [room, direct, group]) {
    minute += 1;
    const id = nextId(t.store.state, 'msg');
    t.store.state.messages[id] = {
      id, conversationId: chat, authorId: 'usr_002', actingForId: 'usr_002', body: 'Riser 9031', mentions: [],
      createdAt: `2026-09-30T10:${String(minute).padStart(2, '0')}:00.000+03:00`, editedAt: null,
    };
  }
  const hits = async (person: string) => {
    t.as(person);
    return (await t.api.call('search.query', { text: 'Riser 9031' })).messages;
  };
  return { ...t, room, direct, group, hits };
}

describe('the message search keeps hidden chats hidden', () => {
  it('gives an outsider no hit of a project chat, and the team and the Admin every hit of it', async () => {
    const t = await world();
    expect(await t.hits('usr_004')).toEqual([]);
    expect((await t.hits('usr_003')).filter((h) => h.chatId === t.room)).toHaveLength(1);
    expect((await t.hits('usr_001')).filter((h) => h.chatId === t.room)).toHaveLength(1);
    expect((await t.hits('usr_002')).filter((h) => h.chatId === t.room)).toHaveLength(1);
  });

  it('gives nobody else a hit of a direct chat, the Admin included', async () => {
    const t = await world();
    for (const person of ['usr_004', 'usr_001', 'usr_006']) expect((await t.hits(person)).some((h) => h.chatId === t.direct), person).toBe(false);
    for (const person of ['usr_002', 'usr_003']) expect((await t.hits(person)).some((h) => h.chatId === t.direct), person).toBe(true);
  });

  it('gives a hit of a group only to its members, and none after a person leaves', async () => {
    const t = await world();
    for (const person of ['usr_004', 'usr_001']) expect((await t.hits(person)).some((h) => h.chatId === t.group), person).toBe(false);
    expect((await t.hits('usr_006')).map((h) => h.chatId)).toEqual([t.group]);
    t.as('usr_006');
    await t.api.call('chats.leaveGroup', { conversationId: t.group });
    expect(await t.hits('usr_006')).toEqual([]);
  });

  it('gives an agent the hits of its person, and no more', async () => {
    const t = await world();
    const sara = (await t.hits('usr_003')).map((h) => h.id);
    expect(sara).toHaveLength(3);
    expect((await t.hits('usr_005')).map((h) => h.id)).toEqual(sara);
  });

  it('leaves no text and no id of a hidden chat in the answer', async () => {
    const t = await world();
    t.as('usr_004');
    const text = JSON.stringify(await t.api.call('search.query', { text: 'Riser 9031' }));
    expect(text).not.toContain('9031');
    for (const id of [t.direct, t.group, t.room]) expect(text).not.toContain(id);
  });
});

describe('the comment search keeps hidden tasks hidden', () => {
  /** An office task made by Faisal for Sara, with Omar as a helper and a comment that holds "riser". */
  async function office() {
    const t = await world();
    t.as('usr_002');
    const { task } = await t.api.call('tasks.create', { title: 'Renew the licence', ownerId: 'usr_003', helperIds: ['usr_004'], dueDate: '2026-10-08' });
    t.as('usr_003');
    await t.api.call('comments.create', { targetType: 'task', targetId: task.id, body: 'Riser fee 7742 paid' });
    const find = async (person: string) => {
      t.as(person);
      return (await t.api.call('search.query', { text: 'riser 7742' })).messages.filter((h) => h.kind === 'task');
    };
    return { ...t, taskId: task.id, find };
  }

  it('gives the comments of an office task only to its people and the Admin', async () => {
    const t = await office();
    for (const person of ['usr_002', 'usr_003', 'usr_004', 'usr_001']) {
      const hits = await t.find(person);
      expect(hits.map((h) => h.chatId), person).toEqual([t.taskId]);
      expect(hits[0], person).toMatchObject({ title: 'Renew the licence', project: null, person: null });
    }
    expect(await t.find('usr_006')).toEqual([]);
    t.as('usr_006');
    expect(JSON.stringify(await t.api.call('search.query', { text: 'riser 7742' }))).not.toContain(t.taskId);
  });

  it('drops them for a helper whose place on the task ends', async () => {
    const t = await office();
    expect(await t.find('usr_004')).toHaveLength(1);
    t.as('usr_002');
    await t.api.call('tasks.update', { id: t.taskId, patch: { helperIds: [] } });
    expect(await t.find('usr_004')).toEqual([]);
    expect(await t.find('usr_003')).toHaveLength(1);
  });

  it('gives an agent the comments of its person, and no more', async () => {
    const t = await office();
    expect(await t.find('usr_005')).toHaveLength(1);
    t.as('usr_002');
    await t.api.call('tasks.update', { id: t.taskId, patch: { ownerId: 'usr_006', helperIds: [] } });
    expect(await t.find('usr_005')).toEqual([]);
    expect(await t.find('usr_006')).toHaveLength(1);
  });

  it('never finds a comment on a project post', async () => {
    const t = await world();
    t.as('usr_002');
    const post = await t.api.call('updates.create', { projectId: 'prj_001', body: 'A post' });
    await t.api.call('comments.create', { targetType: 'update', targetId: post.id, body: 'Riser 9031 on the post' });
    for (const person of ['usr_001', 'usr_002', 'usr_003', 'usr_004']) {
      t.as(person);
      expect((await t.api.call('search.query', { text: 'Riser 9031' })).messages.filter((h) => h.kind === 'task'), person).toEqual([]);
    }
  });

  it('finds no comment of a deleted task, and finds it again after the Undo of the delete', async () => {
    const t = await world();
    t.as('usr_002');
    const { task } = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Short lived', ownerId: 'usr_003' });
    await t.api.call('comments.create', { targetType: 'task', targetId: task.id, body: 'Riser 5520 note' });
    const find = async () => {
      t.as('usr_004');
      return (await t.api.call('search.query', { text: 'Riser 5520' })).messages.filter((h) => h.kind === 'task');
    };
    expect(await find()).toHaveLength(1);
    t.as('usr_002');
    await t.api.call('tasks.delete', { id: task.id });
    expect(await find()).toEqual([]);
    const deleted = Object.values(t.store.state.events).find((e) => e.verb === 'task.deleted' && e.targetId === task.id)!;
    t.as('usr_002');
    await t.api.call('events.undo', { eventId: deleted.id });
    expect(await find()).toHaveLength(1);
  });
});
