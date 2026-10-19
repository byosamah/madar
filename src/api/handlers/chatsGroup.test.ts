import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { addProjectConversation } from '../chatState';
import { mentionMarkup } from '../../lib/text';
import { setNow } from '../../lib/dates';
import { makeUser, NOW, STAMP, testApi } from '../../test/factories';

beforeEach(() => setNow(NOW));

const calls = { ...chatCalls };

// Hala (usr_001) is the Admin, Faisal (usr_002) and Sara (usr_003) are team members, Omar (usr_004) is outside,
// and Sara's agent (usr_005) acts for her.
function world() {
  return testApi(calls);
}

/** The error of a call that fails, or null when it answers. */
const failureOf = (promise: Promise<unknown>) => promise.then(() => null, (error: { code: string; message: string }) => error);

/** A group of Sara with Faisal and Hala. Sara is the maker. */
async function groupOfSara() {
  const t = world();
  t.as('usr_003');
  const { id } = await t.api.call('chats.createGroup', { name: 'Tower team', memberIds: ['usr_002', 'usr_001'] });
  return { t, id };
}

describe('chats.createGroup', () => {
  it('makes a group of three people, with the maker first and the people in the order they joined', async () => {
    const { t, id } = await groupOfSara();
    expect(t.store.state.conversations[id]).toMatchObject({
      kind: 'group', name: 'Tower team', makerId: 'usr_003', projectId: null, memberIds: ['usr_003', 'usr_002', 'usr_001'],
    });
    expect((await t.api.call('chats.list', {})).find((row) => row.id === id)).toMatchObject({ kind: 'group', title: 'Tower team', makerId: 'usr_003' });
  });

  it('writes no History event for a group', async () => {
    const t = world();
    t.as('usr_003');
    const events = Object.keys(t.store.state.events).length;
    await t.api.call('chats.createGroup', { name: 'Tower team', memberIds: ['usr_002', 'usr_001'] });
    expect(Object.keys(t.store.state.events)).toHaveLength(events);
  });

  it('refuses one other person, because a group has at least three people', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('chats.createGroup', { name: 'Tower team', memberIds: ['usr_002'] })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refuses an agent, an inactive person, a duplicate, the person itself and an unknown person', async () => {
    const t = world();
    t.as('usr_003');
    t.store.state.users.usr_004.active = false;
    const bad = [['usr_002', 'usr_005'], ['usr_002', 'usr_004'], ['usr_002', 'usr_002'], ['usr_002', 'usr_003'], ['usr_002', 'usr_999']];
    for (const memberIds of bad) {
      expect(await failureOf(t.api.call('chats.createGroup', { name: 'Tower team', memberIds })), memberIds.join(',')).toMatchObject({ code: 'invalid_input' });
    }
  });

  it('refuses a blank name', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('chats.createGroup', { name: '   ', memberIds: ['usr_002', 'usr_001'] })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('holds 50 people at most', async () => {
    const t = world();
    for (let n = 101; n <= 150; n += 1) t.store.state.users[`usr_${n}`] = makeUser(`usr_${n}`, { name: `Person ${n}` });
    t.as('usr_003');
    const memberIds = Array.from({ length: 49 }, (_, i) => `usr_${101 + i}`);
    const { id } = await t.api.call('chats.createGroup', { name: 'Full team', memberIds });
    expect(t.store.state.conversations[id].memberIds).toHaveLength(50);
    expect(await failureOf(t.api.call('chats.updateGroup', { conversationId: id, add: ['usr_150'] }))).toMatchObject({ code: 'invalid_input' });
  });
});

describe('chats.updateGroup and chats.leaveGroup', () => {
  it('lets any member rename the group and add people', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_002');
    await t.api.call('chats.updateGroup', { conversationId: id, name: 'Tower design team', add: ['usr_004'] });
    expect(t.store.state.conversations[id]).toMatchObject({ name: 'Tower design team', memberIds: ['usr_003', 'usr_002', 'usr_001', 'usr_004'] });
  });

  it('refuses an added person who is already in the group or who is not active', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_002');
    expect(await failureOf(t.api.call('chats.updateGroup', { conversationId: id, add: ['usr_001'] }))).toMatchObject({ code: 'invalid_input' });
    t.store.state.users.usr_004.active = false;
    expect(await failureOf(t.api.call('chats.updateGroup', { conversationId: id, add: ['usr_004'] }))).toMatchObject({ code: 'invalid_input' });
  });

  it('refuses a removal by a member who is not the maker', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_002');
    await expect(t.api.call('chats.updateGroup', { conversationId: id, remove: ['usr_001'] })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.conversations[id].memberIds).toContain('usr_001');
  });

  it('lets the maker remove a person', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: id, remove: ['usr_001'] });
    expect(t.store.state.conversations[id].memberIds).toEqual(['usr_003', 'usr_002']);
  });

  it('lets a person leave, and the person sees no group after that', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: id, add: ['usr_004'] });
    t.as('usr_004');
    await t.api.call('chats.leaveGroup', { conversationId: id });
    expect(t.store.state.conversations[id].memberIds).not.toContain('usr_004');
  });

  it('makes the first person left the maker when the maker leaves', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_003');
    await t.api.call('chats.leaveGroup', { conversationId: id });
    expect(t.store.state.conversations[id]).toMatchObject({ makerId: 'usr_002', memberIds: ['usr_002', 'usr_001'] });
  });

  it('keeps at least two people in a group when a person is removed, and lets a person leave at any time (chats-11)', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_003');
    await t.api.call('chats.updateGroup', { conversationId: id, remove: ['usr_001'] });
    expect(await failureOf(t.api.call('chats.updateGroup', { conversationId: id, remove: ['usr_002'] }))).toMatchObject({ code: 'invalid_input' });
    await t.api.call('chats.leaveGroup', { conversationId: id });
    expect(t.store.state.conversations[id].memberIds).toEqual(['usr_002']);
  });

  it('refuses a rename with a blank name, and a change of a chat that is not a group', async () => {
    const t = world();
    const room = addProjectConversation(t.store.state, 'prj_001', STAMP);
    t.as('usr_003');
    const { id } = await t.api.call('chats.createGroup', { name: 'Tower team', memberIds: ['usr_002', 'usr_001'] });
    expect(await failureOf(t.api.call('chats.updateGroup', { conversationId: id, name: ' ' }))).toMatchObject({ code: 'invalid_input' });
    expect(await failureOf(t.api.call('chats.updateGroup', { conversationId: room.id, name: 'Renamed' }))).toMatchObject({ code: 'invalid_input' });
    expect(await failureOf(t.api.call('chats.leaveGroup', { conversationId: room.id }))).toMatchObject({ code: 'invalid_input' });
  });
});

describe('a group in the Inbox', () => {
  it('names only the members in a mention, and sends the message to each member but the sender', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_002');
    const body = `Please check ${mentionMarkup('Omar Other', 'usr_004')} and ${mentionMarkup('Hala Admin', 'usr_001')}`;
    const sent = await t.api.call('chats.send', { conversationId: id, body });
    expect(sent.message.mentions).toEqual(['usr_001']);
    t.as('usr_001');
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
    t.as('usr_002');
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(0);
    t.as('usr_003');
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
  });

  it('can be archived, and a new message brings it back', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_003');
    await t.api.call('chats.archive', { conversationId: id, archived: true });
    expect((await t.api.call('chats.list', {})).find((row) => row.id === id)?.archived).toBe(true);
    setNow(new Date(NOW.getTime() + 60_000));
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: id, body: 'Any news?' });
    t.as('usr_003');
    expect((await t.api.call('chats.list', {})).find((row) => row.id === id)?.archived).toBe(false);
  });

  it('shows the members of a group row, the first three in the order they joined', async () => {
    const { t, id } = await groupOfSara();
    t.as('usr_003');
    const row = (await t.api.call('chats.list', {})).find((item) => item.id === id);
    expect(row?.members.map((member) => member.id)).toEqual(['usr_003', 'usr_002', 'usr_001']);
    const thread = await t.api.call('chats.messages', { conversationId: id });
    expect(thread.people.map((person) => person.id).sort()).toEqual(['usr_001', 'usr_002']);
    expect(thread.chat.makerId).toBe('usr_003');
  });
});
