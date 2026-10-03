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

describe('chat pages (plan 4.13, A5; AM 7.5)', () => {
  /** 450 messages in the project room. Three messages share each stamp, so a page that splits by stamp alone would lose some. */
  function longRoom() {
    const t = world();
    for (let i = 0; i < 450; i += 1) {
      const id = `msg_${String(i + 1).padStart(3, '0')}`;
      const second = Math.floor(i / 3);
      const at = `2026-09-29T${String(8 + Math.floor(second / 60)).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}:00.000+03:00`;
      t.store.state.messages[id] = {
        id, conversationId: t.room, authorId: 'usr_002', actingForId: 'usr_002', body: `Message ${i + 1}`, mentions: [], fileIds: [], createdAt: at, editedAt: null,
      };
    }
    t.as('usr_003');
    return t;
  }
  const bodies = (thread: { messages: { message: { body: string } }[] }) => thread.messages.map((m) => m.message.body);
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `Message ${from + i}`);

  it('returns the newest 200 messages by default, oldest first', async () => {
    const t = longRoom();
    expect(bodies(await t.api.call('chats.messages', { conversationId: t.room }))).toEqual(range(251, 450));
  });

  it('pages back through all 450 messages with before and limit, and loses none', async () => {
    const t = longRoom();
    const seen: string[] = [];
    let before: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const thread = await t.api.call('chats.messages', { conversationId: t.room, limit: 100, ...(before ? { before } : {}) });
      if (thread.messages.length === 0) break;
      seen.unshift(...bodies(thread));
      before = thread.messages[0].message.id;
    }
    expect(seen).toEqual(range(1, 450));
    const page = await t.api.call('chats.messages', { conversationId: t.room, limit: 7, before: 'msg_101' });
    expect(bodies(page)).toEqual(range(94, 100));
  });

  it('refuses a page start that is not a message of this chat, and a limit out of range', async () => {
    const t = longRoom();
    await expect(t.api.call('chats.messages', { conversationId: t.room, before: 'msg_999' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('chats.messages', { conversationId: t.room, limit: 0 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('chats.messages', { conversationId: t.room, limit: 501 })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('keeps the newest 100 task threads in chats.list, and counts unread only in those', async () => {
    const t = world();
    const s = t.store.state;
    for (let i = 0; i < 105; i += 1) {
      const taskId = `tsk_${String(i + 1).padStart(3, '0')}`;
      s.tasks[taskId] = makeTask({ id: taskId, ownerId: 'usr_003' });
      const at = `2026-09-${String(1 + Math.floor(i / 5)).padStart(2, '0')}T09:${String(i % 60).padStart(2, '0')}:00.000+03:00`;
      s.comments[`cmt_${String(i + 1).padStart(3, '0')}`] = {
        id: `cmt_${String(i + 1).padStart(3, '0')}`, targetType: 'task', targetId: taskId, authorId: 'usr_002', body: `Note ${i + 1}`,
        reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: at, editedAt: null,
      };
    }
    t.as('usr_003');
    const rows = (await t.api.call('chats.list', {})).filter((row) => row.kind === 'task');
    expect(rows).toHaveLength(100);
    expect(rows.map((row) => row.id)).not.toContain('tsk_001');
    expect(rows.map((row) => row.id)).toContain('tsk_105');
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(100);
  });
});
