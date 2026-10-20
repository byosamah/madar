import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { projectCalls } from './projects';
import { addProjectConversation } from '../chatState';
import { chatReadKey, memberKey } from '../store';
import { mentionMarkup } from '../../lib/text';
import { makeTask, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const calls = { ...chatCalls, ...contentCalls, ...projectCalls };

/**
 * The count of an Admin (chat design item 23). Hala (usr_001) is the Admin and is not on prj_001. Faisal (usr_002) leads it, Sara
 * (usr_003) is on the team, Omar (usr_004) is outside. In the project chat of a project that the Admin does not lead and is not on the
 * team of, the unread count holds only the messages that name the Admin, unless the Admin picked All messages.
 */
function world() {
  const t = testApi(calls);
  const room = addProjectConversation(t.store.state, 'prj_001', STAMP);
  t.store.state.tasks.tsk_001 = makeTask();
  return { ...t, room: room.id };
}

type World = ReturnType<typeof world>;

/** Faisal writes two plain messages and one that names Hala. */
async function talk(t: World) {
  t.as('usr_002');
  await t.api.call('chats.send', { conversationId: t.room, body: 'Plain one.' });
  await t.api.call('chats.send', { conversationId: t.room, body: 'Plain two.' });
  await t.api.call('chats.send', { conversationId: t.room, body: `${mentionMarkup('Hala Admin', 'usr_001')} please approve.` });
}

const rowOf = async (t: World) => (await t.api.call('chats.list', {})).find((row) => row.id === t.room);

describe('the Admin count of a project chat outside the Admin projects (item 23)', () => {
  it('counts for an Admin outside the project only the unread messages that name the Admin (item 23)', async () => {
    const t = world();
    await talk(t);
    t.as('usr_001');
    expect((await rowOf(t))?.unread).toBe(1);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
  });

  it('counts every unread message when the Admin is on the team or leads the project', async () => {
    const onTeam = world();
    onTeam.store.state.members[memberKey('prj_001', 'usr_001')] = { projectId: 'prj_001', userId: 'usr_001', discipline: 'Architect' };
    await talk(onTeam);
    onTeam.as('usr_001');
    expect((await rowOf(onTeam))?.unread).toBe(3);
    const leads = world();
    leads.store.state.projects.prj_001 = { ...leads.store.state.projects.prj_001, leaderId: 'usr_001' };
    await talk(leads);
    leads.as('usr_001');
    expect((await rowOf(leads))?.unread).toBe(3);
    expect((await leads.api.call('chats.unreadCount', {})).unread).toBe(3);
  });

  it('gives the count back when the Admin picks All messages', async () => {
    const t = world();
    await talk(t);
    t.as('usr_001');
    expect((await rowOf(t))?.unread).toBe(1);
    await t.api.call('chats.setNotify', { conversationId: t.room, notify: 'all' });
    expect((await rowOf(t))?.unread).toBe(3);
    await t.api.call('chats.setNotify', { conversationId: t.room, notify: 'named' });
    expect((await rowOf(t))?.unread).toBe(1);
  });

  it('counts every unread message for a team member, whatever their choice', async () => {
    const t = world();
    await talk(t);
    t.as('usr_003');
    await t.api.call('chats.setNotify', { conversationId: t.room, notify: 'named' });
    expect((await rowOf(t))?.unread).toBe(3);
    expect(t.store.state.chatReads[chatReadKey(t.room, 'usr_003')]?.notify).toBe('named');
  });

  it('treats an Admin who leads a task of the project but is not on the team as outside', async () => {
    const t = world();
    t.store.state.tasks.tsk_001 = { ...t.store.state.tasks.tsk_001, ownerId: 'usr_001' };
    await talk(t);
    t.as('usr_001');
    expect((await rowOf(t))?.unread).toBe(1);
  });

  it('clears the count when the Admin reads the chat', async () => {
    const t = world();
    await talk(t);
    t.as('usr_001');
    expect((await rowOf(t))?.unread).toBe(1);
    await t.api.call('chats.markRead', { conversationId: t.room });
    expect((await rowOf(t))?.unread).toBe(0);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(0);
  });

  it('counts a reply to the Admin as a message that names the Admin', async () => {
    const t = world();
    t.as('usr_001');
    const first = await t.api.call('chats.send', { conversationId: t.room, body: 'The sections are ready.' });
    setNow(new Date(NOW.getTime() + 60_000));
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: t.room, body: 'Thanks, I will check them.', replyToId: first.message.id });
    t.as('usr_001');
    expect((await rowOf(t))?.unread).toBe(1);
  });
});
