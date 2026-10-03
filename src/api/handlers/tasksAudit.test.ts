import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeTask, NOW, testApi, TODAY } from '../../test/factories';
import { addDays, setNow } from '../../lib/dates';
import { buildSeed } from '../../data/seed';

beforeEach(() => setNow(NOW));

// Faisal (usr_002) leads prj_001 and reviews, Sara (usr_003) is on the team.
const shifts = (t: ReturnType<typeof testApi>) => Object.values(t.store.state.tracker ?? {}).filter((entry) => entry.auto === 'shift');

describe('A task that finishes late twice moves its dependent once (audit 2026-10-03, API-3)', () => {
  function world() {
    setNow(new Date('2026-09-23T06:00:00Z')); // Wed 23 Sep
    const t = testApi(calls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', title: 'Task A', needsReview: false, dueDate: '2026-09-21' }); // Mon
    s.tasks.tsk_002 = makeTask({
      id: 'tsk_002', ownerId: 'usr_003', title: 'Task B', schedule: 'dynamic', startDate: '2026-09-27', durationDays: 3, dueDate: '2026-09-29', prerequisiteIds: ['tsk_001'],
    });
    s.counters.tsk = 2;
    t.as('usr_003');
    return t;
  }

  it('does not move it again when the task is unticked and ticked the same day', async () => {
    const t = world();
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    expect(t.store.state.tasks.tsk_002.startDate).toBe('2026-09-29');
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo' });
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    expect(t.store.state.tasks.tsk_002.startDate).toBe('2026-09-29');
    expect(t.store.state.tasks.tsk_002.dateNotes).toHaveLength(1);
    expect(shifts(t)).toHaveLength(1);
  });

  it('moves it only by the new days when the task finishes again later', async () => {
    const t = world();
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo' });
    setNow(new Date('2026-09-24T06:00:00Z')); // Thu 24 Sep: 3 working days late
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    const b = t.store.state.tasks.tsk_002;
    expect(b.startDate).toBe('2026-09-30');
    expect(b.dateNotes?.[1]).toMatchObject({ lateDays: 3, reason: 'Task A finished 3 working days late' });
    expect(shifts(t).map((entry) => entry.title)).toEqual(['Task B moved 2 working days', 'Task B moved 1 working day']);
  });

  it('moves it by the full lateness when a new version with a new due date finishes late (audit 2026-10-03, V-3)', async () => {
    setNow(new Date('2026-09-30T06:00:00Z')); // Wed 30 Sep
    const t = testApi(calls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', title: 'Task A', needsReview: false, dueDate: '2026-09-27' }); // Sun
    s.tasks.tsk_002 = makeTask({
      id: 'tsk_002', ownerId: 'usr_003', title: 'Task B', schedule: 'dynamic', startDate: '2026-10-04', durationDays: 3, dueDate: '2026-10-06', prerequisiteIds: ['tsk_001'],
    });
    s.counters.tsk = 2;
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' }); // 3 working days late
    expect(s.tasks.tsk_002.startDate).toBe('2026-10-07');
    expect(s.tasks.tsk_002.dateNotes?.[0]).toMatchObject({ lateDays: 3, forDueDate: '2026-09-27' });
    await t.api.call('tasks.newVersion', { id: 'tsk_001', reason: 'Client asked for a second option', dueDate: '2026-10-08' });
    setNow(new Date('2026-10-12T06:00:00Z')); // Mon 12 Oct: 2 working days after Thu 8 Oct
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    expect(s.tasks.tsk_002.startDate).toBe('2026-10-11');
    expect(s.tasks.tsk_002.dueDate).toBe('2026-10-13');
    expect(s.tasks.tsk_002.dateNotes?.[1]).toMatchObject({ lateDays: 2, forDueDate: '2026-10-08' });
    expect(shifts(t).map((entry) => entry.title)).toEqual(['Task B moved 3 working days', 'Task B moved 2 working days']);
  });
});

describe('Review time is not the owner lateness (audit 2026-10-03, API-4)', () => {
  function world(today: string) {
    setNow(new Date(`${today}T06:00:00Z`));
    const t = testApi(calls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', title: 'Ground floor plan', needsReview: true, dueDate: '2026-09-28' }); // Mon
    s.tasks.tsk_002 = makeTask({
      id: 'tsk_002', ownerId: 'usr_003', title: 'Task B', schedule: 'dynamic', startDate: '2026-10-04', durationDays: 3, dueDate: '2026-10-06', prerequisiteIds: ['tsk_001'],
    });
    s.counters.tsk = 2;
    t.as('usr_003');
    return t;
  }

  it('does not move the dependent when the owner sent it to review on the due day', async () => {
    const t = world('2026-09-28');
    expect((await t.api.call('tasks.complete', { id: 'tsk_001' })).result).toBe('in_review');
    setNow(new Date('2026-10-01T06:00:00Z')); // Thu 1 Oct, the leader approves
    t.as('usr_002');
    await t.api.call('tasks.approve', { id: 'tsk_001' });
    expect(t.store.state.tasks.tsk_002.startDate).toBe('2026-10-04');
    expect(shifts(t)).toHaveLength(0);
  });

  it('measures the lateness to the day the owner sent it to review', async () => {
    const t = world('2026-09-30'); // Wed 30 Sep: 2 working days late
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    setNow(new Date('2026-10-05T06:00:00Z')); // Mon 5 Oct
    t.as('usr_002');
    await t.api.call('tasks.approve', { id: 'tsk_001' });
    expect(t.store.state.tasks.tsk_002.dateNotes?.[0]).toMatchObject({ lateDays: 2 });
    expect(t.store.state.tasks.tsk_002.startDate).toBe('2026-10-06');
  });
});

describe('Only a forward stage move tells the team (audit 2026-10-03, API-15)', () => {
  it('tells Sara once for a task added to an earlier stage and ticked', async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', stageId: 'stg_002', ownerId: 'usr_003', title: 'SD work' });
    t.store.state.counters.tsk = 2;
    t.as('usr_002');
    const made = await t.api.call('tasks.create', { projectId: 'prj_001', stageId: 'stg_001', title: 'Fix a concept sketch', reason: 'Client asked for a change' });
    const told = () => Object.values(t.store.state.notifications).filter((n) => n.userId === 'usr_003' && n.trigger === 'stage_changed');
    expect(told()).toHaveLength(0);
    await t.api.call('tasks.complete', { id: made.task.id });
    expect(told()).toHaveLength(1);
  });
});

describe('A team member may send the default review setting (audit 2026-10-03, API-21)', () => {
  it('accepts needsReview true and still refuses false', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    const made = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'My sketch', needsReview: true });
    expect(made.task.needsReview).toBe(true);
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'Skip review', needsReview: false })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('The status menu and the board follow the review rules (audit 2026-10-03, PRJ-2)', () => {
  function world() {
    const t = testApi(calls);
    t.store.state.tasks.tsk_010 = makeTask({ id: 'tsk_010', ownerId: 'usr_003', status: 'in_review' });
    t.store.state.counters.tsk = 10;
    return t;
  }
  const approved = (t: ReturnType<typeof world>) => Object.values(t.store.state.notifications).filter((n) => n.userId === 'usr_003' && n.trigger === 'task_approved');

  it('approves when the reviewer moves the task to Done, and tells the owner', async () => {
    const t = world();
    t.as('usr_002');
    expect((await t.api.call('tasks.move', { id: 'tsk_010', status: 'done' })).result).toBe('done');
    expect(approved(t)).toHaveLength(1);
    expect(Object.values(t.store.state.events).some((e) => e.verb === 'task.approved' && e.targetId === 'tsk_010')).toBe(true);
  });

  it('approves when the reviewer ticks the task', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tasks.complete', { id: 'tsk_010' });
    expect(approved(t)).toHaveLength(1);
  });

  it('refuses a reviewer move back to In progress or To do, with a reason', async () => {
    const t = world();
    t.as('usr_002');
    await expect(t.api.call('tasks.move', { id: 'tsk_010', status: 'in_progress' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'review_send_back' } });
    t.as('usr_001');
    await expect(t.api.call('tasks.move', { id: 'tsk_010', status: 'todo' })).rejects.toMatchObject({ details: { reason: 'review_send_back' } });
    expect(t.store.state.tasks.tsk_010.status).toBe('in_review');
    expect(Object.values(t.store.state.notifications)).toHaveLength(0);
  });
});

describe('The Task list keeps the Team filter of the Dashboard (audit 2026-10-03, V-37a)', () => {
  it('lists as many past-due tasks and deadlines as the Dashboard counts for each team', async () => {
    const t = testApi(calls, await buildSeed(TODAY, async () => undefined));
    const all = await t.api.call('tasks.list', { filter: 'overdue', includeDone: false });
    let narrower = false;
    for (const team of await t.api.call('teams.list', {})) {
      const { tiles } = await t.api.call('dashboard.get', { teamId: team.id });
      const tasks = await t.api.call('tasks.list', { filter: 'overdue', includeDone: false, teamId: team.id });
      expect(tasks).toHaveLength(tiles.overdueTasks);
      const deadlines = await t.api.call('deadlines.list', { from: TODAY, to: addDays(TODAY, 14), teamId: team.id });
      expect(deadlines).toHaveLength(tiles.deadlinesNext14);
      if (tasks.length < all.length) narrower = true;
    }
    expect(narrower).toBe(true);
  });

  it('lists nothing for a team that does not exist, like the Dashboard', async () => {
    const t = testApi(calls, await buildSeed(TODAY, async () => undefined));
    expect(await t.api.call('tasks.list', { teamId: 'tm_999' })).toEqual([]);
    expect(await t.api.call('deadlines.list', { teamId: 'tm_999' })).toEqual([]);
  });
});
