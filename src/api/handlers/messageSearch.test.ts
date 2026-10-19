import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { historyCalls } from './history';
import { insightCalls } from './insights';
import { taskCalls } from './tasks';
import { addProjectConversation } from '../chatState';
import { emptyReactions } from '../contract/entities';
import { nextId } from '../store';
import { makeTask, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The Messages group of search.query (chat design 2026-10-19, item 16). Hala (usr_001) is the Admin, Faisal (usr_002) leads prj_001
 * ("Test Tower"), Sara (usr_003) is on its team, Omar (usr_004) is outside.
 */
function world() {
  const t = testApi({ ...insightCalls, ...chatCalls, ...contentCalls, ...taskCalls, ...historyCalls });
  t.store.state.tasks.tsk_001 = makeTask();
  t.store.state.counters.tsk = 1;
  const room = addProjectConversation(t.store.state, 'prj_001', STAMP).id;
  /** Writes a message with the stamp 2026-09-30T10:<minute>:00 and gives its id. */
  function say(conversationId: string, authorId: string, body: string, minute: number): string {
    const id = nextId(t.store.state, 'msg');
    const createdAt = `2026-09-30T10:${String(minute).padStart(2, '0')}:00.000+03:00`;
    t.store.state.messages[id] = { id, conversationId, authorId, actingForId: authorId, body, mentions: [], createdAt, editedAt: null };
    return id;
  }
  /** Writes a comment of a task with the stamp 2026-09-30T10:<minute>:00. A reason line has a date move. */
  function note(taskId: string, authorId: string, body: string, minute: number, extra: Record<string, unknown> = {}): string {
    const id = nextId(t.store.state, 'cmt');
    const createdAt = `2026-09-30T10:${String(minute).padStart(2, '0')}:00.000+03:00`;
    t.store.state.comments[id] = { id, targetType: 'task', targetId: taskId, authorId, body, reactions: emptyReactions(), fileIds: [], createdAt, editedAt: null, ...extra };
    return id;
  }
  return { ...t, room, say, note };
}

describe('search.query finds chat messages', () => {
  it('finds the messages of a project chat that hold every word, newest first, at most 5', async () => {
    const t = world();
    for (let i = 1; i <= 7; i++) t.say(t.room, 'usr_002', `Riser size ${i}`, i);
    t.as('usr_003');
    const { messages } = await t.api.call('search.query', { text: 'size riser' });
    expect(messages.map((h) => h.line)).toEqual(['Riser size 7', 'Riser size 6', 'Riser size 5', 'Riser size 4', 'Riser size 3']);
    expect(messages[0]).toMatchObject({ kind: 'project', chatId: t.room, title: 'Test Tower', project: { id: 'prj_001' }, author: { id: 'usr_002' }, mine: false, person: null });
  });

  it('matches across Arabic letter forms and tashkeel', async () => {
    const t = world();
    t.say(t.room, 'usr_002', 'أسعارُ المواد ارتفعت', 1);
    t.as('usr_003');
    expect((await t.api.call('search.query', { text: 'اسعار' })).messages.map((h) => h.line)).toEqual(['أسعارُ المواد ارتفعت']);
  });

  it('finds no message for a query with no word of 3 letters', async () => {
    const t = world();
    t.say(t.room, 'usr_002', 'ri ab', 1);
    t.as('usr_003');
    expect((await t.api.call('search.query', { text: 'ri ab' })).messages).toEqual([]);
    expect((await t.api.call('search.query', { text: 'ri' })).messages).toEqual([]);
  });

  it('finds an own direct chat, with the other person as its picture', async () => {
    const t = world();
    t.as('usr_003');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_002' });
    t.say(id, 'usr_003', 'riser drawing', 1);
    t.as('usr_002');
    const seen = (await t.api.call('search.query', { text: 'riser' })).messages;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: 'direct', chatId: id, title: 'Sara Team', person: { id: 'usr_003' }, author: { id: 'usr_003' }, mine: false, project: null });
    t.as('usr_003');
    expect((await t.api.call('search.query', { text: 'riser' })).messages[0]).toMatchObject({ kind: 'direct', person: { id: 'usr_002' }, mine: true });
  });

  it('finds a group by its name and shows the author of the line', async () => {
    const t = world();
    t.as('usr_002');
    const { id } = await t.api.call('chats.createGroup', { name: 'Tower crew', memberIds: ['usr_003', 'usr_004'] });
    t.say(id, 'usr_004', 'The riser is late', 1);
    t.as('usr_003');
    expect((await t.api.call('search.query', { text: 'riser' })).messages[0]).toMatchObject({ kind: 'group', title: 'Tower crew', person: null, project: null, author: { id: 'usr_004' }, line: 'The riser is late' });
  });

  it('leaves out a deleted message, and finds it again when deletedAt goes', async () => {
    const t = world();
    const id = t.say(t.room, 'usr_002', 'Riser offer', 1);
    t.as('usr_003');
    expect((await t.api.call('search.query', { text: 'riser' })).messages).toHaveLength(1);
    t.store.state.messages[id].deletedAt = '2026-09-30T11:00:00.000+03:00';
    expect((await t.api.call('search.query', { text: 'riser' })).messages).toEqual([]);
    delete t.store.state.messages[id].deletedAt;
    expect((await t.api.call('search.query', { text: 'riser' })).messages).toHaveLength(1);
  });

  it('cuts a long body to a line that starts before the first hit', async () => {
    const t = world();
    t.say(t.room, 'usr_002', `${'word '.repeat(60)}the new riser size is 150 mm`, 1);
    t.as('usr_003');
    expect((await t.api.call('search.query', { text: 'riser' })).messages[0].line).toBe('…word the new riser size is 150 mm');
  });

  it('shows a mention as its name and never matches a user id', async () => {
    const t = world();
    t.say(t.room, 'usr_002', 'Ask @[Sara Team](usr_003) about the slab', 1);
    t.as('usr_003');
    expect((await t.api.call('search.query', { text: 'usr_003' })).messages).toEqual([]);
    expect((await t.api.call('search.query', { text: 'sara' })).messages[0].line).toBe('Ask @Sara Team about the slab');
  });

  it('finds nothing in a search that names the chat only, and keeps the older groups of the answer', async () => {
    const t = world();
    t.say(t.room, 'usr_002', 'Riser size', 1);
    t.as('usr_003');
    const answer = await t.api.call('search.query', { text: 'Test Tower' });
    expect(answer.messages).toEqual([]);
    expect(answer.projects.map((p) => p.id)).toEqual(['prj_001']);
  });

  it('finds the comments of a project task and its reason lines, for every active person', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Riser moved' });
    t.note('tsk_001', 'usr_003', 'Riser late', 30, { dates: { from: { startDate: null, dueDate: '2026-10-10' }, to: { startDate: null, dueDate: '2026-10-12' } } });
    for (const person of ['usr_004', 'usr_001', 'usr_002']) {
      t.as(person);
      const { messages } = await t.api.call('search.query', { text: 'riser' });
      expect(messages.map((h) => h.line), person).toEqual(['Riser late', 'Riser moved']);
      expect(messages[0], person).toMatchObject({ kind: 'task', chatId: 'tsk_001', title: 'Ground floor plan', project: { id: 'prj_001' }, person: null, author: { id: 'usr_003' } });
    }
    t.as('usr_003');
    expect((await t.api.call('search.query', { text: 'riser' })).messages[0].mine).toBe(true);
  });

  it('keeps the newest 5 of messages and comments together', async () => {
    const t = world();
    for (const minute of [1, 3, 5]) t.say(t.room, 'usr_002', `Riser message ${minute}`, minute);
    for (const minute of [2, 4, 6]) t.note('tsk_001', 'usr_002', `Riser comment ${minute}`, minute);
    t.as('usr_003');
    const { messages } = await t.api.call('search.query', { text: 'riser' });
    expect(messages.map((h) => `${h.kind} ${h.line}`)).toEqual([
      'task Riser comment 6', 'project Riser message 5', 'task Riser comment 4', 'project Riser message 3', 'task Riser comment 2',
    ]);
  });

  it('gives the comment id as the id of the hit and the task as its chat', async () => {
    const t = world();
    const id = t.note('tsk_001', 'usr_002', 'Riser size', 1);
    t.as('usr_003');
    expect((await t.api.call('search.query', { text: 'riser' })).messages[0]).toMatchObject({ id, chatId: 'tsk_001', at: '2026-09-30T10:01:00.000+03:00' });
  });
});
