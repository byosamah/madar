import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { addProjectConversation } from '../chatState';
import type { Notification } from '../contract/entities';
import { NOW, STAMP, makeTask, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * A mention notice keeps the message or the comment it points to (base B4), so a press on the notice can open the chat at that
 * message. Faisal (usr_002) leads prj_001, Sara (usr_003) is on its team. The chat and the task comment both name a person.
 */
const SARA = '@[Sara Team](usr_003)';
const FAISAL = '@[Faisal Leader](usr_002)';

function world() {
  const t = testApi(calls);
  t.store.state.tasks.tsk_001 = makeTask();
  t.store.state.counters.tsk = 1;
  const room = addProjectConversation(t.store.state, 'prj_001', STAMP).id;
  return { t, room };
}

const noticesOf = (state: { notifications: Record<string, Notification> }, userId: string) => Object.values(state.notifications).filter((n) => n.userId === userId);

describe('the message that a mention notice points to', () => {
  it('gives the mention notice of chats.send the id of the new message, and no reply mark', async () => {
    const { t, room } = world();
    t.as('usr_002');
    const sent = await t.api.call('chats.send', { conversationId: room, body: `${SARA} see this` });
    const notices = noticesOf(t.store.state, 'usr_003');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ trigger: 'mention', targetType: 'chat', targetId: room, messageId: sent.message.id });
    expect(notices[0]).not.toHaveProperty('reply');
  });

  it('gives the mention notice of comments.create the id of the comment', async () => {
    const { t } = world();
    t.as('usr_002');
    const view = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: `${SARA} please check` });
    const notices = noticesOf(t.store.state, 'usr_003');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ trigger: 'mention', targetType: 'task', targetId: 'tsk_001', messageId: view.comment.id });
    expect(notices[0]).not.toHaveProperty('reply');
  });

  it('gives the mention notice of comments.update, for a name the edit adds, the id of the comment', async () => {
    const { t } = world();
    t.as('usr_003');
    const view = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'First words.' });
    expect(noticesOf(t.store.state, 'usr_002')).toHaveLength(0);
    await t.api.call('comments.update', { id: view.comment.id, body: `${FAISAL} First words, now with your name.` });
    const notices = noticesOf(t.store.state, 'usr_002');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ trigger: 'mention', targetType: 'task', targetId: 'tsk_001', messageId: view.comment.id });
    expect(notices[0]).not.toHaveProperty('reply');
  });

  it('keeps the notice of a message with no mention away, and a chat message with no name makes no notice', async () => {
    const { t, room } = world();
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: room, body: 'No names here.' });
    expect(Object.values(t.store.state.notifications)).toHaveLength(0);
  });
});
