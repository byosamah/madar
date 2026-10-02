import { beforeEach, describe, expect, it } from 'vitest';
import { taskCalls } from './tasks';
import { historyCalls } from './history';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const calls = { ...taskCalls, ...historyCalls };

function world(overrides = {}) {
  const t = testApi(calls);
  t.as('usr_002');
  t.store.state.tasks.tsk_001 = makeTask(overrides);
  t.store.state.counters.tsk = 1;
  return t;
}

const refusal = (field: string, reason: string) => ({ code: 'invalid_input', details: { fields: [field], reason } });

describe('tasks.create with a start date', () => {
  it('makes a static task by default, with a start and a due date that people set', async () => {
    const t = world();
    const { task } = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Roof plan', startDate: '2026-10-04', dueDate: '2026-10-15' });
    expect(task).toMatchObject({ startDate: '2026-10-04', schedule: 'static', durationDays: null, dueDate: '2026-10-15' });
  });

  it('works out the due date of a dynamic task in working days', async () => {
    const t = world();
    const { task } = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Roof plan', schedule: 'dynamic', startDate: '2026-10-07', durationDays: 5 });
    expect(task).toMatchObject({ schedule: 'dynamic', durationDays: 5, dueDate: '2026-10-13' });
  });

  it('refuses a dynamic task without a start or a duration, and refuses a due date it would ignore', async () => {
    const t = world();
    const base = { projectId: 'prj_001', title: 'Roof plan', schedule: 'dynamic' as const };
    await expect(t.api.call('tasks.create', { ...base, durationDays: 5 })).rejects.toMatchObject(refusal('startDate', 'dynamic_needs_start'));
    await expect(t.api.call('tasks.create', { ...base, startDate: '2026-10-04' })).rejects.toMatchObject(refusal('durationDays', 'dynamic_needs_duration'));
    await expect(t.api.call('tasks.create', { ...base, startDate: '2026-10-04', durationDays: 5, dueDate: '2026-10-30' }))
      .rejects.toMatchObject(refusal('dueDate', 'dynamic_due_date'));
  });

  it('refuses a due date before the start date, and a duration outside 1 to 365', async () => {
    const t = world();
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'X', startDate: '2026-10-10', dueDate: '2026-10-09' }))
      .rejects.toMatchObject(refusal('dueDate', 'due_before_start'));
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'X', schedule: 'dynamic', startDate: '2026-10-10', durationDays: 0 }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'X', schedule: 'dynamic', startDate: '2026-10-10', durationDays: 366 }))
      .rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('tasks.update with a start date', () => {
  it('moves the due date with the start for a dynamic task', async () => {
    const t = world({ schedule: 'dynamic', startDate: '2026-10-04', durationDays: 5, dueDate: '2026-10-08' });
    const { task } = await t.api.call('tasks.update', { id: 'tsk_001', patch: { startDate: '2026-10-07' }, dateReason: 'The brief changed' });
    expect(task).toMatchObject({ startDate: '2026-10-07', durationDays: 5, dueDate: '2026-10-13' });
  });

  it('works out the due date again when the duration changes', async () => {
    const t = world({ schedule: 'dynamic', startDate: '2026-10-04', durationDays: 5, dueDate: '2026-10-08' });
    const { task } = await t.api.call('tasks.update', { id: 'tsk_001', patch: { durationDays: 6 }, dateReason: 'The brief changed' });
    expect(task.dueDate).toBe('2026-10-11');
  });

  it('refuses a due date for a dynamic task', async () => {
    const t = world({ schedule: 'dynamic', startDate: '2026-10-04', durationDays: 5, dueDate: '2026-10-08' });
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-20' }, dateReason: 'The brief changed' })).rejects.toMatchObject(refusal('dueDate', 'dynamic_due_date'));
    expect(t.store.state.tasks.tsk_001.dueDate).toBe('2026-10-08');
  });

  it('never moves the due date of a static task when the start moves', async () => {
    const t = world({ startDate: '2026-10-04', dueDate: '2026-10-15' });
    const { task } = await t.api.call('tasks.update', { id: 'tsk_001', patch: { startDate: '2026-10-06' }, dateReason: 'The brief changed' });
    expect(task).toMatchObject({ startDate: '2026-10-06', dueDate: '2026-10-15' });
  });

  it('refuses a static start after the due date, and a static due date before the start', async () => {
    const t = world({ startDate: '2026-10-04', dueDate: '2026-10-15' });
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { startDate: '2026-10-20' }, dateReason: 'The brief changed' })).rejects.toMatchObject(refusal('startDate', 'due_before_start'));
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { dueDate: '2026-10-01' }, dateReason: 'The brief changed' })).rejects.toMatchObject(refusal('dueDate', 'due_before_start'));
    expect(t.store.state.tasks.tsk_001).toMatchObject({ startDate: '2026-10-04', dueDate: '2026-10-15' });
  });

  it('keeps the current due date when a dynamic task becomes static', async () => {
    const t = world({ schedule: 'dynamic', startDate: '2026-10-04', durationDays: 5, dueDate: '2026-10-08' });
    const { task } = await t.api.call('tasks.update', { id: 'tsk_001', patch: { schedule: 'static' }, dateReason: 'The brief changed' });
    expect(task).toMatchObject({ schedule: 'static', durationDays: null, dueDate: '2026-10-08', startDate: '2026-10-04' });
    const moved = await t.api.call('tasks.update', { id: 'tsk_001', patch: { startDate: '2026-10-06' }, dateReason: 'The brief changed' });
    expect(moved.task.dueDate).toBe('2026-10-08');
  });

  it('needs a start and a duration when a static task becomes dynamic', async () => {
    const t = world({ dueDate: '2026-10-15' });
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { schedule: 'dynamic', durationDays: 5 }, dateReason: 'The brief changed' })).rejects.toMatchObject(refusal('startDate', 'dynamic_needs_start'));
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { schedule: 'dynamic', startDate: '2026-10-11' }, dateReason: 'The brief changed' })).rejects.toMatchObject(refusal('durationDays', 'dynamic_needs_duration'));
    const { task } = await t.api.call('tasks.update', { id: 'tsk_001', patch: { schedule: 'dynamic', startDate: '2026-10-09', durationDays: 3 }, dateReason: 'The brief changed' });
    expect(task).toMatchObject({ schedule: 'dynamic', durationDays: 3, dueDate: '2026-10-13' });
  });

  it('loads and edits an old task that has none of the new fields', async () => {
    const t = world({ dueDate: '2026-10-15' });
    const old = t.store.state.tasks.tsk_001 as Record<string, unknown>;
    delete old.startDate;
    delete old.schedule;
    delete old.durationDays;
    const { task } = await t.api.call('tasks.get', { id: 'tsk_001' });
    expect(task.dueDate).toBe('2026-10-15');
    const renamed = await t.api.call('tasks.update', { id: 'tsk_001', patch: { title: 'New name' }, dateReason: 'The brief changed' });
    expect(renamed.task).toMatchObject({ title: 'New name', dueDate: '2026-10-15' });
    expect(renamed.task.startDate ?? null).toBeNull();
    const dated = await t.api.call('tasks.update', { id: 'tsk_001', patch: { startDate: '2026-10-04' }, dateReason: 'The brief changed' });
    expect(dated.task).toMatchObject({ startDate: '2026-10-04', dueDate: '2026-10-15' });
  });

  it('brings back the start, the mode, the duration and the due date with Undo', async () => {
    const t = world({ schedule: 'dynamic', startDate: '2026-10-04', durationDays: 5, dueDate: '2026-10-08' });
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { schedule: 'static', startDate: '2026-10-05' }, dateReason: 'The brief changed' });
    expect(t.store.state.tasks.tsk_001).toMatchObject({ schedule: 'static', durationDays: null, startDate: '2026-10-05', dueDate: '2026-10-08' });
    const [latest] = await t.api.call('events.list', { targetType: 'task', targetId: 'tsk_001' });
    await t.api.call('events.undo', { eventId: latest.event.id });
    expect(t.store.state.tasks.tsk_001).toMatchObject({ schedule: 'dynamic', durationDays: 5, startDate: '2026-10-04', dueDate: '2026-10-08' });

    await t.api.call('tasks.update', { id: 'tsk_001', patch: { startDate: '2026-10-07' }, dateReason: 'The brief changed' });
    expect(t.store.state.tasks.tsk_001.dueDate).toBe('2026-10-13');
    const [moved] = await t.api.call('events.list', { targetType: 'task', targetId: 'tsk_001' });
    await t.api.call('events.undo', { eventId: moved.event.id });
    expect(t.store.state.tasks.tsk_001).toMatchObject({ startDate: '2026-10-04', dueDate: '2026-10-08' });
  });
});
