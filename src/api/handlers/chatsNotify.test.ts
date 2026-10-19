import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { projectCalls } from './projects';
import { addDirectConversation, addGroupConversation, addProjectConversation } from '../chatState';
import { chatReadKey } from '../store';
import { makeTask, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const calls = { ...chatCalls, ...contentCalls, ...projectCalls };

/**
 * chats.setNotify keeps the "Notify me" choice of one person for one chat (chat design item 21). Hala (usr_001) is the Admin, Faisal
 * (usr_002) leads prj_001, Sara (usr_003) is on the team, Omar (usr_004) is outside. A direct chat of Faisal and Sara, and a group of
 * Faisal, Sara and Hala.
 */
function world() {
  const t = testApi(calls);
  const room = addProjectConversation(t.store.state, 'prj_001', STAMP);
  const direct = addDirectConversation(t.store.state, 'usr_002', 'usr_003', STAMP);
  const group = addGroupConversation(t.store.state, 'Facade review', 'usr_002', ['usr_002', 'usr_003', 'usr_001'], STAMP);
  t.store.state.tasks.tsk_001 = makeTask();
  return { ...t, room: room.id, direct: direct.id, group: group.id };
}

/** The error code of a call, or "ok" when it answers. */
const codeOf = (promise: Promise<unknown>) => promise.then(() => 'ok', (error: { code: string }) => error.code);

describe('chats.setNotify', () => {
  it('starts a project chat at named and a direct chat and a group at all', async () => {
    const t = world();
    t.as('usr_003');
    expect((await t.api.call('chats.messages', { conversationId: t.room })).notify).toBe('named');
    expect((await t.api.call('chats.messages', { conversationId: t.direct })).notify).toBe('all');
    expect((await t.api.call('chats.messages', { conversationId: t.group })).notify).toBe('all');
  });

  it('saves the choice of one person for one chat', async () => {
    const t = world();
    t.as('usr_003');
    expect(await t.api.call('chats.setNotify', { conversationId: t.room, notify: 'all' })).toEqual({ notify: 'all' });
    expect((await t.api.call('chats.messages', { conversationId: t.room })).notify).toBe('all');
    t.as('usr_002');
    expect((await t.api.call('chats.messages', { conversationId: t.room })).notify).toBe('named');
    t.as('usr_003');
    await t.api.call('chats.setNotify', { conversationId: t.group, notify: 'named' });
    expect((await t.api.call('chats.messages', { conversationId: t.group })).notify).toBe('named');
    expect((await t.api.call('chats.messages', { conversationId: t.room })).notify).toBe('all');
  });

  it('keeps the read mark and the archive mark', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('chats.send', { conversationId: t.direct, body: 'Hello.' });
    await t.api.call('chats.archive', { conversationId: t.direct, archived: true });
    const before = t.store.state.chatReads[chatReadKey(t.direct, 'usr_003')];
    expect(before?.archivedAt).toBeTruthy();
    await t.api.call('chats.setNotify', { conversationId: t.direct, notify: 'named' });
    expect(t.store.state.chatReads[chatReadKey(t.direct, 'usr_003')]).toEqual({ ...before, notify: 'named' });
  });

  it('makes a read mark that reads nothing when the person has none, so the chat stays unread', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: t.direct, body: 'Hello Sara.' });
    t.as('usr_003');
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
    await t.api.call('chats.setNotify', { conversationId: t.direct, notify: 'named' });
    expect(t.store.state.chatReads[chatReadKey(t.direct, 'usr_003')]).toMatchObject({ notify: 'named', lastReadAt: '1970-01-01T00:00:00.000Z' });
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
  });

  it('refuses a task thread id as input', async () => {
    const t = world();
    t.as('usr_002');
    expect(await codeOf(t.api.call('chats.setNotify', { conversationId: 'tsk_001', notify: 'all' } as never))).toBe('invalid_input');
  });

  it('refuses a level that does not exist', async () => {
    const t = world();
    t.as('usr_002');
    expect(await codeOf(t.api.call('chats.setNotify', { conversationId: t.room, notify: 'none' } as never))).toBe('invalid_input');
  });

  it('answers not_found for a group the person is not in, and stores nothing', async () => {
    const t = world();
    t.as('usr_004');
    expect(await codeOf(t.api.call('chats.setNotify', { conversationId: t.group, notify: 'named' }))).toBe('not_found');
    expect(t.store.state.chatReads[chatReadKey(t.group, 'usr_004')]).toBeUndefined();
  });

  it('refuses an outsider of a direct chat and stores nothing', async () => {
    const t = world();
    t.as('usr_004');
    expect(await codeOf(t.api.call('chats.setNotify', { conversationId: t.direct, notify: 'named' }))).not.toBe('ok');
    expect(t.store.state.chatReads[chatReadKey(t.direct, 'usr_004')]).toBeUndefined();
  });

  it('writes no event', async () => {
    const t = world();
    t.as('usr_003');
    const events = Object.keys(t.store.state.events).length;
    await t.api.call('chats.setNotify', { conversationId: t.room, notify: 'all' });
    expect(Object.keys(t.store.state.events)).toHaveLength(events);
  });
});
