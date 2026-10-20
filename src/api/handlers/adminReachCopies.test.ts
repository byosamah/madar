import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { addGroupConversation, addProjectConversation } from '../chatState';
import { TRIGGERS, type AdminReach, type Notification } from '../contract/entities';
import { COPY_TRIGGERS, isCopy } from '../adminCopies';
import { notify, runScheduledTriggers } from '../notify';
import { memberKey, type Store } from '../store';
import { mentionMarkup } from '../../lib/text';
import { makeTask, makeUser, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The copies for an Admin who picked "Everything" (owner, 2026-10-23). Hala (usr_001) is the Admin and is not on prj_001. Faisal (usr_002)
 * leads it, Sara (usr_003) is on the team, Omar (usr_004) is outside, usr_005 is the agent of Sara. Nour (usr_006) is on the team too.
 * Tala (usr_007) is a second Admin who keeps the default.
 */
function world(reach: AdminReach | null = 'all') {
  const t = testApi(calls);
  const state = t.store.state;
  state.users.usr_006 = makeUser('usr_006', { name: 'Nour Team' });
  state.users.usr_007 = makeUser('usr_007', { name: 'Tala Admin', systemRole: 'admin' });
  state.members[memberKey('prj_001', 'usr_006')] = { projectId: 'prj_001', userId: 'usr_006', discipline: 'Architect' };
  state.tasks.tsk_001 = makeTask();
  state.counters.usr = 7;
  state.counters.tsk = 1;
  if (reach) state.users.usr_001.preferences = { ...state.users.usr_001.preferences, adminReach: reach };
  return t;
}
type T = ReturnType<typeof world>;

const copies = (store: Store, userId = 'usr_001'): Notification[] => Object.values(store.state.notifications).filter((n) => n.userId === userId && isCopy(n));
const originals = (store: Store): Notification[] => Object.values(store.state.notifications).filter((n) => !isCopy(n));
const triggersOf = (list: Notification[]) => list.map((n) => n.trigger);

describe('one copy for each notice call of each copy trigger', () => {
  it('task_assigned: Faisal gives Sara a task', async () => {
    const t = world();
    t.as('usr_002');
    const made = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Wall sections', ownerId: 'usr_003' });
    expect(copies(t.store)).toHaveLength(1);
    expect(copies(t.store)[0]).toMatchObject({
      userId: 'usr_001', trigger: 'task_assigned', actorId: 'usr_002', targetType: 'task', targetId: made.task.id, read: false, dedupeKey: null, forUserIds: ['usr_003'],
    });
    expect(copies(t.store)[0].correlationId).toBeTruthy();
    expect(originals(t.store).map((n) => n.userId)).toEqual(['usr_003']);
  });

  it('review_requested: Sara sends a task to review, and the copy names the leader', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    expect(copies(t.store).map((n) => [n.trigger, n.forUserIds])).toEqual([['review_requested', ['usr_002']]]);
  });

  it('task_approved and task_sent_back: the leader answers a review', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    t.as('usr_002');
    await t.api.call('tasks.sendBack', { id: 'tsk_001', note: 'Add the door heights.' });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    t.as('usr_002');
    await t.api.call('tasks.approve', { id: 'tsk_001' });
    expect(triggersOf(copies(t.store))).toEqual(['review_requested', 'task_sent_back', 'review_requested', 'task_approved']);
    expect(copies(t.store).filter((n) => n.trigger === 'task_approved')[0].forUserIds).toEqual(['usr_003']);
  });

  it('stage_changed: a task in a later stage moves the tag, and the copy names the team', async () => {
    const t = world();
    delete t.store.state.tasks.tsk_001;
    t.as('usr_002');
    await t.api.call('tasks.create', { projectId: 'prj_001', stageId: 'stg_002', title: 'Roof plan', ownerId: 'usr_002' });
    const stage = copies(t.store).find((n) => n.trigger === 'stage_changed');
    expect(stage).toMatchObject({ targetType: 'project', targetId: 'prj_001' });
    expect([...(stage?.forUserIds ?? [])].sort()).toEqual(['usr_003', 'usr_006']);
  });

  it('added_to_project: a new leader joins the team', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('projects.setLeader', { id: 'prj_001', leaderId: 'usr_004' });
    expect(copies(t.store).map((n) => [n.trigger, n.targetId, n.forUserIds])).toEqual([['added_to_project', 'prj_001', ['usr_004']]]);
  });

  it('meeting_invited: a project meeting keeps its change (new)', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', { kind: 'client', title: 'Review the facade', projectId: 'prj_001', startsAt: '2026-10-01T10:00:00+03:00', attendeeIds: ['usr_004'] });
    expect(copies(t.store)).toHaveLength(1);
    expect(copies(t.store)[0]).toMatchObject({ trigger: 'meeting_invited', targetType: 'meeting', targetId: made.id, meeting: { change: 'new' }, forUserIds: ['usr_004'] });
  });

  it('helper_joined: a helper joins, and the copy names the lead', async () => {
    const t = world();
    t.as('usr_006');
    await t.api.call('tasks.help', { taskId: 'tsk_001', help: true });
    expect(copies(t.store).map((n) => [n.trigger, n.actorId, n.forUserIds])).toEqual([['helper_joined', 'usr_006', ['usr_003']]]);
  });

  it('task_deleted: the lead deletes a task that the leader made, and the copy names the maker', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tasks.delete', { id: 'tsk_001' });
    expect(copies(t.store).map((n) => [n.trigger, n.targetId, n.forUserIds])).toEqual([['task_deleted', 'tsk_001', ['usr_002']]]);
  });

  it('mention in a project chat message', async () => {
    const t = world();
    const room = addProjectConversation(t.store.state, 'prj_001', STAMP);
    t.as('usr_002');
    const sent = await t.api.call('chats.send', { conversationId: room.id, body: `${mentionMarkup('Sara Team', 'usr_003')} please check.` });
    expect(copies(t.store)).toHaveLength(1);
    expect(copies(t.store)[0]).toMatchObject({ trigger: 'mention', targetType: 'chat', targetId: room.id, messageId: sent.message.id, forUserIds: ['usr_003'] });
  });

  it('mention in a task comment', async () => {
    const t = world();
    t.as('usr_002');
    const made = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: `${mentionMarkup('Sara Team', 'usr_003')} see the note.` });
    expect(copies(t.store)).toHaveLength(1);
    expect(copies(t.store)[0]).toMatchObject({ trigger: 'mention', targetType: 'task', targetId: 'tsk_001', messageId: made.comment.id, forUserIds: ['usr_003'] });
  });

  it('a message that names two people makes one copy, and it names both', async () => {
    const t = world();
    const room = addProjectConversation(t.store.state, 'prj_001', STAMP);
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: room.id, body: `${mentionMarkup('Sara Team', 'usr_003')} and ${mentionMarkup('Nour Team', 'usr_006')} please check.` });
    expect(copies(t.store)).toHaveLength(1);
    expect(copies(t.store)[0].forUserIds).toEqual(['usr_003', 'usr_006']);
  });

  it('a copy for each Admin who picked Everything, and none for an Admin who did not', async () => {
    const t = world();
    t.store.state.users.usr_008 = makeUser('usr_008', { name: 'Lina Admin', systemRole: 'admin', preferences: { ...makeUser('usr_008').preferences, adminReach: 'all' } });
    t.as('usr_002');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Wall sections', ownerId: 'usr_003' });
    expect(copies(t.store, 'usr_001')).toHaveLength(1);
    expect(copies(t.store, 'usr_008')).toHaveLength(1);
    expect(copies(t.store, 'usr_007')).toHaveLength(0);
  });
});

describe('what makes no copy', () => {
  it('makes a copy for exactly the copy triggers, and for no other trigger', () => {
    const t = world();
    // The target is real for each trigger, so the only reason for no copy is the trigger. The mention is a project chat message.
    const room = addProjectConversation(t.store.state, 'prj_001', STAMP);
    t.store.state.feedback = { fbk_1: { id: 'fbk_1' } as never };
    for (const trigger of TRIGGERS) {
      const state = structuredClone(t.store.state);
      const target = trigger.startsWith('feedback')
        ? { targetType: 'feedback' as const, targetId: 'fbk_1' }
        : trigger === 'mention' ? { targetType: 'chat' as const, targetId: room.id, messageId: 'msg_1' }
          : trigger.startsWith('meeting') ? { targetType: 'meeting' as const, targetId: 'mtg_1' }
            : ['stage_changed', 'added_to_project', 'resume_due'].includes(trigger) ? { targetType: 'project' as const, targetId: 'prj_001' }
              : trigger === 'added_to_group' ? { targetType: 'chat' as const, targetId: room.id }
                : { targetType: 'task' as const, targetId: 'tsk_001' };
      if (target.targetType === 'meeting') {
        state.meetings = { mtg_1: { id: 'mtg_1', projectId: 'prj_001', organizerId: 'usr_003', attendeeIds: ['usr_004'] } as never };
      }
      notify(state, state.users.usr_002, STAMP, { userIds: ['usr_003'], trigger, ...target });
      const made = Object.values(state.notifications).filter((n) => n.userId === 'usr_001').length;
      expect(made > 0, trigger).toBe(COPY_TRIGGERS.has(trigger));
    }
  });

  it('makes none for the reminders of the scheduler', () => {
    const t = world();
    const state = t.store.state;
    state.tasks.tsk_001 = makeTask({ dueDate: '2026-10-01', status: 'todo' });
    state.projects.prj_002 = { ...state.projects.prj_001, id: 'prj_002', code: 'KH-26-002', status: 'on_hold', pause: { by: 'usr_002', reason: 'Wait', resumeOn: '2026-09-29', at: STAMP } as never };
    state.meetings = {
      mtg_1: { id: 'mtg_1', projectId: 'prj_001', organizerId: 'usr_003', attendeeIds: ['usr_004'], status: 'scheduled', startsAt: '2026-09-30T09:20:00+03:00', title: 'Soon' } as never,
    };
    const count = runScheduledTriggers(state, NOW);
    expect(count).toBeGreaterThan(0);
    expect(copies(t.store)).toEqual([]);
  });

  it('makes none for a mention in a direct chat, a group or a project post', async () => {
    const t = world();
    t.as('usr_002');
    const direct = await t.api.call('chats.openDirect', { userId: 'usr_003' });
    await t.api.call('chats.send', { conversationId: direct.id, body: `${mentionMarkup('Sara Team', 'usr_003')} hello.` });
    const group = await t.api.call('chats.createGroup', { name: 'Site team', memberIds: ['usr_003', 'usr_006'] });
    await t.api.call('chats.send', { conversationId: group.id, body: `${mentionMarkup('Sara Team', 'usr_003')} hello.` });
    await t.api.call('updates.create', { projectId: 'prj_001', type: 'note', body: `${mentionMarkup('Sara Team', 'usr_003')} see this.` } as never);
    expect(originals(t.store).filter((n) => n.trigger === 'mention')).toHaveLength(3);
    expect(copies(t.store)).toEqual([]);
  });

  it('makes none for added_to_group', async () => {
    const t = world();
    t.as('usr_002');
    const group = addGroupConversation(t.store.state, 'Site team', 'usr_002', ['usr_002', 'usr_003'], STAMP);
    await t.api.call('chats.updateGroup', { conversationId: group.id, add: ['usr_006'] });
    expect(originals(t.store).map((n) => n.trigger)).toEqual(['added_to_group']);
    expect(copies(t.store)).toEqual([]);
  });

  it('makes none for a meeting with no project where the Admin is not invited, and none when the Admin is invited', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', { kind: 'meeting', title: 'Meet a new client', startsAt: '2026-10-01T10:00:00+03:00', attendeeIds: ['usr_004'] });
    expect(originals(t.store).map((n) => n.userId)).toEqual(['usr_004']);
    expect(copies(t.store)).toEqual([]);
    await t.api.call('meetings.create', { kind: 'meeting', title: 'Meet the Admin', startsAt: '2026-10-02T10:00:00+03:00', attendeeIds: ['usr_001'] });
    expect(copies(t.store)).toEqual([]);
    expect(originals(t.store).map((n) => n.userId)).toEqual(['usr_004', 'usr_001']);
  });

  it('makes none when the Admin is already a recipient of the call', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'For the Admin', ownerId: 'usr_001' });
    // The Admin joins the team with the task, so the Admin also gets the notice of the new member. Both are originals.
    expect(originals(t.store).map((n) => [n.userId, n.trigger]).sort()).toEqual([['usr_001', 'added_to_project'], ['usr_001', 'task_assigned']]);
    expect(copies(t.store)).toEqual([]);
  });

  it('makes none when the Admin is the actor, or the person behind the agent that acts', async () => {
    const t = world();
    t.store.state.users.usr_009 = makeUser('usr_009', { name: 'Admin Agent', kind: 'agent', discipline: 'Agent', ownerId: 'usr_001' });
    t.as('usr_001');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Admin task', ownerId: 'usr_003' });
    t.as('usr_009');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Agent task', ownerId: 'usr_003' });
    expect(originals(t.store)).toHaveLength(2);
    expect(copies(t.store)).toEqual([]);
  });

  it('makes none when the Admin turned the in-app switch of the trigger off, and one for the other triggers', async () => {
    const t = world();
    const prefs = t.store.state.users.usr_001.preferences;
    t.store.state.users.usr_001.preferences = { ...prefs, notifications: { ...prefs.notifications, task_assigned: false } };
    t.as('usr_002');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Wall sections', ownerId: 'usr_003' });
    expect(copies(t.store)).toEqual([]);
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    expect(triggersOf(copies(t.store))).toEqual(['review_requested']);
  });

  it('makes none for an inactive Admin, and none when nobody got the original', async () => {
    const t = world();
    t.store.state.users.usr_001.active = false;
    t.as('usr_002');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Wall sections', ownerId: 'usr_003' });
    expect(copies(t.store)).toEqual([]);
    t.store.state.users.usr_001.active = true;
    t.as('usr_003');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'My own task', ownerId: 'usr_003' });
    expect(copies(t.store)).toEqual([]);
  });

  it('makes none for the default choice and for Only my work', async () => {
    for (const reach of [null, 'mixed', 'mine'] as const) {
      const t = world(reach);
      t.as('usr_002');
      await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Wall sections', ownerId: 'usr_003' });
      expect(copies(t.store), String(reach)).toEqual([]);
    }
  });

  it('makes none for a person who is not an Admin, whatever is stored, and does not change their notices', async () => {
    const t = world(null);
    t.store.state.users.usr_010 = makeUser('usr_010', { name: 'Mona Management', systemRole: 'management', preferences: { ...makeUser('usr_010').preferences, adminReach: 'all' } });
    t.store.state.users.usr_004.preferences = { ...t.store.state.users.usr_004.preferences, adminReach: 'all' };
    t.as('usr_002');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Wall sections', ownerId: 'usr_003' });
    expect(copies(t.store, 'usr_010')).toEqual([]);
    expect(copies(t.store, 'usr_004')).toEqual([]);
    expect(Object.values(t.store.state.notifications).map((n) => n.userId)).toEqual(['usr_003']);
  });
});

describe('an office task and the Admin who loses the right to see it', () => {
  it('copies the notice of an office task, and hides the names when the person stops being an Admin', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('tasks.create', { title: 'Office errand', ownerId: 'usr_006' });
    expect(copies(t.store)).toHaveLength(1);
    t.as('usr_001');
    const [view] = await t.api.call('notifications.list', {});
    expect(view.notification.forUserIds).toEqual(['usr_006']);
    expect(view.forPeople.map((p) => p.id)).toEqual(['usr_006']);
    expect(view.target).toBe('Office errand');
    // The Admin becomes a Member: the office task is not theirs, so the copy reads as gone and names nothing.
    t.store.state.users.usr_001.systemRole = 'member';
    const [after] = await t.api.call('notifications.list', {});
    expect(after.gone).toBe(true);
    expect(after.forPeople).toEqual([]);
    expect(after.target).toBe('');
    expect(JSON.stringify(after)).not.toContain('Office errand');
    expect(JSON.stringify(after)).not.toContain('Nour');
    expect(made.task.id).toBeTruthy();
  });

  it('makes no copy of an office task for an Admin who was never allowed to see it', () => {
    const t = world();
    const state = t.store.state;
    // The Admin role is what gives the view of an office task. A person with the choice but not the role gets no copy.
    state.users.usr_001.systemRole = 'management';
    state.tasks.tsk_900 = makeTask({ id: 'tsk_900', projectId: null, stageId: null, ownerId: 'usr_006', createdBy: 'usr_003' });
    notify(state, state.users.usr_003, STAMP, { userIds: ['usr_006'], trigger: 'task_assigned', targetType: 'task', targetId: 'tsk_900' });
    expect(Object.values(state.notifications).map((n) => n.userId)).toEqual(['usr_006']);
  });
});

describe('the bell shows a copy like other notices', () => {
  it('counts on the bell, names the people of the original, and opens like the original', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Wall sections', ownerId: 'usr_003' });
    t.as('usr_001');
    expect(await t.api.call('notifications.count', {})).toEqual({ unread: 1, badge: 1 });
    const [view] = await t.api.call('notifications.list', {});
    expect(view).toMatchObject({ gone: false, target: 'Wall sections', needsAction: true });
    expect(view.forPeople.map((p) => p.name)).toEqual(['Sara Team']);
    expect(view.actor?.name).toBe('Faisal Leader');
    expect(view.link).toContain('tsk_001'.slice(0, 3));
    await t.api.call('notifications.markRead', { ids: [view.notification.id] });
    expect(await t.api.call('notifications.count', {})).toEqual({ unread: 0, badge: 0 });
  });

  it('gives an original no names', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Wall sections', ownerId: 'usr_003' });
    t.as('usr_003');
    const [view] = await t.api.call('notifications.list', {});
    expect(view.forPeople).toEqual([]);
    expect(view.notification.forUserIds).toBeUndefined();
  });

  it('reads an older notice without the field', () => {
    const t = world();
    t.as('usr_002');
    expect(Object.values(t.store.state.notifications)).toEqual([]);
  });
});

describe('an Undo of the story takes the copy back with the original', () => {
  it('drops the copy of a task that Undo removes', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Wall sections', ownerId: 'usr_003' }, { correlationId: 'cor_copy' });
    expect(Object.values(t.store.state.notifications)).toHaveLength(2);
    await t.api.call('events.undoStory', { correlationId: 'cor_copy' });
    expect(Object.values(t.store.state.notifications)).toEqual([]);
  });

  it('drops the copy of a mention when the message is deleted, and the name when an edit removes it', async () => {
    const t = world();
    const room = addProjectConversation(t.store.state, 'prj_001', STAMP);
    t.as('usr_002');
    const sent = await t.api.call('chats.send', { conversationId: room.id, body: `${mentionMarkup('Sara Team', 'usr_003')} and ${mentionMarkup('Nour Team', 'usr_006')} please check.` });
    expect(copies(t.store)[0].forUserIds).toEqual(['usr_003', 'usr_006']);
    await t.api.call('chats.editMessage', { id: sent.message.id, body: `${mentionMarkup('Sara Team', 'usr_003')} please check.` });
    expect(copies(t.store)[0].forUserIds).toEqual(['usr_003']);
    await t.api.call('chats.editMessage', { id: sent.message.id, body: 'Please check.' });
    expect(copies(t.store)).toEqual([]);
    await t.api.call('chats.editMessage', { id: sent.message.id, body: `${mentionMarkup('Sara Team', 'usr_003')} please check again.` });
    expect(copies(t.store)).toHaveLength(1);
    await t.api.call('chats.deleteMessage', { id: sent.message.id });
    expect(copies(t.store)).toEqual([]);
    await t.api.call('chats.deleteMessage', { id: sent.message.id, deleted: false });
    expect(copies(t.store)).toHaveLength(1);
    expect(copies(t.store)[0].read).toBe(true);
  });
});

describe('a copy is for the Admin only', () => {
  it('shows nothing of a copy to the person it names, and lists no copy for anyone else', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Wall sections', ownerId: 'usr_003' });
    for (const person of ['usr_002', 'usr_003', 'usr_004', 'usr_007']) {
      t.as(person);
      const list = await t.api.call('notifications.list', {});
      expect(list.filter((v) => v.notification.forUserIds !== undefined), person).toEqual([]);
    }
  });
});
