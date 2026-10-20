import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { notificationCalls } from './notifications';
import { peopleCalls } from './people';
import { projectCalls } from './projects';
import { addProjectConversation } from '../chatState';
import type { AdminReach } from '../contract/entities';
import { memberKey } from '../store';
import { mentionMarkup } from '../../lib/text';
import { makeTask, makeUser, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const calls = { ...chatCalls, ...contentCalls, ...projectCalls, ...peopleCalls, ...notificationCalls };

/**
 * What reaches the Admin: the chat part (owner, 2026-10-23). Hala (usr_001) is the Admin and is not on prj_001. Faisal (usr_002) leads it,
 * Sara (usr_003) is on the team. Prj_002 has Hala as its leader, so its chat is one of hers. The Admin picks "Only my work", "mixed"
 * (the default) or "Everything".
 */
function world() {
  const t = testApi(calls);
  const other = addProjectConversation(t.store.state, 'prj_001', STAMP);
  t.store.state.tasks.tsk_001 = makeTask();
  t.store.state.projects.prj_002 = { ...t.store.state.projects.prj_001, id: 'prj_002', code: 'KH-26-002', name: 'Own Tower', leaderId: 'usr_001' };
  t.store.state.members[memberKey('prj_002', 'usr_002')] = { projectId: 'prj_002', userId: 'usr_002', discipline: 'Architect' };
  const own = addProjectConversation(t.store.state, 'prj_002', STAMP);
  return { ...t, other: other.id, own: own.id };
}
type World = ReturnType<typeof world>;

/** Faisal writes two plain messages and one that names Hala, in a chat. */
async function talk(t: World, room: string) {
  t.as('usr_002');
  await t.api.call('chats.send', { conversationId: room, body: 'Plain one.' });
  await t.api.call('chats.send', { conversationId: room, body: 'Plain two.' });
  await t.api.call('chats.send', { conversationId: room, body: `${mentionMarkup('Hala Admin', 'usr_001')} please approve.` });
}

const pick = async (t: World, adminReach: AdminReach) => {
  t.as('usr_001');
  await t.api.call('me.updatePreferences', { adminReach });
};
const rowOf = async (t: World, room: string) => (await t.api.call('chats.list', {})).find((row) => row.id === room);

describe('the setting: who may pick it', () => {
  it('saves the choice of an Admin, keeps the other preferences, and reads "mixed" until the Admin picks', async () => {
    const t = world();
    t.as('usr_001');
    expect(t.store.state.users.usr_001.preferences.adminReach).toBeUndefined();
    const after = await t.api.call('me.updatePreferences', { adminReach: 'all' });
    expect(after.preferences.adminReach).toBe('all');
    expect(after.preferences.theme).toBe('light');
    expect((await t.api.call('me.updatePreferences', { theme: 'dark' })).preferences.adminReach).toBe('all');
    expect((await t.api.call('me.updatePreferences', { adminReach: 'mine' })).preferences.adminReach).toBe('mine');
  });

  it('refuses the choice for Management, Accounting and Members, and stores nothing', async () => {
    const t = world();
    t.store.state.users.usr_006 = makeUser('usr_006', { systemRole: 'management' });
    t.store.state.users.usr_007 = makeUser('usr_007', { systemRole: 'accounting' });
    for (const person of ['usr_002', 'usr_003', 'usr_006', 'usr_007']) {
      t.as(person);
      await expect(t.api.call('me.updatePreferences', { adminReach: 'all' }), person).rejects.toMatchObject({ code: 'forbidden' });
      expect(t.store.state.users[person].preferences.adminReach, person).toBeUndefined();
    }
    t.as('usr_003');
    expect((await t.api.call('me.updatePreferences', { theme: 'dark' })).preferences.theme).toBe('dark');
  });

  it('refuses a value outside the three choices', async () => {
    const t = world();
    t.as('usr_001');
    await expect(t.api.call('me.updatePreferences', { adminReach: 'everything' as never })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('mixed (the default): today list and counts, nothing changes', () => {
  it('lists the other project chat and counts only the messages that name the Admin', async () => {
    const t = world();
    await talk(t, t.other);
    t.as('usr_001');
    expect((await rowOf(t, t.other))?.unread).toBe(1);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
    await pick(t, 'mixed');
    expect((await rowOf(t, t.other))?.unread).toBe(1);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
  });
});

describe('mine (Only my work)', () => {
  it('leaves the other project chat out of the list and the badge, and keeps the chats of the Admin', async () => {
    const t = world();
    await talk(t, t.other);
    await talk(t, t.own);
    await pick(t, 'mine');
    const ids = (await t.api.call('chats.list', {})).map((row) => row.id);
    expect(ids).not.toContain(t.other);
    expect(ids).toContain(t.own);
    expect((await rowOf(t, t.own))?.unread).toBe(3);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(3);
  });

  it('keeps a project chat of a project where the Admin is on the team', async () => {
    const t = world();
    t.store.state.members[memberKey('prj_001', 'usr_001')] = { projectId: 'prj_001', userId: 'usr_001', discipline: 'Architect' };
    await talk(t, t.other);
    await pick(t, 'mine');
    expect((await rowOf(t, t.other))?.unread).toBe(3);
  });

  it('still opens the chat, reads it and sends into it', async () => {
    const t = world();
    await talk(t, t.other);
    await pick(t, 'mine');
    const page = await t.api.call('chats.messages', { conversationId: t.other });
    expect(page.messages).toHaveLength(3);
    await t.api.call('chats.markRead', { conversationId: t.other });
    await t.api.call('chats.send', { conversationId: t.other, body: 'Seen.' });
  });

  it('still gives the bell notice of a message that names the Admin, and its link opens the chat', async () => {
    const t = world();
    await talk(t, t.other);
    await pick(t, 'mine');
    const list = await t.api.call('notifications.list', {});
    const notice = list.find((view) => view.notification.trigger === 'mention' && view.notification.targetId === t.other);
    expect(notice).toBeDefined();
    expect(notice?.gone).toBe(false);
    expect(notice?.link).toContain(t.other);
    expect(await t.api.call('notifications.count', {})).toMatchObject({ unread: 1, badge: 1 });
  });

  it('does not change the list of Faisal or Sara', async () => {
    const t = world();
    await talk(t, t.other);
    await pick(t, 'mine');
    t.as('usr_003');
    expect((await rowOf(t, t.other))?.unread).toBe(3);
  });

  it('does nothing for an Admin who is demoted: the stored choice has no effect on a Member', async () => {
    const t = world();
    await talk(t, t.other);
    await pick(t, 'mine');
    t.store.state.users.usr_001 = { ...t.store.state.users.usr_001, systemRole: 'member' };
    t.store.state.members[memberKey('prj_001', 'usr_001')] = { projectId: 'prj_001', userId: 'usr_001', discipline: 'Architect' };
    t.as('usr_001');
    expect((await rowOf(t, t.other))?.unread).toBe(3);
  });
});

describe('all (Everything)', () => {
  it('counts every message of every project chat for the Admin', async () => {
    const t = world();
    await talk(t, t.other);
    await pick(t, 'all');
    expect((await rowOf(t, t.other))?.unread).toBe(3);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(3);
  });

  it('keeps the own Notify me choice of the chat stored: it has no say in the count while Everything stands', async () => {
    const t = world();
    await talk(t, t.other);
    await pick(t, 'all');
    await t.api.call('chats.setNotify', { conversationId: t.other, notify: 'named' });
    expect((await rowOf(t, t.other))?.unread).toBe(3);
    await pick(t, 'mixed');
    expect((await rowOf(t, t.other))?.unread).toBe(1);
  });

  it('does not change the count of a Member', async () => {
    const t = world();
    await talk(t, t.other);
    await pick(t, 'all');
    t.as('usr_003');
    expect((await rowOf(t, t.other))?.unread).toBe(3);
  });
});

describe('an agent of the Admin follows the choice of its person', () => {
  it('lists and counts like the Admin, for each choice, and cannot pick the choice itself', async () => {
    const t = world();
    t.store.state.users.usr_009 = makeUser('usr_009', { name: 'Admin Agent', kind: 'agent', discipline: 'Agent', ownerId: 'usr_001' });
    await talk(t, t.other);
    const asAgent = async () => {
      t.as('usr_009');
      return { rows: await t.api.call('chats.list', {}), count: (await t.api.call('chats.unreadCount', {})).unread };
    };
    expect((await asAgent()).rows.find((row) => row.id === t.other)?.unread).toBe(1);
    await pick(t, 'mine');
    const mine = await asAgent();
    expect(mine.rows.map((row) => row.id)).not.toContain(t.other);
    expect(mine.count).toBe(0);
    await pick(t, 'all');
    expect((await asAgent()).rows.find((row) => row.id === t.other)?.unread).toBe(3);
    t.as('usr_009');
    await expect(t.api.call('me.updatePreferences', { adminReach: 'mine' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
