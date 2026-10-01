import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { projectCalls } from './projects';
import { addProjectConversation } from '../chatState';
import { chatReadKey, memberKey } from '../store';
import { makeTask, makeUser, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const calls = { ...chatCalls, ...contentCalls, ...projectCalls };

// Hala is the Admin, Faisal leads the project, Sara is on the team, Omar is outside. The assistant acts for Sara.
function world() {
  const t = testApi(calls);
  const room = addProjectConversation(t.store.state, 'prj_001', STAMP);
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Madar Second', kind: 'agent', discipline: 'Agent', ownerId: 'usr_002' });
  return { ...t, room: room.id };
}

describe('chat permissions', () => {
  it('lets the team and the Admin into a project chat and sends outsiders away', async () => {
    const t = world();
    for (const userId of ['usr_001', 'usr_002', 'usr_003']) {
      t.as(userId);
      expect((await t.api.call('chats.messages', { conversationId: t.room })).chat.kind).toBe('project');
    }
    t.as('usr_004');
    await expect(t.api.call('chats.messages', { conversationId: t.room })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('chats.send', { conversationId: t.room, body: 'Hello' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('chats.markRead', { conversationId: t.room })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await t.api.call('chats.list', {})).some((row) => row.id === t.room)).toBe(false);
  });

  it('lets the Admin post in a project chat she is not on', async () => {
    const t = world();
    t.as('usr_001');
    const sent = await t.api.call('chats.send', { conversationId: t.room, body: 'Please share the schedule.' });
    expect(sent.mine).toBe(true);
    expect((await t.api.call('chats.list', {})).find((row) => row.id === t.room)?.preview).toBe('Please share the schedule.');
  });

  it('keeps a direct chat to its two people', async () => {
    const t = world();
    t.as('usr_003');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_002' });
    await t.api.call('chats.send', { conversationId: id, body: 'Do you have a minute?' });
    t.as('usr_004');
    await expect(t.api.call('chats.messages', { conversationId: id })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('chats.send', { conversationId: id, body: 'Hi' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_001');
    await expect(t.api.call('chats.messages', { conversationId: id })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await t.api.call('chats.list', {})).some((row) => row.id === id)).toBe(false);
    t.as('usr_002');
    const thread = await t.api.call('chats.messages', { conversationId: id });
    expect(thread.chat).toMatchObject({ kind: 'direct', title: 'Sara Team' });
    expect(thread.messages).toHaveLength(1);
  });

  it('refuses a direct chat with yourself, with your own agent and with an agent', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('chats.openDirect', { userId: 'usr_003' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('chats.openDirect', { userId: 'usr_005' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('chats.openDirect', { userId: 'usr_006' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('finds the same direct chat from both sides and makes it only once', async () => {
    const t = world();
    t.as('usr_003');
    const first = await t.api.call('chats.openDirect', { userId: 'usr_004' });
    expect(await t.api.call('chats.openDirect', { userId: 'usr_004' })).toEqual(first);
    t.as('usr_004');
    expect(await t.api.call('chats.openDirect', { userId: 'usr_003' })).toEqual(first);
    expect(Object.values(t.store.state.conversations).filter((c) => c.kind === 'direct')).toHaveLength(1);
  });

  it('lets an agent act for its person in a direct chat', async () => {
    const t = world();
    t.as('usr_005');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_002' });
    expect(t.store.state.conversations[id].memberIds).toEqual(['usr_002', 'usr_003']);
    const sent = await t.api.call('chats.send', { conversationId: id, body: 'The assistant here.' });
    expect(sent.message).toMatchObject({ authorId: 'usr_005', actingForId: 'usr_003' });
    expect(sent.author.kind).toBe('agent');
    expect(sent.actingFor?.id).toBe('usr_003');
  });
});

describe('chat messages and unread counts', () => {
  it('counts unread messages from other people and clears them when the chat is read', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: t.room, body: 'One' });
    await t.api.call('chats.send', { conversationId: t.room, body: 'Two' });
    t.as('usr_003');
    expect(await t.api.call('chats.unreadCount', {})).toEqual({ unread: 2 });
    expect((await t.api.call('chats.list', {})).find((row) => row.id === t.room)?.unread).toBe(2);
    expect(await t.api.call('chats.markRead', { conversationId: t.room })).toEqual({ unread: 0 });
    expect(t.store.state.chatReads[chatReadKey(t.room, 'usr_003')]).toBeDefined();
    t.as('usr_002');
    expect(await t.api.call('chats.unreadCount', {})).toEqual({ unread: 0 });
  });

  it('does not count my own messages or my own agent messages', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('chats.send', { conversationId: t.room, body: 'From me' });
    t.as('usr_005');
    await t.api.call('chats.send', { conversationId: t.room, body: 'From my agent' });
    t.as('usr_003');
    expect(await t.api.call('chats.unreadCount', {})).toEqual({ unread: 0 });
  });

  it('returns messages oldest first and rejects an empty or long body', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: t.room, body: 'First' });
    await t.api.call('chats.send', { conversationId: t.room, body: 'Second' });
    expect((await t.api.call('chats.messages', { conversationId: t.room })).messages.map((m) => m.message.body)).toEqual(['First', 'Second']);
    await expect(t.api.call('chats.send', { conversationId: t.room, body: '   ' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('chats.send', { conversationId: t.room, body: 'x'.repeat(4001) })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('lists a task thread for the owner, the leader and a commenter, only when the task has a comment', async () => {
    const t = world();
    t.store.state.tasks.tsk_001 = makeTask();
    t.as('usr_003');
    expect((await t.api.call('chats.list', {})).some((row) => row.kind === 'task')).toBe(false);
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Started the plan.' });
    const row = (await t.api.call('chats.list', {})).find((r) => r.kind === 'task');
    expect(row).toMatchObject({ id: 'tsk_001', taskId: 'tsk_001', title: 'Ground floor plan', preview: 'Started the plan.', previewMine: true });
    t.as('usr_002');
    expect((await t.api.call('chats.list', {})).some((r) => r.kind === 'task')).toBe(true);
    t.as('usr_004');
    expect((await t.api.call('chats.list', {})).some((r) => r.kind === 'task')).toBe(false);
  });
});

describe('task threads follow the comment read rule', () => {
  it('shows a thread to a removed member exactly when comments.list lets them read it', async () => {
    const t = world();
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_002' });
    t.as('usr_003');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'My note.' });
    delete t.store.state.members[memberKey('prj_001', 'usr_003')];
    const comments = await t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_001' }).then((list) => list.length, (error: { code: string }) => error.code);
    const thread = (await t.api.call('chats.list', {})).some((row) => row.kind === 'task');
    expect(comments).toBe(1);
    expect(thread).toBe(true);
    // A deactivated person gets neither the comments nor the thread.
    t.store.state.users.usr_003.active = false;
    await expect(t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_001' })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await t.api.call('chats.list', {})).some((row) => row.kind === 'task')).toBe(false);
  });
});

describe('chat mentions', () => {
  it('notifies the mentioned person and never the author or the author agent', async () => {
    const t = world();
    t.as('usr_003');
    const body = 'Please check @[Faisal Leader](usr_002), @[Sara Team](usr_003) and @[Madar Assistant](usr_005).';
    await t.api.call('chats.send', { conversationId: t.room, body });
    const notices = Object.values(t.store.state.notifications);
    expect(notices.map((n) => n.userId)).toEqual(['usr_002']);
    expect(notices[0]).toMatchObject({ trigger: 'mention', targetType: 'chat', targetId: t.room, actorId: 'usr_003' });
  });

  it('does not notify the person an agent acts for', async () => {
    const t = world();
    t.as('usr_005');
    await t.api.call('chats.send', { conversationId: t.room, body: 'Hello @[Sara Team](usr_003) and @[Faisal Leader](usr_002).' });
    expect(Object.values(t.store.state.notifications).map((n) => n.userId)).toEqual(['usr_002']);
  });

  it('does not notify a person who cannot see the chat', async () => {
    const t = world();
    t.as('usr_003');
    const sent = await t.api.call('chats.send', { conversationId: t.room, body: 'Hello @[Omar Other](usr_004).' });
    expect(sent.message.mentions).toEqual([]);
    expect(Object.values(t.store.state.notifications)).toHaveLength(0);
  });

  it('opens the chat from the notice of the mentioned person', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('chats.send', { conversationId: t.room, body: 'Look @[Faisal Leader](usr_002).' });
    t.as('usr_002');
    const [view] = await (async () => testApiNotices(t))();
    expect(view).toMatchObject({ link: `/inbox/${t.room}`, target: 'Test Tower', gone: false });
  });
});

describe('project chat life', () => {
  it('makes a chat for a new project and removes it with the project', async () => {
    const t = world();
    t.as('usr_001');
    const project = await t.api.call('projects.create', { name: 'New Library', leader: 'usr_002', teamIds: ['usr_003'] });
    const room = Object.values(t.store.state.conversations).find((c) => c.projectId === project.project.id);
    expect(room?.kind).toBe('project');
    await t.api.call('chats.send', { conversationId: room?.id ?? '', body: 'Welcome.' });
    await t.api.call('projects.delete', { id: project.project.id, confirm: true });
    expect(Object.values(t.store.state.conversations).some((c) => c.projectId === project.project.id)).toBe(false);
    expect(Object.values(t.store.state.messages).some((m) => m.conversationId === room?.id)).toBe(false);
  });
});

async function testApiNotices(t: ReturnType<typeof world>) {
  const { notificationCalls } = await import('./notifications');
  const { createApi } = await import('../client');
  const api = createApi({ ...notificationCalls }, { store: t.store, latencyMs: 0 });
  return api.call('notifications.list', {});
}
