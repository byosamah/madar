import { beforeEach, describe, expect, it } from 'vitest';
import { taskCalls } from './tasks';
import { contentCalls } from './content';
import { historyCalls } from './history';
import { projectCalls } from './projects';
import { makeTask, makeUser, NOW, testApi } from '../../test/factories';
import type { Store } from '../store';
import { setNow } from '../../lib/dates';
import { runScheduledTriggers } from '../notify';
import { groupMyTasks } from '../../lib/myWork';

beforeEach(() => setNow(NOW));

const notices = (store: Store, trigger: string, userId: string) =>
  Object.values(store.state.notifications).filter((n) => n.trigger === trigger && n.userId === userId);

/**
 * Faisal (usr_002) leads the project. Sara (usr_003) leads task tsk_001. Nour (usr_006) is a team member who helps on it.
 * Omar (usr_004) is outside the team.
 */
function world() {
  const t = testApi({ ...taskCalls, ...contentCalls, ...historyCalls, ...projectCalls });
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Nour Helper', discipline: 'Interior designer' });
  t.store.state.users.usr_007 = makeUser('usr_007', { name: 'Gone Person', active: false });
  t.store.state.members['prj_001:usr_006'] = { projectId: 'prj_001', userId: 'usr_006', discipline: 'Interior designer' };
  t.store.state.tasks.tsk_001 = makeTask({
    helperIds: ['usr_006'], dueDate: '2026-10-05',
    checklist: [{ id: 'chk_a', text: 'Ground floor', done: false }, { id: 'chk_b', text: 'Roof plan', done: false }],
  });
  t.store.state.counters.tsk = 1;
  return t;
}

describe('helpers on a task', () => {
  it('lets the leader name helpers when the task is made, and tells them', async () => {
    const t = world();
    t.as('usr_002');
    const made = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Wall sections', ownerId: 'usr_003', helperIds: ['usr_006'] });
    expect(made.task.helperIds).toEqual(['usr_006']);
    expect(made.helpers.map((h) => h.id)).toEqual(['usr_006']);
    expect(notices(t.store, 'task_assigned', 'usr_003')).toHaveLength(1);
    expect(notices(t.store, 'task_assigned', 'usr_006')).toHaveLength(1);
  });

  it('keeps helpers out of a task made with none', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Roof plan' });
    expect(made.task.helperIds).toBeUndefined();
    expect(made.helpers).toEqual([]);
  });

  it('lets only the leader and the Admin add or remove helpers', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { helperIds: [] } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'X', helperIds: ['usr_006'] })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_006');
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { helperIds: [] } })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_001');
    const out = await t.api.call('tasks.update', { id: 'tsk_001', patch: { helperIds: [] } });
    expect(out.task.helperIds).toEqual([]);
    t.as('usr_002');
    const again = await t.api.call('tasks.update', { id: 'tsk_001', patch: { helperIds: ['usr_006', 'usr_002'] } });
    expect(again.task.helperIds).toEqual(['usr_006', 'usr_002']);
  });

  it('never lets the lead be a helper, a person twice, or more than ten helpers', async () => {
    const t = world();
    t.as('usr_002');
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { helperIds: ['usr_003'] } })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['helperIds'] } });
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { helperIds: ['usr_006', 'usr_006'] } })).rejects.toMatchObject({ code: 'invalid_input' });
    const eleven = Array.from({ length: 11 }, (_, i) => `usr_${String(100 + i)}`);
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { helperIds: eleven } })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('drops a helper who becomes the lead', async () => {
    const t = world();
    t.as('usr_002');
    const out = await t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_006' } });
    expect(out.task).toMatchObject({ ownerId: 'usr_006', helperIds: [] });
  });

  it('tells a person who is added as a helper, and brings the change back with Undo', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { helperIds: ['usr_006', 'usr_001'] } });
    expect(notices(t.store, 'task_assigned', 'usr_001')).toHaveLength(1);
    expect(notices(t.store, 'task_assigned', 'usr_006')).toHaveLength(0);
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { helperIds: [] } }, { correlationId: 'cor_ui_helpers' });
    await t.api.call('events.undoStory', { correlationId: 'cor_ui_helpers' });
    expect(t.store.state.tasks.tsk_001.helperIds).toEqual(['usr_006', 'usr_001']);
  });

  it('writes an empty list first, so Undo works on a task that never had helpers', async () => {
    const t = world();
    delete t.store.state.tasks.tsk_001.helperIds;
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { helperIds: ['usr_006'] } }, { correlationId: 'cor_ui_first' });
    await t.api.call('events.undoStory', { correlationId: 'cor_ui_first' });
    expect(t.store.state.tasks.tsk_001.helperIds).toEqual([]);
  });
});

describe("a helper's own list", () => {
  it('shows the task in "mine" for the lead and the helper, and not for others', async () => {
    const t = world();
    for (const [userId, count] of [['usr_003', 1], ['usr_006', 1], ['usr_002', 0], ['usr_004', 0]] as const) {
      t.as(userId);
      expect((await t.api.call('tasks.list', { filter: 'mine' })).length).toBe(count);
    }
  });

  it('shows the task when a list asks for a person who helps, and groups it under My Work', async () => {
    const t = world();
    t.as('usr_002');
    expect((await t.api.call('tasks.list', { ownerId: 'usr_006' })).map((r) => r.task.id)).toEqual(['tsk_001']);
    t.as('usr_006');
    const mine = await t.api.call('tasks.list', { filter: 'mine', includeDone: false });
    expect(groupMyTasks(mine, '2026-09-30').map((g) => [g.group, g.rows.length])).toEqual([['later', 1]]);
  });

  it('gives the helper the same task row, with the lead and the helpers', async () => {
    const t = world();
    t.as('usr_006');
    const [row] = await t.api.call('tasks.list', { filter: 'mine' });
    expect(row.owner.id).toBe('usr_003');
    expect(row.helpers.map((h) => h.id)).toEqual(['usr_006']);
    expect(row.canMove).toBe(false);
  });
});

describe('what a helper may do', () => {
  it('ticks checklist items and comments', async () => {
    const t = world();
    t.as('usr_006');
    const task = t.store.state.tasks.tsk_001;
    const out = await t.api.call('tasks.update', { id: 'tsk_001', patch: { checklist: task.checklist.map((item) => ({ ...item, done: item.id === 'chk_a' })) } });
    expect(out.task.checklist.map((item) => item.done)).toEqual([true, false]);
    expect(out.viewerCan).toMatchObject({ contribute: true, edit: false, complete: false, newVersion: false, saveTemplate: false });
    const comment = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Done with the ground floor.' });
    expect(comment.comment.authorId).toBe('usr_006');
  });

  it('cannot add, remove or rename a checklist item', async () => {
    const t = world();
    t.as('usr_006');
    const items = t.store.state.tasks.tsk_001.checklist;
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { checklist: [...items, { id: 'chk_z', text: 'New', done: false }] } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { checklist: items.slice(1) } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { checklist: items.map((item) => ({ ...item, text: 'Other' })) } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('cannot finish the task, move it, or change its title or dates', async () => {
    const t = world();
    t.as('usr_006');
    await expect(t.api.call('tasks.complete', { id: 'tsk_001' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.move', { id: 'tsk_001', status: 'done' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-09' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { startDate: '2026-10-01' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { title: 'Mine now', checklist: [] } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the lead, the leader and the Admin finish it', async () => {
    for (const userId of ['usr_003', 'usr_002', 'usr_001']) {
      const t = world();
      t.as(userId);
      expect((await t.api.call('tasks.complete', { id: 'tsk_001' })).task.task.status).not.toBe('todo');
    }
  });

  it('lets a helper take back their own tick, and not another change', async () => {
    const t = world();
    t.as('usr_006');
    const items = t.store.state.tasks.tsk_001.checklist;
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { checklist: items.map((item) => ({ ...item, done: true })) } }, { correlationId: 'cor_ui_tick' });
    await t.api.call('events.undoStory', { correlationId: 'cor_ui_tick' });
    expect(t.store.state.tasks.tsk_001.checklist.map((item) => item.done)).toEqual([false, false]);
  });

  /** Nour leads the task and changes its list four ways, the tick last. Then the leader moves the lead to Sara and makes Nour a helper. */
  async function nourEditedThenBecameHelper() {
    const t = world();
    const items = t.store.state.tasks.tsk_001.checklist;
    t.store.state.tasks.tsk_001.ownerId = 'usr_006';
    t.store.state.tasks.tsk_001.helperIds = [];
    t.as('usr_006');
    const edit = (story: string, checklist: typeof items) => t.api.call('tasks.update', { id: 'tsk_001', patch: { checklist } }, { correlationId: story });
    await edit('cor_ui_add', [...items, { id: 'chk_z', text: 'Section', done: false }]);
    await edit('cor_ui_rename', [...items, { id: 'chk_z', text: 'Section cut', done: false }]);
    await edit('cor_ui_remove', items);
    await edit('cor_ui_tick', items.map((item) => ({ ...item, done: item.id === 'chk_a' })));
    return { t, items };
  }

  it('lets a helper undo a tick, but not an event that added, removed or renamed an item', async () => {
    const { t, items } = await nourEditedThenBecameHelper();
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_003', helperIds: ['usr_006'] } });
    t.as('usr_006');
    for (const story of ['cor_ui_remove', 'cor_ui_rename', 'cor_ui_add']) {
      await expect(t.api.call('events.undoStory', { correlationId: story })).rejects.toMatchObject({ code: 'forbidden' });
    }
    await t.api.call('events.undoStory', { correlationId: 'cor_ui_tick' });
    expect(t.store.state.tasks.tsk_001.checklist).toEqual(items);
  });

  it('lets the lead undo an event that renamed, added or removed an item', async () => {
    const { t, items } = await nourEditedThenBecameHelper();
    for (const story of ['cor_ui_tick', 'cor_ui_remove', 'cor_ui_rename', 'cor_ui_add']) await t.api.call('events.undoStory', { correlationId: story });
    expect(t.store.state.tasks.tsk_001.checklist).toEqual(items);
  });
});

describe('notifications to helpers', () => {
  it('sends approval and send-back to the lead and the helpers', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    t.as('usr_002');
    await t.api.call('tasks.sendBack', { id: 'tsk_001', note: 'Add the stair.' });
    expect(notices(t.store, 'task_sent_back', 'usr_003')).toHaveLength(1);
    expect(notices(t.store, 'task_sent_back', 'usr_006')).toHaveLength(1);
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    t.as('usr_002');
    await t.api.call('tasks.approve', { id: 'tsk_001' });
    expect(notices(t.store, 'task_approved', 'usr_006')).toHaveLength(1);
  });

  it('sends the due-soon and overdue reminders to the helpers too, once', async () => {
    const t = world();
    t.store.state.tasks.tsk_001.dueDate = '2026-10-01';
    runScheduledTriggers(t.store.state, NOW);
    runScheduledTriggers(t.store.state, NOW);
    expect(notices(t.store, 'due_tomorrow', 'usr_003')).toHaveLength(1);
    expect(notices(t.store, 'due_tomorrow', 'usr_006')).toHaveLength(1);
    t.store.state.tasks.tsk_001.dueDate = '2026-09-20';
    runScheduledTriggers(t.store.state, NOW);
    expect(notices(t.store, 'overdue', 'usr_006')).toHaveLength(1);
  });

  it('respects a helper who turned a reminder off', async () => {
    const t = world();
    t.store.state.users.usr_006.preferences.notifications.due_tomorrow = false;
    t.store.state.tasks.tsk_001.dueDate = '2026-10-01';
    runScheduledTriggers(t.store.state, NOW);
    expect(notices(t.store, 'due_tomorrow', 'usr_006')).toHaveLength(0);
  });
});

describe('joining the team automatically', () => {
  it('adds a person outside the team, with their discipline, when the leader makes them the lead, and tells them', async () => {
    const t = world();
    t.store.state.users.usr_004.discipline = 'Structural engineer';
    t.as('usr_002');
    const out = await t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_004' } });
    expect(out.task.ownerId).toBe('usr_004');
    expect(t.store.state.members['prj_001:usr_004']).toEqual({ projectId: 'prj_001', userId: 'usr_004', discipline: 'Structural engineer' });
    expect(notices(t.store, 'added_to_project', 'usr_004')).toHaveLength(1);
    expect(notices(t.store, 'task_assigned', 'usr_004')).toHaveLength(1);
  });

  it('does the same for a helper, and for a task made with an outside lead', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { helperIds: ['usr_006', 'usr_004'] } });
    expect(t.store.state.members['prj_001:usr_004']).toBeDefined();
    expect(notices(t.store, 'added_to_project', 'usr_004')).toHaveLength(1);
    const t2 = world();
    t2.as('usr_002');
    await t2.api.call('tasks.create', { projectId: 'prj_001', title: 'Survey', ownerId: 'usr_004' });
    expect(t2.store.state.members['prj_001:usr_004']).toBeDefined();
  });

  it('works for the Admin too, even on a project the Admin does not lead', async () => {
    const t = world();
    t.as('usr_001');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_004' } });
    expect(t.store.state.members['prj_001:usr_004']).toBeDefined();
  });

  it('is part of the same story, so Undo takes the new member away', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_004' } }, { correlationId: 'cor_ui_join' });
    await t.api.call('events.undoStory', { correlationId: 'cor_ui_join' });
    expect(t.store.state.members['prj_001:usr_004']).toBeUndefined();
    expect(t.store.state.tasks.tsk_001.ownerId).toBe('usr_003');
  });

  it('refuses a team member who is not the leader, and adds no one', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_004' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { helperIds: ['usr_004'] } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'X', ownerId: 'usr_004' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.members['prj_001:usr_004']).toBeUndefined();
  });

  it('does not add a person who is not active, or an agent', async () => {
    const t = world();
    t.as('usr_002');
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_007' } })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['ownerId'] } });
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { helperIds: ['usr_005'] } })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['helperIds'] } });
    expect(Object.keys(t.store.state.members)).not.toContain('prj_001:usr_007');
  });
});

describe('removing a team member', () => {
  it('waits while the person still helps on an open task', async () => {
    const t = world();
    t.as('usr_002');
    await expect(t.api.call('members.remove', { projectId: 'prj_001', userId: 'usr_006' })).rejects.toMatchObject({ code: 'invalid_input' });
    t.store.state.tasks.tsk_001.status = 'done';
    await t.api.call('members.remove', { projectId: 'prj_001', userId: 'usr_006' });
  });
});
