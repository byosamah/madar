import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { addProjectConversation } from '../chatState';
import { NOW, STAMP, makeTask, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * A mention notice opens the chat or the Inbox task thread at its message (chat design 2026-10-19, item 17). Hala (usr_001) is the
 * Admin, Faisal (usr_002) leads prj_001, Sara (usr_003) is on its team, Omar (usr_004) is outside.
 */
const SARA = '@[Sara Team](usr_003)';
const OMAR = '@[Omar Other](usr_004)';
const HALA = '@[Hala Admin](usr_001)';

function world() {
  const t = testApi(calls);
  t.store.state.tasks.tsk_001 = makeTask();
  t.store.state.counters.tsk = 1;
  const room = addProjectConversation(t.store.state, 'prj_001', STAMP).id;
  return { ...t, room };
}

describe('the link of a notice that points to a message', () => {
  it('opens a chat mention at its message', async () => {
    const t = world();
    t.as('usr_002');
    const sent = await t.api.call('chats.send', { conversationId: t.room, body: `${SARA} see this` });
    t.as('usr_003');
    const [notice] = await t.api.call('notifications.list', {});
    expect(notice.link).toBe(`/inbox/${t.room}?at=${sent.message.id}`);
  });

  it('opens the notice of a reply at the new message', async () => {
    const t = world();
    t.as('usr_003');
    const old = await t.api.call('chats.send', { conversationId: t.room, body: 'Footing depth?' });
    t.as('usr_002');
    const answer = await t.api.call('chats.send', { conversationId: t.room, body: 'Two metres.', replyToId: old.message.id });
    t.as('usr_003');
    const [notice] = await t.api.call('notifications.list', {});
    expect(notice.link).toBe(`/inbox/${t.room}?at=${answer.message.id}`);
  });

  it('opens a task comment mention in the Inbox task thread at that comment', async () => {
    const t = world();
    t.as('usr_003');
    const view = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: `${OMAR} please check` });
    t.as('usr_004');
    const [notice] = await t.api.call('notifications.list', {});
    expect(notice.link).toBe(`/inbox/tsk_001?at=${view.comment.id}`);
  });

  it('opens a name that a comment edit adds at that comment', async () => {
    const t = world();
    t.as('usr_003');
    const view = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'First words.' });
    await t.api.call('comments.update', { id: view.comment.id, body: `${HALA} First words, now with your name.` });
    t.as('usr_001');
    const [notice] = await t.api.call('notifications.list', {});
    expect(notice.link).toBe(`/inbox/tsk_001?at=${view.comment.id}`);
  });

  it('keeps the old link of a notice with no message', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: t.room, body: `${SARA} see this` });
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: `${SARA} and this` });
    for (const notice of Object.values(t.store.state.notifications)) delete notice.messageId;
    t.as('usr_003');
    const links = (await t.api.call('notifications.list', {})).map((n) => n.link).sort();
    expect(links).toEqual([`/inbox/${t.room}`, '/projects/prj_001?tab=tasks&task=tsk_001']);
  });

  it('keeps the link of a notice that points to a post comment and of a mention in a post', async () => {
    const t = world();
    t.as('usr_002');
    const post = await t.api.call('updates.create', { projectId: 'prj_001', body: `${SARA} a post` });
    t.as('usr_003');
    const [notice] = await t.api.call('notifications.list', {});
    expect(notice.link).toBe(`/projects/prj_001?tab=activity&update=${post.id}`);
  });

  it('gives no link for an office task that the viewer no longer sees', async () => {
    const t = world();
    t.as('usr_002');
    const { task } = await t.api.call('tasks.create', { title: 'Renew the licence', ownerId: 'usr_003', helperIds: ['usr_004'], dueDate: '2026-10-08' });
    t.as('usr_003');
    await t.api.call('comments.create', { targetType: 'task', targetId: task.id, body: `${OMAR} the fee` });
    t.as('usr_004');
    expect((await t.api.call('notifications.list', {})).map((n) => n.link)).toContain(`/inbox/${task.id}?at=cmt_001`);
    t.as('usr_002');
    await t.api.call('tasks.update', { id: task.id, patch: { helperIds: [] } });
    t.as('usr_004');
    const [notice] = await t.api.call('notifications.list', {});
    expect(notice.link).toBe('/notifications');
  });

  it('gives a notice that points to a message of a chat the viewer cannot open no link', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: t.room, body: `${SARA} see this` });
    t.store.state.projects.prj_001.status = 'active';
    delete t.store.state.members['prj_001:usr_003'];
    t.as('usr_003');
    const [notice] = await t.api.call('notifications.list', {});
    expect(notice.gone).toBe(true);
    expect(notice.link).toBe('/notifications');
  });
});
