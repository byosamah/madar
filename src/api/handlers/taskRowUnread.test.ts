import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { projectCalls } from './projects';
import { taskCalls } from './tasks';
import { TaskRow } from '../contract/views';
import { chatReadKey } from '../store';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The unread number of a to-do row (fbk_071, owner 2026-10-27). The chat icon of a row shows a number only for the comments that the
 * person has not read, and no number when all are read. The rule is the one of the Inbox thread (chats.list): comments by other people
 * after the read mark and after the own last message. A person who is no part of the thread (not the lead, not the leader, no comment of
 * their own) has no unread number. Sara (usr_003) leads the to-do, Faisal (usr_002) leads the project, Omar (usr_004) is outside.
 */
const calls = { ...chatCalls, ...contentCalls, ...projectCalls, ...taskCalls };
type World = ReturnType<typeof world>;

function world() {
  const t = testApi(calls);
  t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_003' });
  return t;
}

let tick = 0;
/** One comment of a person. Each comment gets a later time, so the order is clear. */
async function say(t: World, userId: string, body: string, taskId = 'tsk_001') {
  tick += 1;
  setNow(new Date(NOW.getTime() + tick * 60_000));
  t.as(userId);
  await t.api.call('comments.create', { targetType: 'task', targetId: taskId, body });
}

/** A comment of a person who may not write in the thread (an outsider, an old comment): Faisal writes it, then the author changes. */
async function plant(t: World, authorId: string, body: string, taskId = 'tsk_001') {
  await say(t, 'usr_002', body, taskId);
  const planted = Object.values(t.store.state.comments).filter((c) => c.targetId === taskId).at(-1)!;
  planted.authorId = authorId;
}

const rowOf = async (t: World, userId: string, taskId = 'tsk_001') => {
  t.as(userId);
  return (await t.api.call('tasks.list', {})).find((row) => row.task.id === taskId);
};
const unreadOf = async (t: World, userId: string, taskId = 'tsk_001') => (await rowOf(t, userId, taskId))?.unreadCount;

describe('tasks.list gives each row the unread number of the person who looks', () => {
  it('counts the comments of other people, never the own ones, and keeps the total in commentCount', async () => {
    const t = world();
    await say(t, 'usr_003', 'Started the plan.');
    expect(await unreadOf(t, 'usr_003')).toBe(0);
    await say(t, 'usr_002', 'Please fix the door schedule.');
    await say(t, 'usr_001', 'Also the stairs.');
    expect(await unreadOf(t, 'usr_003')).toBe(2);
    expect((await rowOf(t, 'usr_003'))?.commentCount).toBe(3);
  });

  it('is gone when the person opens the thread, and comes back with the next comment of another person', async () => {
    const t = world();
    await say(t, 'usr_002', 'Please fix the door schedule.');
    expect(await unreadOf(t, 'usr_003')).toBe(1);
    t.as('usr_003');
    await t.api.call('chats.markRead', { conversationId: 'tsk_001' });
    expect(await unreadOf(t, 'usr_003')).toBe(0);
    // The total stays: the number on the row is the unread part only.
    expect((await rowOf(t, 'usr_003'))?.commentCount).toBe(1);
    await say(t, 'usr_002', 'One more thing.');
    expect(await unreadOf(t, 'usr_003')).toBe(1);
  });

  it('counts only the comments after the own last comment', async () => {
    const t = world();
    await say(t, 'usr_002', 'Please fix the door schedule.');
    await say(t, 'usr_003', 'Done.');
    expect(await unreadOf(t, 'usr_003')).toBe(0);
    await say(t, 'usr_002', 'Thanks.');
    expect(await unreadOf(t, 'usr_003')).toBe(1);
  });

  it('counts a comment of the own agent as an own comment', async () => {
    const t = world();
    await say(t, 'usr_002', 'Please fix the door schedule.');
    await say(t, 'usr_005', 'The assistant of Sara answers.');
    expect(await unreadOf(t, 'usr_003')).toBe(0);
    await say(t, 'usr_002', 'Thanks.');
    expect(await unreadOf(t, 'usr_003')).toBe(1);
  });

  it('shows 1 at least for a thread that the person marked unread, as the Inbox does', async () => {
    const t = world();
    await say(t, 'usr_002', 'Please fix the door schedule.');
    t.as('usr_003');
    await t.api.call('chats.markRead', { conversationId: 'tsk_001' });
    expect(await unreadOf(t, 'usr_003')).toBe(0);
    await t.api.call('chats.markUnread', { conversationId: 'tsk_001' });
    expect(await unreadOf(t, 'usr_003')).toBe(1);
    await t.api.call('chats.markRead', { conversationId: 'tsk_001' });
    expect(await unreadOf(t, 'usr_003')).toBe(0);
  });

  it('gives a person who is no part of the thread no number, and keeps the total', async () => {
    const t = world();
    await say(t, 'usr_002', 'Please fix the door schedule.');
    await say(t, 'usr_003', 'Done.');
    await say(t, 'usr_002', 'Thanks.');
    const omar = await rowOf(t, 'usr_004');
    expect(omar?.commentCount).toBe(3);
    expect(omar?.unreadCount).toBe(0);
    // Once Omar writes a comment he is part of the thread, as in the Inbox.
    await plant(t, 'usr_004', 'May I join?');
    await say(t, 'usr_002', 'Yes.');
    expect(await unreadOf(t, 'usr_004')).toBe(1);
  });

  it('gives the agent of a person the number of that person, and the own agent never reads it away', async () => {
    const t = world();
    await say(t, 'usr_002', 'Please fix the door schedule.');
    // The agent of Sara (usr_005) lists the to-dos with the rights and the read marks of Sara.
    expect(await unreadOf(t, 'usr_005')).toBe(1);
    t.as('usr_003');
    await t.api.call('chats.markRead', { conversationId: 'tsk_001' });
    expect(await unreadOf(t, 'usr_005')).toBe(0);
  });

  it('gives the project leader the number of the thread, as the Inbox does', async () => {
    const t = world();
    await say(t, 'usr_003', 'Question about the door.');
    expect(await unreadOf(t, 'usr_002')).toBe(1);
  });

  it('is the same number as the unread of the Inbox row of the thread, for every person', async () => {
    const t = world();
    t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_002', title: 'Second' });
    await say(t, 'usr_002', 'One.');
    await say(t, 'usr_001', 'Two.');
    await say(t, 'usr_003', 'Three.');
    await say(t, 'usr_003', 'Four.', 'tsk_002');
    for (const userId of ['usr_001', 'usr_002', 'usr_003']) {
      t.as(userId);
      const inbox = (await t.api.call('chats.list', {})).filter((row) => row.kind === 'task');
      for (const thread of inbox) expect(await unreadOf(t, userId, thread.id), `${userId} ${thread.id}`).toBe(thread.unread);
    }
  });

  it('gives a to-do with no comment 0', async () => {
    const t = world();
    expect(await unreadOf(t, 'usr_003')).toBe(0);
  });

  it('leaves the field out of tasks.get, which has no chat icon, and the old answers still parse', async () => {
    const t = world();
    await say(t, 'usr_002', 'Please fix the door schedule.');
    t.as('usr_003');
    const detail = await t.api.call('tasks.get', { id: 'tsk_001' });
    expect(detail.unreadCount).toBeUndefined();
    expect(detail.commentCount).toBe(1);
    const { unreadCount: _gone, ...old } = (await rowOf(t, 'usr_003'))!;
    expect(TaskRow.safeParse(old).success).toBe(true);
  });
});

describe('the unread number never leaks a thread that the person may not see (fbk_071)', () => {
  it('gives an outsider no row of a hidden project, and the owner still has the number', async () => {
    const t = world();
    await say(t, 'usr_002', 'A private note.');
    t.as('usr_002');
    await t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: [] });
    expect(await rowOf(t, 'usr_004')).toBeUndefined();
    expect(await unreadOf(t, 'usr_003')).toBe(1);
    // A person who wrote a comment before the project got hidden loses the row too.
    await plant(t, 'usr_004', 'Old note.');
    t.as('usr_004');
    expect((await t.api.call('tasks.list', {})).every((row) => row.task.projectId !== 'prj_001')).toBe(true);
  });

  it('gives a person who may not see an office task no row, and so no number', async () => {
    const t = world();
    t.store.state.tasks.tsk_300 = makeTask({ id: 'tsk_300', projectId: null, stageId: null, ownerId: 'usr_003', createdBy: 'usr_003', title: 'Office job' });
    await say(t, 'usr_001', 'Please finish the file.', 'tsk_300');
    expect(await unreadOf(t, 'usr_003', 'tsk_300')).toBe(1);
    expect(await rowOf(t, 'usr_004', 'tsk_300')).toBeUndefined();
    expect(await rowOf(t, 'usr_002', 'tsk_300')).toBeUndefined();
  });

  it('counts a comment of any other person, also one who is outside the thread', async () => {
    const t = world();
    await say(t, 'usr_002', 'Please fix the door schedule.');
    // Sara reads the thread. A later comment of Omar (outside the thread) is still a comment of another person and counts.
    t.as('usr_003');
    await t.api.call('chats.markRead', { conversationId: 'tsk_001' });
    await plant(t, 'usr_004', 'Outside note.');
    expect(await unreadOf(t, 'usr_003')).toBe(1);
    expect(t.store.state.chatReads[chatReadKey('tsk_001', 'usr_003')]).toBeDefined();
  });
});
