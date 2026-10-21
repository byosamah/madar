import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { fileCalls } from './files';
import { historyCalls } from './history';
import { insightCalls } from './insights';
import { notificationCalls } from './notifications';
import { serverFakes } from './serverFakes';
import { shareCalls } from './sharing';
import { addProjectConversation } from '../chatState';
import type { RoleSettings } from '../contract/entities';
import { mentionMarkup } from '../../lib/text';
import { makeUser, NOW, STAMP, testApi } from '../../test/factories';
import { both, without as off, withExtra as extra } from '../../test/rr2work';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The chat gates of role rights version 2 (design 5.6): chat.direct, chat.groupCreate, chat.groupChange, chat.project (team and all).
 * People: usr_001 Admin, usr_002 leader of prj_001, usr_003 team member, usr_004 outside the team, usr_005 agent of usr_003,
 * usr_006 outside the team (a Member).
 */
const calls = { ...serverFakes, ...chatCalls, ...contentCalls, ...fileCalls, ...shareCalls, ...insightCalls, ...historyCalls, ...notificationCalls };
const pdf = () => new Blob(['x'], { type: 'application/pdf' });

function world(roles?: RoleSettings) {
  const t = testApi(calls);
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Reem Outside' });
  const room = addProjectConversation(t.store.state, 'prj_001', STAMP).id;
  if (roles) t.store.state.settings.roles = roles;
  return { ...t, room };
}

/** A direct chat of Sara (usr_003) and Faisal (usr_002) with one message, made before any switch is turned off. */
async function direct(roles?: RoleSettings) {
  const t = world();
  t.as('usr_003');
  const id = (await t.api.call('chats.openDirect', { userId: 'usr_002' })).id;
  const sent = await t.api.call('chats.send', { conversationId: id, body: 'First line' });
  if (roles) t.store.state.settings.roles = roles;
  return { ...t, id, message: sent.message.id };
}

describe('chat.direct: a direct chat', () => {
  it('opens and sends with the switch on, and refuses openDirect and send with it off', async () => {
    const closed = world(off('chat.direct'));
    closed.as('usr_003');
    await expect(closed.api.call('chats.openDirect', { userId: 'usr_002' })).rejects.toMatchObject({ code: 'forbidden' });
    const t = await direct(off('chat.direct'));
    await expect(t.api.call('chats.send', { conversationId: t.id, body: 'Second' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses an edit, a delete and a reaction in a direct chat with the switch off, and still lets the person read', async () => {
    const t = await direct(off('chat.direct'));
    await expect(t.api.call('chats.editMessage', { id: t.message, body: 'Changed' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('chats.deleteMessage', { id: t.message })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('reactions.toggle', { messageId: t.message, emoji: '👍' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    await expect(t.api.call('reactions.toggle', { messageId: t.message, emoji: '👍' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    expect((await t.api.call('chats.messages', { conversationId: t.id })).messages).toHaveLength(1);
    await t.api.call('chats.markRead', { conversationId: t.id });
    await t.api.call('chats.archive', { conversationId: t.id, archived: true });
    await t.api.call('chats.setNotify', { conversationId: t.id, notify: 'all' });
  });

  it('passes an edit, a delete and a reaction with the switch on', async () => {
    const t = await direct();
    await t.api.call('chats.editMessage', { id: t.message, body: 'Changed' });
    await t.api.call('reactions.toggle', { messageId: t.message, emoji: '👍' });
    await t.api.call('chats.deleteMessage', { id: t.message });
  });

  it('refuses a send of the agent of a person without the switch', async () => {
    const t = await direct(off('chat.direct'));
    t.as('usr_005');
    await expect(t.api.call('chats.send', { conversationId: t.id, body: 'By agent' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a file of a direct chat with the switch off (the upload is a message)', async () => {
    const t = await direct();
    await t.api.call('files.upload', { conversationId: t.id, name: 'a.pdf', blob: pdf() });
    t.store.state.settings.roles = off('chat.direct');
    await expect(t.api.call('files.upload', { conversationId: t.id, name: 'b.pdf', blob: pdf() })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('files.uploadStart', { conversationId: t.id, name: 'b.pdf', mimeType: 'application/pdf', size: 10 })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('leaves a group the person belongs to, and refuses a group message, with chat.direct off', async () => {
    const t = world();
    t.as('usr_003');
    const group = (await t.api.call('chats.createGroup', { name: 'Crew', memberIds: ['usr_002', 'usr_004'] })).id;
    t.store.state.settings.roles = off('chat.direct');
    await expect(t.api.call('chats.send', { conversationId: group, body: 'Hi' })).rejects.toMatchObject({ code: 'forbidden' });
    await t.api.call('chats.leaveGroup', { conversationId: group });
  });
});

describe('chat.groupCreate and chat.groupChange', () => {
  it('refuses a new group with chat.groupCreate off, and passes with it on', async () => {
    const closed = world(off('chat.groupCreate'));
    closed.as('usr_003');
    await expect(closed.api.call('chats.createGroup', { name: 'Crew', memberIds: ['usr_002', 'usr_004'] })).rejects.toMatchObject({ code: 'forbidden' });
    closed.as('usr_005');
    await expect(closed.api.call('chats.createGroup', { name: 'Crew', memberIds: ['usr_002', 'usr_004'] })).rejects.toMatchObject({ code: 'forbidden' });
    const t = world();
    t.as('usr_003');
    expect((await t.api.call('chats.createGroup', { name: 'Crew', memberIds: ['usr_002', 'usr_004'] })).id).toBeTruthy();
  });

  it('refuses a rename and an add with chat.groupChange off, and still lets the maker remove a person', async () => {
    const t = world();
    t.as('usr_003');
    const group = (await t.api.call('chats.createGroup', { name: 'Crew', memberIds: ['usr_002', 'usr_004', 'usr_006'] })).id;
    t.store.state.settings.roles = off('chat.groupChange');
    await expect(t.api.call('chats.updateGroup', { conversationId: group, name: 'New name' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('chats.updateGroup', { conversationId: group, add: ['usr_001'] })).rejects.toMatchObject({ code: 'forbidden' });
    await t.api.call('chats.updateGroup', { conversationId: group, remove: ['usr_006'] });
    t.store.state.settings.roles = undefined as never;
    await t.api.call('chats.updateGroup', { conversationId: group, name: 'New name', add: ['usr_001'] });
  });
});

describe('chat.project.team: the chat of a project', () => {
  it('opens and writes for the team with the switch on', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('chats.send', { conversationId: t.room, body: 'Team line' });
    t.as('usr_002');
    expect((await t.api.call('chats.messages', { conversationId: t.room })).messages).toHaveLength(1);
  });

  it('closes the chat to the team and the leader with the switch off (the chat reads as missing)', async () => {
    const t = world(off('chat.project.team'));
    for (const person of ['usr_003', 'usr_002', 'usr_005']) {
      t.as(person);
      await expect(t.api.call('chats.send', { conversationId: t.room, body: 'Line' })).rejects.toMatchObject({ code: 'not_found' });
      await expect(t.api.call('chats.messages', { conversationId: t.room })).rejects.toMatchObject({ code: 'not_found' });
    }
  });

  it('shares a file into the project chat only with the switch on', async () => {
    const t = world();
    t.as('usr_003');
    const file = await t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() });
    await t.api.call('files.share', { fileId: file.file.id, target: { kind: 'project_chat' } });
    t.store.state.settings.roles = off('chat.project.team');
    await expect(t.api.call('files.share', { fileId: file.file.id, target: { kind: 'project_chat' } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('shares a file to a person only with chat.direct, and leaves no empty chat when it refuses', async () => {
    const t = world();
    t.as('usr_002');
    const file = await t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() });
    t.store.state.settings.roles = off('chat.direct');
    t.as('usr_003');
    await expect(t.api.call('files.share', { fileId: file.file.id, target: { kind: 'person', userId: 'usr_002' } })).rejects.toMatchObject({ code: 'forbidden' });
    expect(Object.values(t.store.state.conversations).filter((c) => c.kind === 'direct')).toHaveLength(0);
    t.store.state.settings.roles = off('file.share');
    await expect(t.api.call('files.share', { fileId: file.file.id, target: { kind: 'person', userId: 'usr_002' } })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('chat.project.all: every project chat opens (leak tests for a person without it)', () => {
  /** Reem (usr_006, a Member with no part in prj_001) and Omar (usr_004, a person of the role "Viewer" that holds chat.project.all). */
  async function office() {
    const t = world({ custom: [{ id: 'rol_001', name: 'Viewer', nameAr: 'مطلع', rights: ['chat.project.all'] }] });
    t.store.state.users.usr_004 = { ...t.store.state.users.usr_004, roleId: 'rol_001' };
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: t.room, body: 'Secret riser 7714' });
    await t.api.call('chats.send', { conversationId: t.room, body: `${mentionMarkup('Omar Other', 'usr_004')} and ${mentionMarkup('Reem Outside', 'usr_006')} look at this` });
    return t;
  }

  it('opens the chat for the holder, and answers as for a missing chat to a Member without it, on every call', async () => {
    const t = await office();
    t.as('usr_004');
    const thread = await t.api.call('chats.messages', { conversationId: t.room });
    expect(thread.messages).toHaveLength(2);
    expect((await t.api.call('chats.list', {})).map((row) => row.id)).toContain(t.room);
    t.as('usr_006');
    const never = await t.api.call('chats.messages', { conversationId: 'cnv_999' }).catch((e) => e);
    const hidden = await t.api.call('chats.messages', { conversationId: t.room }).catch((e) => e);
    expect(hidden).toMatchObject({ code: 'not_found' });
    expect(hidden.message.replace(t.room, 'X')).toBe(never.message.replace('cnv_999', 'X'));
    expect(JSON.stringify(hidden)).not.toContain('7714');
    for (const [name, input] of [
      ['chats.send', { conversationId: t.room, body: 'Let me in' }], ['chats.markRead', { conversationId: t.room }],
      ['chats.archive', { conversationId: t.room, archived: true }], ['chats.setNotify', { conversationId: t.room, notify: 'all' }],
      ['chats.markUnread', { conversationId: t.room }],
    ] as const) {
      await expect(t.api.call(name, input as never), name).rejects.toMatchObject({ code: 'not_found' });
    }
  });

  it('keeps the chat out of the list, the badge, the waiting list and the message search of a Member without it', async () => {
    const t = await office();
    t.as('usr_006');
    expect((await t.api.call('chats.list', {})).map((row) => row.id)).not.toContain(t.room);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(0);
    expect(JSON.stringify(await t.api.call('chats.waiting', {}))).not.toContain('7714');
    expect((await t.api.call('search.query', { text: 'riser 7714' })).messages).toEqual([]);
    t.as('usr_004');
    expect((await t.api.call('search.query', { text: 'riser 7714' })).messages).toHaveLength(1);
  });

  it('sends no notice of the chat to a Member without the switch, and one mention notice to the holder', async () => {
    const t = await office();
    t.as('usr_006');
    expect((await t.api.call('notifications.list', {})).filter((n) => n.notification.targetType === 'chat')).toEqual([]);
    t.as('usr_004');
    expect((await t.api.call('notifications.list', {})).filter((n) => n.notification.targetType === 'chat')).toHaveLength(1);
  });

  it('counts for the holder like the default of the Admin: only the messages that name the person, unless the person picks All messages', async () => {
    const t = await office();
    t.as('usr_004');
    const row = (await t.api.call('chats.list', {})).find((r) => r.id === t.room)!;
    expect(row.unread).toBe(1);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
    await t.api.call('chats.setNotify', { conversationId: t.room, notify: 'all' });
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(2);
  });

  it('lets a holder of the all switch write in the project chat, and refuses the holder when the all switch is off', async () => {
    const t = await office();
    t.as('usr_004');
    await t.api.call('chats.send', { conversationId: t.room, body: 'From the holder' });
    t.store.state.settings.roles = { custom: [{ id: 'rol_001', name: 'Viewer', nameAr: 'مطلع', rights: [] }] };
    await expect(t.api.call('chats.send', { conversationId: t.room, body: 'Again' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('gives the holder through extra rights the same as through a custom role', async () => {
    const t = world(both([], ['chat.project.all']));
    t.as('usr_006');
    await t.api.call('chats.send', { conversationId: t.room, body: 'Open for every Member' });
    const plain = world(extra());
    plain.as('usr_006');
    await expect(plain.api.call('chats.send', { conversationId: plain.room, body: 'Closed' })).rejects.toMatchObject({ code: 'not_found' });
  });
});
