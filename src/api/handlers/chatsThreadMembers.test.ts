import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { projectCalls } from './projects';
import { taskCalls } from './tasks';
import { mentionMarkup } from '../../lib/text';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * Who is part of a to-do thread (owner report, chat, 2026-11-08: "i send a message for moataz on to-do ... we tried on mobile reach the
 * message, but we didn't reach"). A person is part of the thread, and so has it in the Inbox, when the person is its lead, the leader of
 * its project (or the maker of an office to-do), a person who commented, a HELPER of the to-do, or a person NAMED with @ in a message of
 * the thread. The view rule stays: a person who may not view the to-do never gets the thread. Sara (usr_003) leads tsk_001, Faisal
 * (usr_002) leads the project, Omar (usr_004) is outside the team, Hala (usr_001) is the Admin.
 */
const calls = { ...chatCalls, ...contentCalls, ...projectCalls, ...taskCalls };
type World = ReturnType<typeof world>;

function world(task: Parameters<typeof makeTask>[0] = {}) {
  const t = testApi(calls);
  t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_003', ...task });
  return t;
}

let tick = 0;
async function say(t: World, userId: string, body: string, taskId = 'tsk_001') {
  tick += 1;
  setNow(new Date(NOW.getTime() + tick * 60_000));
  t.as(userId);
  await t.api.call('comments.create', { targetType: 'task', targetId: taskId, body });
}

/** A comment written straight into the state, for a thread that the author could not write in by the call (an office to-do). */
function plant(t: World, authorId: string, body: string, taskId = 'tsk_001') {
  tick += 1;
  const id = `cmt_9${String(tick).padStart(2, '0')}`;
  const createdAt = new Date(NOW.getTime() + tick * 60_000).toISOString();
  t.store.state.comments[id] = { id, targetType: 'task', targetId: taskId, authorId, body, reactions: { '👍': [], '✅': [], '👀': [] }, fileIds: [], createdAt, editedAt: null };
}

const named = (name: string, id: string) => `${mentionMarkup(name, id)} please look at this.`;
const threadOf = async (t: World, userId: string, taskId = 'tsk_001') => {
  t.as(userId);
  return (await t.api.call('chats.list', {})).find((row) => row.id === taskId);
};
const badge = async (t: World, userId: string) => {
  t.as(userId);
  return (await t.api.call('chats.unreadCount', {})).unread;
};

describe('a helper of a to-do has its thread in the Inbox (chat, 2026-11-08)', () => {
  it('shows the thread to a helper who never commented, with its unread number', async () => {
    const t = world({ helperIds: ['usr_004'] });
    await say(t, 'usr_002', 'Please send the door schedule.');
    await say(t, 'usr_003', 'Sending it now.');
    const row = await threadOf(t, 'usr_004');
    expect(row).toMatchObject({ kind: 'task', id: 'tsk_001', unread: 2 });
    expect(await badge(t, 'usr_004')).toBe(2);
  });

  it('gives the to-do row of the helper the same number as the Inbox row', async () => {
    const t = world({ helperIds: ['usr_004'] });
    await say(t, 'usr_002', 'Please send the door schedule.');
    t.as('usr_004');
    const rows = await t.api.call('tasks.list', {});
    expect(rows.find((row) => row.task.id === 'tsk_001')?.unreadCount).toBe(1);
    t.as('usr_004');
    await t.api.call('chats.markRead', { conversationId: 'tsk_001' });
    expect((await t.api.call('tasks.list', {})).find((row) => row.task.id === 'tsk_001')?.unreadCount).toBe(0);
    expect((await threadOf(t, 'usr_004'))?.unread).toBe(0);
  });

  it('shows no thread for a person who is not a helper, and none for a to-do with no comment', async () => {
    const t = world({ helperIds: ['usr_004'] });
    expect(await threadOf(t, 'usr_004')).toBeUndefined();
    await say(t, 'usr_002', 'Please send the door schedule.');
    t.store.state.tasks.tsk_001.helperIds = [];
    expect(await threadOf(t, 'usr_004')).toBeUndefined();
  });

  it('leaves the thread when the helper is taken off the to-do', async () => {
    const t = world({ helperIds: ['usr_004'] });
    await say(t, 'usr_002', 'Please send the door schedule.');
    expect(await threadOf(t, 'usr_004')).toBeDefined();
    t.store.state.tasks.tsk_001.helperIds = [];
    expect(await threadOf(t, 'usr_004')).toBeUndefined();
  });
});

describe('a person named with @ in a message has the thread in the Inbox (chat, 2026-11-08)', () => {
  it('shows the thread to a person who was named and never commented', async () => {
    const t = world();
    await say(t, 'usr_002', named('Omar Other', 'usr_004'));
    await say(t, 'usr_003', 'I will check.');
    const row = await threadOf(t, 'usr_004');
    expect(row).toMatchObject({ kind: 'task', id: 'tsk_001', unread: 2 });
    expect(await badge(t, 'usr_004')).toBe(2);
    t.as('usr_004');
    expect((await t.api.call('tasks.list', {})).find((r) => r.task.id === 'tsk_001')?.unreadCount).toBe(2);
  });

  it('counts every message of other people that the named person has not read, also the ones before the name', async () => {
    const t = world();
    await say(t, 'usr_003', 'Start.');
    await say(t, 'usr_002', named('Omar Other', 'usr_004'));
    for (let n = 0; n < 3; n += 1) await say(t, 'usr_003', `Later ${n}.`);
    expect((await threadOf(t, 'usr_004'))?.unread).toBe(5);
  });

  it('does not count a name in a quiet line (a reason of a date move) as a mention', async () => {
    const t = world();
    await say(t, 'usr_002', 'A plain message.');
    plant(t, 'usr_002', named('Omar Other', 'usr_004'));
    const line = Object.values(t.store.state.comments).at(-1)!;
    line.kind = 'reopened';
    expect(await threadOf(t, 'usr_004')).toBeUndefined();
    delete line.kind;
    expect(await threadOf(t, 'usr_004')).toBeDefined();
  });

  it('does not make another person part of the thread, not even the Admin', async () => {
    const t = world();
    await say(t, 'usr_002', named('Omar Other', 'usr_004'));
    expect(await threadOf(t, 'usr_001')).toBeUndefined();
    t.store.state.users.usr_009 = { ...t.store.state.users.usr_004, id: 'usr_009', name: 'Third Person', email: 'third@example.com' };
    expect(await threadOf(t, 'usr_009')).toBeUndefined();
  });

  it('gives the agent of a named person the thread of that person', async () => {
    const t = world();
    t.store.state.users.usr_006 = { ...t.store.state.users.usr_005, id: 'usr_006', name: 'Omar Assistant', ownerId: 'usr_004' };
    await say(t, 'usr_002', named('Omar Other', 'usr_004'));
    expect(await threadOf(t, 'usr_006')).toMatchObject({ kind: 'task', id: 'tsk_001' });
  });
});

describe('the view rule stays: a named person or a helper who may not view the to-do gets no thread (chat, 2026-11-08)', () => {
  it('gives a person named in a thread of a hidden project nothing, in every read of the Inbox', async () => {
    const t = world();
    await say(t, 'usr_002', named('Omar Other', 'usr_004'));
    expect(await threadOf(t, 'usr_004')).toBeDefined();
    t.as('usr_002');
    await t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: [] });
    expect(await threadOf(t, 'usr_004')).toBeUndefined();
    expect(await badge(t, 'usr_004')).toBe(0);
    t.as('usr_004');
    expect(await t.api.call('chats.waiting', {})).toEqual([]);
    expect((await t.api.call('tasks.list', {})).every((row) => row.task.id !== 'tsk_001')).toBe(true);
  });

  it('gives a helper of a hidden project nothing as long as the project does not show to the helper', async () => {
    const t = world({ helperIds: ['usr_004'] });
    await say(t, 'usr_002', 'A private note.');
    t.as('usr_002');
    await t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: [] });
    expect(await threadOf(t, 'usr_004')).toBeUndefined();
    expect(await badge(t, 'usr_004')).toBe(0);
  });

  it('gives a person named in an office to-do that the person may not see nothing', async () => {
    const t = world();
    t.store.state.tasks.tsk_300 = makeTask({ id: 'tsk_300', projectId: null, stageId: null, ownerId: 'usr_003', createdBy: 'usr_003', title: 'Office job' });
    plant(t, 'usr_003', named('Omar Other', 'usr_004'), 'tsk_300');
    expect(await threadOf(t, 'usr_004', 'tsk_300')).toBeUndefined();
    expect(await badge(t, 'usr_004')).toBe(0);
    t.as('usr_004');
    expect((await t.api.call('tasks.list', {})).every((row) => row.task.id !== 'tsk_300')).toBe(true);
    // The people of the office to-do keep it: its lead, its maker.
    expect(await threadOf(t, 'usr_003', 'tsk_300')).toBeDefined();
  });

  it('gives a helper of an office to-do its thread, as that person sees the to-do', async () => {
    const t = world();
    t.store.state.tasks.tsk_300 = makeTask({ id: 'tsk_300', projectId: null, stageId: null, ownerId: 'usr_003', createdBy: 'usr_003', helperIds: ['usr_004'], title: 'Office job' });
    plant(t, 'usr_003', 'Please help with the file.', 'tsk_300');
    expect(await threadOf(t, 'usr_004', 'tsk_300')).toMatchObject({ kind: 'task', id: 'tsk_300', unread: 1 });
    expect(await threadOf(t, 'usr_002', 'tsk_300')).toBeUndefined();
  });

  it('gives a person who left the office no thread, also when named', async () => {
    const t = world({ helperIds: ['usr_004'] });
    await say(t, 'usr_002', named('Omar Other', 'usr_004'));
    t.store.state.users.usr_004.active = false;
    expect(await threadOf(t, 'usr_004')).toBeUndefined();
    expect(await badge(t, 'usr_004')).toBe(0);
  });

  it('opens no thread by id for a named person who may not view it (chats.markRead and chats.archive answer not_found)', async () => {
    const t = world();
    t.store.state.tasks.tsk_300 = makeTask({ id: 'tsk_300', projectId: null, stageId: null, ownerId: 'usr_003', createdBy: 'usr_003', title: 'Office job' });
    plant(t, 'usr_003', named('Omar Other', 'usr_004'), 'tsk_300');
    t.as('usr_004');
    await expect(t.api.call('chats.markRead', { conversationId: 'tsk_300' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_300' })).rejects.toBeDefined();
  });
});
