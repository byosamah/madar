import { beforeEach, describe, expect, it } from 'vitest';
import { taskCalls } from './tasks';
import { trackerCalls } from './tracker';
import { contentCalls } from './content';
import { historyCalls } from './history';
import { makeTask, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { dueFromDuration } from '../../lib/workdays';

beforeEach(() => setNow(NOW));

const DONE = '2026-09-28T10:00:00.000+03:00';

/** A finished task led by Sara (usr_003) with a ticked checklist, and Omar (usr_004) as a helper. */
function world(overrides = {}) {
  const t = testApi({ ...taskCalls, ...trackerCalls, ...contentCalls, ...historyCalls });
  t.store.state.tasks.tsk_001 = makeTask({
    title: 'Floor plans set', status: 'done', completedAt: DONE, startDate: '2026-09-14', dueDate: '2026-09-28',
    checklist: [{ id: 'chk_a', text: 'Ground floor', done: true }, { id: 'chk_b', text: 'Roof plan', done: true }], ...overrides,
  });
  t.store.state.counters.tsk = 1;
  t.store.state.members['prj_001:usr_004'] = { projectId: 'prj_001', userId: 'usr_004', discipline: 'Architect' };
  t.store.state.tasks.tsk_001.helperIds = ['usr_004'];
  return t;
}

const NEW = { id: 'tsk_001', reason: 'Client comments, 12 Oct', startDate: '2026-10-12', dueDate: '2026-10-20' };

describe('tasks.newVersion', () => {
  it('reopens the same task as version 2 with the checklist unticked and the new dates', async () => {
    const t = world();
    t.as('usr_003');
    const out = await t.api.call('tasks.newVersion', NEW);
    expect(out.task).toMatchObject({
      id: 'tsk_001', version: 2, status: 'todo', completedAt: null, startDate: '2026-10-12', dueDate: '2026-10-20',
    });
    expect(out.task.checklist.map((item) => item.done)).toEqual([false, false]);
    expect(out.task.versions).toEqual([
      { n: 1, reason: '', openedAt: STAMP, openedBy: 'usr_002', finishedAt: DONE },
      { n: 2, reason: 'Client comments, 12 Oct', openedAt: expect.any(String), openedBy: 'usr_003', finishedAt: null },
    ]);
    expect(Object.keys(t.store.state.tasks)).toEqual(['tsk_001']);
  });

  it('keeps the comments in one thread', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'First round done.' });
    await t.api.call('tasks.newVersion', NEW);
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Second round.' });
    const thread = await t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_001' });
    // The reason of the new version is one quiet line between the messages (fbk_027).
    expect(thread.map((view) => [view.kind, view.comment.body])).toEqual([['message', 'First round done.'], ['reopened', NEW.reason], ['message', 'Second round.']]);
  });

  it('gives a dynamic version its due date from the working days', async () => {
    const t = world();
    t.as('usr_002');
    const out = await t.api.call('tasks.newVersion', { id: 'tsk_001', reason: 'Revised brief', startDate: '2026-10-12', schedule: 'dynamic', durationDays: 6 });
    expect(out.task).toMatchObject({ schedule: 'dynamic', durationDays: 6, startDate: '2026-10-12', dueDate: dueFromDuration('2026-10-12', 6) });
  });

  it('counts on: version 3 closes version 2', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tasks.newVersion', NEW);
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    t.as('usr_002');
    await t.api.call('tasks.approve', { id: 'tsk_001' });
    const done = t.store.state.tasks.tsk_001.completedAt;
    const out = await t.api.call('tasks.newVersion', { id: 'tsk_001', reason: 'Second client round', startDate: '2026-10-25', dueDate: '2026-10-30' });
    expect(out.task.version).toBe(3);
    expect(out.task.versions?.map((v) => [v.n, v.finishedAt])).toEqual([[1, DONE], [2, done], [3, null]]);
  });

  it('works only on a done task', async () => {
    const t = world({ status: 'in_progress', completedAt: null });
    t.as('usr_003');
    await expect(t.api.call('tasks.newVersion', NEW)).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['id'] } });
    t.store.state.tasks.tsk_001.status = 'in_review';
    await expect(t.api.call('tasks.newVersion', NEW)).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('is open to the lead, the leader and the Admin, and no one else', async () => {
    for (const [userId, allowed] of [['usr_003', true], ['usr_002', true], ['usr_001', true], ['usr_004', false]] as const) {
      const t = world();
      t.as(userId);
      const result = t.api.call('tasks.newVersion', NEW);
      if (allowed) await expect(result).resolves.toMatchObject({ task: { version: 2 } });
      else await expect(result).rejects.toMatchObject({ code: 'forbidden' });
    }
    // A team member who neither leads nor helps is refused too.
    const t = world();
    t.store.state.members['prj_001:usr_005'] = { projectId: 'prj_001', userId: 'usr_005', discipline: 'Architect' };
    t.store.state.users.usr_005.ownerId = null;
    t.store.state.users.usr_005.kind = 'human';
    t.as('usr_005');
    await expect(t.api.call('tasks.newVersion', NEW)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('needs a reason', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('tasks.newVersion', { ...NEW, reason: '   ' })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['reason'] } });
  });

  it('follows the timing rules, and a refused call changes nothing', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('tasks.newVersion', { ...NEW, startDate: '2026-10-20', dueDate: '2026-10-12' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('tasks.newVersion', { id: 'tsk_001', reason: 'X', schedule: 'dynamic', startDate: '2026-10-12' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(t.store.state.tasks.tsk_001).toMatchObject({ status: 'done', checklist: [{ done: true }, { done: true }] });
    expect(t.store.state.tasks.tsk_001.version).toBeUndefined();
    expect(Object.keys(t.store.state.tracker ?? {})).toEqual([]);
  });

  it('logs an automatic Tracker entry from the client, with the reason as its note', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tasks.newVersion', NEW);
    const rows = await t.api.call('tracker.list', { projectId: 'prj_001' });
    expect(rows).toHaveLength(1);
    expect(rows[0].entry).toMatchObject({
      direction: 'in', type: 'message', title: 'Floor plans set: version 2', note: 'Client comments, 12 Oct', auto: 'version', waiting: null, createdBy: 'usr_003',
    });
  });

  it('puts the task back and removes the Tracker entry when Undo runs', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tasks.newVersion', NEW, { correlationId: 'cor_ui_version' });
    await t.api.call('events.undoStory', { correlationId: 'cor_ui_version' });
    expect(t.store.state.tasks.tsk_001).toMatchObject({
      status: 'done', completedAt: DONE, startDate: '2026-09-14', dueDate: '2026-09-28', version: 1,
    });
    expect(t.store.state.tasks.tsk_001.checklist.map((item) => item.done)).toEqual([true, true]);
    expect(await t.api.call('tracker.list', { projectId: 'prj_001' })).toEqual([]);
    // After Undo the task can open a version again, and it is still version 2.
    const again = await t.api.call('tasks.newVersion', NEW);
    expect(again.task.version).toBe(2);
  });

  it('shows the version in the task row and the history', async () => {
    const t = world();
    t.as('usr_003');
    const out = await t.api.call('tasks.newVersion', NEW);
    expect(out.history[0].event.verb).toBe('task.version_opened');
    const rows = await t.api.call('tasks.list', { projectId: 'prj_001' });
    expect(rows[0].task.version).toBe(2);
  });
});
