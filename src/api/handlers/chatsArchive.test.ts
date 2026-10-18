import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { projectCalls } from './projects';
import { addProjectConversation, isArchived } from '../chatState';
import { chatReadKey } from '../store';
import { makeTask, makeUser, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const calls = { ...chatCalls, ...contentCalls, ...projectCalls };

// Hala is the Admin, Faisal leads the project, Sara (usr_003) is on the team, Omar (usr_004) is outside.
function world() {
  const t = testApi(calls);
  const room = addProjectConversation(t.store.state, 'prj_001', STAMP);
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Madar Second', kind: 'agent', discipline: 'Agent', ownerId: 'usr_002' });
  return { ...t, room: room.id };
}

/** The error code of a call, or "ok" when it answers. */
const codeOf = (promise: Promise<unknown>) => promise.then(() => 'ok', (error: { code: string }) => error.code);

describe('chats.archive', () => {
  it('moves a chat to the archive, and chats.list shows archived: true', async () => {
    const t = world();
    t.as('usr_003');
    expect((await t.api.call('chats.list', {})).find((row) => row.id === t.room)?.archived).toBe(false);
    await t.api.call('chats.archive', { conversationId: t.room, archived: true });
    expect((await t.api.call('chats.list', {})).find((row) => row.id === t.room)?.archived).toBe(true);
  });

  it('brings the chat back when another person writes after the archive', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('chats.archive', { conversationId: t.room, archived: true });
    setNow(new Date(NOW.getTime() + 60_000));
    t.as('usr_001');
    await t.api.call('chats.send', { conversationId: t.room, body: 'Any update on the beam?' });
    t.as('usr_003');
    expect((await t.api.call('chats.list', {})).find((row) => row.id === t.room)?.archived).toBe(false);
  });

  it('brings the chat back when the person writes after the archive', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('chats.archive', { conversationId: t.room, archived: true });
    setNow(new Date(NOW.getTime() + 60_000));
    await t.api.call('chats.send', { conversationId: t.room, body: 'I will check it.' });
    expect(t.store.state.chatReads[chatReadKey(t.room, 'usr_003')]?.archivedAt).toBe(STAMP);
    expect((await t.api.call('chats.list', {})).find((row) => row.id === t.room)?.archived).toBe(false);
  });

  it('keeps the archive mark when the person reads the chat', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('chats.archive', { conversationId: t.room, archived: true });
    await t.api.call('chats.markRead', { conversationId: t.room });
    expect(t.store.state.chatReads[chatReadKey(t.room, 'usr_003')]?.archivedAt).toBe(STAMP);
    expect((await t.api.call('chats.list', {})).find((row) => row.id === t.room)?.archived).toBe(true);
  });

  it('moves the chat back to the inbox when archived is false', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('chats.archive', { conversationId: t.room, archived: true });
    await t.api.call('chats.archive', { conversationId: t.room, archived: false });
    expect((await t.api.call('chats.list', {})).find((row) => row.id === t.room)?.archived).toBe(false);
  });

  it('writes no event and does not mark an unread chat read', async () => {
    const t = world();
    t.as('usr_001');
    await t.api.call('chats.send', { conversationId: t.room, body: 'Please check the riser.' });
    t.as('usr_003');
    const events = Object.keys(t.store.state.events).length;
    await t.api.call('chats.archive', { conversationId: t.room, archived: true });
    expect(Object.keys(t.store.state.events)).toHaveLength(events);
    expect((await t.api.call('chats.list', {})).find((row) => row.id === t.room)?.unread).toBe(1);
  });

  it('archives a task thread that the person may read', async () => {
    const t = world();
    t.store.state.tasks.tsk_001 = makeTask();
    t.as('usr_003');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Started the plan.' });
    await t.api.call('chats.archive', { conversationId: 'tsk_001', archived: true });
    expect((await t.api.call('chats.list', {})).find((row) => row.id === 'tsk_001')?.archived).toBe(true);
  });

  it('answers a chat the person cannot open as chats.markRead does', async () => {
    const t = world();
    t.as('usr_004');
    const marked = await codeOf(t.api.call('chats.markRead', { conversationId: t.room }));
    expect(marked).toBe('forbidden');
    expect(await codeOf(t.api.call('chats.archive', { conversationId: t.room, archived: true }))).toBe(marked);
    expect(t.store.state.chatReads[chatReadKey(t.room, 'usr_004')]).toBeUndefined();
  });

  it('answers an office task the person cannot see as chats.markRead does', async () => {
    const t = world();
    t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', projectId: null, stageId: null, ownerId: 'usr_003', createdBy: 'usr_003' });
    t.as('usr_003');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_002', body: 'Office note.' });
    expect(await codeOf(t.api.call('chats.archive', { conversationId: 'tsk_002', archived: true }))).toBe('ok');
    t.as('usr_004');
    const marked = await codeOf(t.api.call('chats.markRead', { conversationId: 'tsk_002' }));
    expect(marked).toBe('not_found');
    expect(await codeOf(t.api.call('chats.archive', { conversationId: 'tsk_002', archived: true }))).toBe(marked);
    expect(t.store.state.chatReads[chatReadKey('tsk_002', 'usr_004')]).toBeUndefined();
  });

  it('answers a missing chat as chats.markRead does', async () => {
    const t = world();
    t.as('usr_001');
    const marked = await codeOf(t.api.call('chats.markRead', { conversationId: 'cnv_999' }));
    expect(await codeOf(t.api.call('chats.archive', { conversationId: 'cnv_999', archived: true }))).toBe(marked);
  });
});

describe('isArchived', () => {
  const read = { conversationId: 'cnv_001', userId: 'usr_003', lastReadAt: STAMP };

  it('is false with no archive mark', () => {
    expect(isArchived(undefined, STAMP)).toBe(false);
    expect(isArchived({ ...read, archivedAt: null }, STAMP)).toBe(false);
  });

  it('is true while no message is newer than the archive', () => {
    expect(isArchived({ ...read, archivedAt: '2026-09-30T10:00:00.000+03:00' }, '2026-09-30T09:00:00.000+03:00')).toBe(true);
    expect(isArchived({ ...read, archivedAt: '2026-09-30T10:00:00.000+03:00' }, '2026-09-30T10:00:00.000+03:00')).toBe(true);
  });

  it('is false once a message is newer than the archive', () => {
    expect(isArchived({ ...read, archivedAt: '2026-09-30T10:00:00.000+03:00' }, '2026-09-30T10:00:01.000+03:00')).toBe(false);
  });
});
