import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { notificationCalls } from './notifications';
import { addProjectConversation } from '../chatState';
import { mentionMarkup } from '../../lib/text';
import { listFormat, setNow } from '../../lib/dates';
import { chatReadKey } from '../store';
import { makeTask, makeUser, NOW, STAMP, testApi } from '../../test/factories';

// The UX audit of 2026-10-19 for the Inbox: archive marks a chat read, a group needs no name, a person can always leave, an
// inactive maker is skipped, a group writes quiet lines, and a group mention names the group.

beforeEach(() => setNow(NOW));

const calls = { ...chatCalls, ...contentCalls, ...notificationCalls };
const later = (ms: number) => setNow(new Date(NOW.getTime() + ms));
const failureOf = (promise: Promise<unknown>) => promise.then(() => null, (error: { code: string; message: string; reason?: string }) => error);

// Hala (usr_001) is the Admin, Faisal (usr_002) and Sara (usr_003) are team members, Omar (usr_004) is outside.
async function groupOfSara() {
  const t = testApi(calls);
  t.as('usr_003');
  const { id } = await t.api.call('chats.createGroup', { name: 'Tower team', memberIds: ['usr_002', 'usr_001'] });
  return { t, id };
}

describe('chats.archive marks the chat read (chats-03, INT-01)', () => {
  it('drops the unread number of the chat and of the badge at once, and a new message brings its own number back', async () => {
    const t = testApi(calls);
    const room = addProjectConversation(t.store.state, 'prj_001', STAMP);
    t.as('usr_001');
    await t.api.call('chats.send', { conversationId: room.id, body: 'Please check the riser.' });
    t.as('usr_003');
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
    await t.api.call('chats.archive', { conversationId: room.id, archived: true });
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(0);
    expect((await t.api.call('chats.list', {})).find((row) => row.id === room.id)).toMatchObject({ archived: true, unread: 0 });
    later(60_000);
    t.as('usr_001');
    await t.api.call('chats.send', { conversationId: room.id, body: 'Any news?' });
    t.as('usr_003');
    expect((await t.api.call('chats.list', {})).find((row) => row.id === room.id)).toMatchObject({ archived: false, unread: 1 });
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
  });

  it('marks a task thread read too, and keeps the chat read when it moves back to the Inbox', async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask();
    t.as('usr_002');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Please start the plan.' });
    t.as('usr_003');
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
    await t.api.call('chats.archive', { conversationId: 'tsk_001', archived: true });
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(0);
    await t.api.call('chats.archive', { conversationId: 'tsk_001', archived: false });
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(0);
    expect(t.store.state.chatReads[chatReadKey('tsk_001', 'usr_003')]?.archivedAt).toBeNull();
  });
});

describe('chats.createGroup without a name (chats-09)', () => {
  it('names the group after the first names of the people', async () => {
    const t = testApi(calls);
    t.store.state.users.usr_002.name = 'Faisal Al-Harbi';
    t.store.state.users.usr_001.name = 'Hala Nasser';
    t.as('usr_003');
    const two = await t.api.call('chats.createGroup', { memberIds: ['usr_002', 'usr_001'] });
    expect(t.store.state.conversations[two.id].name).toBe(listFormat('en').format(['Faisal', 'Hala']));
    const three = await t.api.call('chats.createGroup', { memberIds: ['usr_002', 'usr_001', 'usr_004'] });
    expect(t.store.state.conversations[three.id].name).toBe(listFormat('en').format(['Faisal', 'Hala', 'Omar']));
  });

  it('uses the Arabic names when the maker reads Arabic', async () => {
    const t = testApi(calls);
    t.store.state.users.usr_002.nameAr = 'فيصل الحربي';
    t.store.state.users.usr_001.nameAr = 'هالة ناصر';
    t.store.state.users.usr_003.preferences.language = 'ar';
    t.as('usr_003');
    const { id } = await t.api.call('chats.createGroup', { memberIds: ['usr_002', 'usr_001'] });
    expect(t.store.state.conversations[id].name).toBe(listFormat('ar').format(['فيصل', 'هالة']));
  });

  it('keeps the name short for a big group', async () => {
    const t = testApi(calls);
    for (let n = 101; n <= 110; n += 1) t.store.state.users[`usr_${n}`] = makeUser(`usr_${n}`, { name: `Alexandra${n} Last` });
    t.as('usr_003');
    const { id } = await t.api.call('chats.createGroup', { memberIds: Array.from({ length: 10 }, (_, i) => `usr_${101 + i}`) });
    const name = t.store.state.conversations[id].name ?? '';
    expect(name.length).toBeGreaterThan(0);
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name).toContain('+7');
  });

  it('still refuses a name that is only spaces', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    expect(await failureOf(t.api.call('chats.createGroup', { name: '   ', memberIds: ['usr_002', 'usr_001'] }))).toMatchObject({ code: 'invalid_input' });
  });
});

describe('leaving a group (chats-11, INT-06)', () => {
  it('lets a person leave a group of two, and the person who stays reads a closed chat', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: id, remove: ['usr_001'] });
    t.as('usr_002');
    await t.api.call('chats.leaveGroup', { conversationId: id });
    expect(t.store.state.conversations[id].memberIds).toEqual(['usr_003']);
    t.as('usr_003');
    const row = (await t.api.call('chats.list', {})).find((item) => item.id === id);
    expect(row).toMatchObject({ kind: 'group', personLeft: true });
    expect(await failureOf(t.api.call('chats.send', { conversationId: id, body: 'Anyone here?' }))).toMatchObject({ code: 'forbidden' });
    // The history stays readable for the person who stays.
    expect((await t.api.call('chats.messages', { conversationId: id })).chat.personLeft).toBe(true);
  });

  it('lets the last person leave too, and keeps a maker on the record', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: id, remove: ['usr_001'] });
    t.as('usr_002');
    await t.api.call('chats.leaveGroup', { conversationId: id });
    t.as('usr_003');
    await t.api.call('chats.leaveGroup', { conversationId: id });
    expect(t.store.state.conversations[id].memberIds).toEqual([]);
    expect(t.store.state.conversations[id].makerId).toBe('usr_003');
  });

  it('still refuses a removal that leaves the group under two people', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: id, remove: ['usr_001'] });
    const failure = await failureOf(t.api.call('chats.updateGroup', { conversationId: id, remove: ['usr_002'] }));
    expect(failure).toMatchObject({ code: 'invalid_input' });
  });
});

describe('a group whose maker is turned off (INT-05)', () => {
  it('lets the next active member remove a person, and shows that member as the maker', async () => {
    const { t, id } = await groupOfSara();
    t.store.state.users.usr_003.active = false;
    t.as('usr_002');
    expect((await t.api.call('chats.list', {})).find((row) => row.id === id)?.makerId).toBe('usr_002');
    await t.api.call('chats.updateGroup', { conversationId: id, remove: ['usr_001'] });
    expect(t.store.state.conversations[id].memberIds).toEqual(['usr_003', 'usr_002']);
    // The record keeps the first maker, so a turn-on gives the role back.
    expect(t.store.state.conversations[id].makerId).toBe('usr_003');
  });

  it('leaves the maker role with the maker while the maker is active, and hands it to an active person on leave', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_002');
    expect(await failureOf(t.api.call('chats.updateGroup', { conversationId: id, remove: ['usr_001'] }))).toMatchObject({ code: 'forbidden' });
    t.store.state.users.usr_002.active = false;
    t.as('usr_003');
    await t.api.call('chats.leaveGroup', { conversationId: id });
    expect(t.store.state.conversations[id].makerId).toBe('usr_001');
  });

  it('counts only active people in the closed state of a group', async () => {
    const { t, id } = await groupOfSara();
    t.store.state.users.usr_002.active = false;
    t.store.state.users.usr_001.active = false;
    t.as('usr_003');
    expect((await t.api.call('chats.list', {})).find((row) => row.id === id)?.personLeft).toBe(true);
  });
});

describe('the quiet lines of a group (chats-10, INT-15)', () => {
  it('writes a line for an added person, a removed person, a person who left and a new name, in the order they happened', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_003');
    later(1_000);
    await t.api.call('chats.updateGroup', { conversationId: id, add: ['usr_004'] });
    later(2_000);
    await t.api.call('chats.updateGroup', { conversationId: id, remove: ['usr_001'] });
    later(3_000);
    t.as('usr_002');
    await t.api.call('chats.updateGroup', { conversationId: id, name: 'Facade review' });
    later(4_000);
    t.as('usr_004');
    await t.api.call('chats.leaveGroup', { conversationId: id });
    t.as('usr_003');
    const { lines } = await t.api.call('chats.messages', { conversationId: id });
    expect(lines.map((line) => [line.type, line.actor.id, line.people.map((person) => person.id), line.name])).toEqual([
      ['added', 'usr_003', ['usr_004'], null],
      ['removed', 'usr_003', ['usr_001'], null],
      ['renamed', 'usr_002', [], 'Facade review'],
      ['left', 'usr_004', [], null],
    ]);
    expect(lines.map((line) => line.at)).toEqual([...lines.map((line) => line.at)].sort());
  });

  it('is no message: it counts as read for everyone and changes neither the unread number nor the preview', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_003');
    await t.api.call('chats.send', { conversationId: id, body: 'Welcome all.' });
    later(1_000);
    await t.api.call('chats.updateGroup', { conversationId: id, add: ['usr_004'], name: 'Facade review' });
    t.as('usr_002');
    const row = (await t.api.call('chats.list', {})).find((item) => item.id === id);
    expect(row).toMatchObject({ unread: 1, preview: 'Welcome all.', title: 'Facade review' });
    expect(Object.values(t.store.state.messages).filter((message) => message.conversationId === id)).toHaveLength(1);
  });

  it('writes no line when nothing changed, and keeps only the newest 100', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: id, name: 'Tower team' });
    expect((await t.api.call('chats.messages', { conversationId: id })).lines).toEqual([]);
    for (let n = 0; n < 105; n += 1) {
      later((n + 1) * 1_000);
      await t.api.call('chats.updateGroup', { conversationId: id, name: `Name ${n}` });
    }
    const { lines } = await t.api.call('chats.messages', { conversationId: id });
    expect(lines).toHaveLength(100);
    expect(lines.at(-1)?.name).toBe('Name 104');
  });

  it('shows the lines to the members only', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: id, name: 'Facade review' });
    t.as('usr_004');
    expect(await failureOf(t.api.call('chats.messages', { conversationId: id }))).toMatchObject({ code: 'not_found' });
  });

  it('sends the added person one notice, and nobody else', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: id, add: ['usr_004'] });
    t.as('usr_004');
    const added = (await t.api.call('notifications.list', {})).find((item) => item.notification.trigger === 'added_to_group');
    expect(added).toMatchObject({ actor: { id: 'usr_003' }, target: 'Tower team', chatKind: 'group', link: `/inbox/${id}`, gone: false });
    t.as('usr_002');
    expect((await t.api.call('notifications.list', {})).some((item) => item.notification.trigger === 'added_to_group')).toBe(false);
    t.as('usr_003');
    expect((await t.api.call('notifications.list', {})).some((item) => item.notification.trigger === 'added_to_group')).toBe(false);
  });
});

describe('a mention in a group (chats-12, INT-03)', () => {
  it('names the group in the notice and says that it is a group', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: id, body: `Please check ${mentionMarkup('Hala Admin', 'usr_001')}` });
    t.as('usr_001');
    const item = (await t.api.call('notifications.list', {})).find((entry) => entry.notification.trigger === 'mention');
    expect(item).toMatchObject({ target: 'Tower team', chatKind: 'group', project: null, gone: false });
  });

  it('keeps a direct chat notice without a name, and a project chat notice with its project', async () => {
    const t = testApi(calls);
    const room = addProjectConversation(t.store.state, 'prj_001', STAMP);
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: room.id, body: `Look ${mentionMarkup('Sara Team', 'usr_003')}` });
    t.as('usr_003');
    const project = (await t.api.call('notifications.list', {})).find((entry) => entry.notification.trigger === 'mention');
    expect(project).toMatchObject({ chatKind: 'project', target: 'Test Tower' });
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_002' });
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: id, body: `Hi ${mentionMarkup('Sara Team', 'usr_003')}` });
    t.as('usr_003');
    const direct = (await t.api.call('notifications.list', {})).find((entry) => entry.notification.targetId === id);
    expect(direct).toMatchObject({ chatKind: 'direct', target: '' });
  });

  it('hides the group name once the person is not in the group any more', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: id, body: `Please check ${mentionMarkup('Hala Admin', 'usr_001')}` });
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: id, remove: ['usr_001'] });
    t.as('usr_001');
    const item = (await t.api.call('notifications.list', {})).find((entry) => entry.notification.trigger === 'mention');
    expect(item).toMatchObject({ target: '', chatKind: 'group', gone: true });
  });
});
