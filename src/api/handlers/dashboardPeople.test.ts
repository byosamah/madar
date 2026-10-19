import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { insightCalls } from './insights';
import type { State } from '../store';
import { buildSeed } from '../../data/seed';
import { addDays, setNow } from '../../lib/dates';
import { makeTask, makeWorld, NOW, STAMP, testApi, TODAY } from '../../test/factories';

beforeEach(() => setNow(NOW));

/** TODAY is Wednesday 2026-09-30. The office week starts on Sunday 2026-09-27. */
function world(): State {
  const state = makeWorld();
  state.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', dueDate: '2026-09-27', status: 'in_progress' });
  state.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_003', dueDate: '2026-09-29' });
  state.tasks.tsk_003 = makeTask({ id: 'tsk_003', ownerId: 'usr_003', dueDate: TODAY });
  state.tasks.tsk_004 = makeTask({ id: 'tsk_004', ownerId: 'usr_003', dueDate: '2026-10-01' });
  state.tasks.tsk_005 = makeTask({ id: 'tsk_005', ownerId: 'usr_003', dueDate: '2026-10-05' });
  state.tasks.tsk_006 = makeTask({ id: 'tsk_006', ownerId: 'usr_003', dueDate: '2026-10-12', status: 'in_review' });
  state.tasks.tsk_007 = makeTask({ id: 'tsk_007', ownerId: 'usr_003', helperIds: ['usr_004'], dueDate: '2026-09-28' });
  state.counters.tsk = 7;
  return state;
}

type Row = { user: { id: string }; overdue: number; counts: number[]; over: boolean[] };
const rowOf = (view: { workload: { rows: Row[] } }, id: string) => view.workload.rows.find((row) => row.user.id === id) as Row;

describe('the People tab of dashboard.get (owner, 2026-10-06)', () => {
  it('counts the past-due tasks of each person in Overdue, and only the tasks due from today on in the weeks', async () => {
    const d = await testApi(insightCalls, world()).api.call('dashboard.get', {});
    expect(d.workload.weeks).toEqual(['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18']);
    const sara = rowOf(d, 'usr_003');
    // Past due: tsk_001 (3 days), tsk_002 (1 day) and tsk_007 (2 days), each from day 1, like the "Past-due tasks" number.
    expect(sara.overdue).toBe(3);
    // Week 1 is today to Saturday: tsk_003 (today) and tsk_004. The task in review no longer counts for her.
    expect(sara.counts).toEqual([2, 1, 0, 0]);
    // A helper has the task too, as the Task list of that person shows it.
    expect(rowOf(d, 'usr_004').overdue).toBe(1);
    expect(d.tiles.overdueTasks).toBe(3);
  });

  it('counts a task in review in week 1 of each reviewer, not of the person who finished it', async () => {
    const state = world();
    const d = await testApi(insightCalls, state).api.call('dashboard.get', {});
    // Faisal leads the project, so he reviews it.
    expect(rowOf(d, 'usr_002').counts).toEqual([1, 0, 0, 0]);
    expect(rowOf(d, 'usr_001').counts).toEqual([0, 0, 0, 0]);
    // With no active leader, every active Admin reviews (reviewersOf).
    state.users.usr_002.active = false;
    const admins = await testApi(insightCalls, state).api.call('dashboard.get', {});
    expect(rowOf(admins, 'usr_001').counts).toEqual([1, 0, 0, 0]);
  });

  it('counts only the active projects in the filters', async () => {
    const state = world();
    state.projects.prj_001.status = 'on_hold';
    const d = await testApi(insightCalls, state).api.call('dashboard.get', {});
    expect(rowOf(d, 'usr_003')).toMatchObject({ overdue: 0, counts: [0, 0, 0, 0] });
    const other = await testApi(insightCalls, world()).api.call('dashboard.get', { leaderId: 'usr_001' });
    expect(rowOf(other, 'usr_003')).toMatchObject({ overdue: 0, counts: [0, 0, 0, 0] });
  });

  it('opens lists that hold what each cell counts, for every person of the sample office', async () => {
    const { api, store } = testApi(calls, await buildSeed(TODAY, async () => undefined));
    const d = await api.call('dashboard.get', {});
    let reviews = 0;
    let overdue = 0;
    for (const row of d.workload.rows) {
      const id = row.user.id;
      overdue += row.overdue;
      expect((await api.call('tasks.list', { filter: 'overdue', ownerId: id, includeDone: false })).length, id).toBe(row.overdue);
      for (const [i, week] of d.workload.weeks.entries()) {
        const from = i === 0 ? TODAY : week;
        const listed = await api.call('tasks.list', { workOf: id, dueFrom: from, dueTo: addDays(week, 6), includeDone: false });
        expect(listed.length, `${id} week ${i + 1}`).toBe(row.counts[i]);
        if (i === 0) reviews += listed.filter((r) => r.task.status === 'in_review').length;
      }
    }
    expect(overdue).toBe(d.tiles.overdueTasks);
    // The sample office has tasks in review, so the rule is checked on real rows.
    expect(reviews).toBeGreaterThan(0);
    expect(Object.values(store.state.tasks).some((t) => t.status === 'in_review')).toBe(true);
  });
});

// fbk_024: the open tasks with no lead have their own row in the same columns, so nobody has to count them by hand.
describe('the No lead row of dashboard.get (fbk_024)', () => {
  function unledWorld(): State {
    const state = world();
    state.tasks.tsk_008 = makeTask({ id: 'tsk_008', ownerId: null, dueDate: '2026-09-28' }); // past due
    state.tasks.tsk_009 = makeTask({ id: 'tsk_009', ownerId: null, dueDate: TODAY, status: 'in_progress' }); // week 1
    state.tasks.tsk_010 = makeTask({ id: 'tsk_010', ownerId: null, dueDate: '2026-10-06' }); // week 2
    state.tasks.tsk_011 = makeTask({ id: 'tsk_011', ownerId: null, dueDate: null }); // no date: in no column
    state.tasks.tsk_012 = makeTask({ id: 'tsk_012', ownerId: null, dueDate: '2026-09-29', status: 'done', completedAt: STAMP }); // finished
    state.counters.tsk = 12;
    return state;
  }

  it('counts the open tasks with no lead: past due, and due in each week from today', async () => {
    const d = await testApi(insightCalls, unledWorld()).api.call('dashboard.get', {});
    expect(d.workload.unassigned).toEqual({ overdue: 1, counts: [1, 1, 0, 0] });
    // The People rows stay as they were: a task with no lead is nobody's work.
    expect(rowOf(d, 'usr_003').overdue).toBe(3);
  });

  it('gives zeros when every task has a lead', async () => {
    const d = await testApi(insightCalls, world()).api.call('dashboard.get', {});
    expect(d.workload.unassigned).toEqual({ overdue: 0, counts: [0, 0, 0, 0] });
  });

  it('counts only the active projects in the filters, and the office tasks that the viewer sees', async () => {
    const state = unledWorld();
    state.tasks.tsk_013 = makeTask({ id: 'tsk_013', projectId: null, stageId: null, ownerId: null, createdBy: 'usr_003', dueDate: TODAY });
    state.counters.tsk = 13;
    const maker = testApi(insightCalls, state);
    maker.as('usr_003');
    expect((await maker.api.call('dashboard.get', {})).workload.unassigned?.counts).toEqual([2, 1, 0, 0]);
    // An outsider does not see the office task of another person, so it is not in the numbers.
    const outsider = testApi(insightCalls, state);
    outsider.as('usr_004');
    expect((await outsider.api.call('dashboard.get', {})).workload.unassigned?.counts).toEqual([1, 1, 0, 0]);
    // A people filter leaves the office tasks out, as it does in the lists.
    const filtered = testApi(insightCalls, state);
    filtered.as('usr_001');
    expect((await filtered.api.call('dashboard.get', { leaderId: 'usr_002' })).workload.unassigned?.counts).toEqual([1, 1, 0, 0]);
    const other = await filtered.api.call('dashboard.get', { leaderId: 'usr_001' });
    expect(other.workload.unassigned).toEqual({ overdue: 0, counts: [0, 0, 0, 0] });
    // A paused project is out of the numbers. The Admin still sees the office task.
    state.projects.prj_001.status = 'on_hold';
    const paused = testApi(insightCalls, state);
    paused.as('usr_001');
    expect((await paused.api.call('dashboard.get', {})).workload.unassigned).toEqual({ overdue: 0, counts: [1, 0, 0, 0] });
  });

  it('opens lists that hold what each cell counts', async () => {
    const { api } = testApi(calls, unledWorld());
    const d = await api.call('dashboard.get', {});
    const unassigned = d.workload.unassigned!;
    const yesterday = addDays(TODAY, -1);
    expect((await api.call('tasks.list', { filter: 'no_lead', dueTo: yesterday, includeDone: false })).map((row) => row.task.id)).toEqual(['tsk_008']);
    expect((await api.call('tasks.list', { filter: 'no_lead', dueTo: yesterday, includeDone: false })).length).toBe(unassigned.overdue);
    for (const [i, week] of d.workload.weeks.entries()) {
      const from = i === 0 ? TODAY : week;
      const listed = await api.call('tasks.list', { filter: 'no_lead', dueFrom: from, dueTo: addDays(week, 6), includeDone: false });
      expect(listed.length, `week ${i + 1}`).toBe(unassigned.counts[i]);
    }
  });

  it('counts the same on the sample office as the lists the cells open', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    const open = Object.values(state.tasks).filter((t) => t.projectId !== null && t.status === 'todo' && t.dueDate !== null && t.dueDate >= TODAY);
    open[0].ownerId = null;
    open[1].ownerId = null;
    const { api } = testApi(calls, state);
    const d = await api.call('dashboard.get', {});
    const unassigned = d.workload.unassigned!;
    expect(unassigned.overdue + unassigned.counts.reduce((sum, n) => sum + n, 0)).toBeGreaterThan(0);
    expect((await api.call('tasks.list', { filter: 'no_lead', dueTo: addDays(TODAY, -1), includeDone: false })).length).toBe(unassigned.overdue);
    for (const [i, week] of d.workload.weeks.entries()) {
      const listed = await api.call('tasks.list', { filter: 'no_lead', dueFrom: i === 0 ? TODAY : week, dueTo: addDays(week, 6), includeDone: false });
      expect(listed.length, `week ${i + 1}`).toBe(unassigned.counts[i]);
    }
  });
});

describe('tasks.list workOf (owner, 2026-10-06)', () => {
  it('lists the open tasks of the person that are not in review, and the tasks in review that the person reviews', async () => {
    const { api } = testApi(calls, world());
    const ids = async (input: Parameters<typeof api.call<'tasks.list'>>[1]) => (await api.call('tasks.list', input)).map((row) => row.task.id).sort();
    expect(await ids({ workOf: 'usr_003' })).toEqual(['tsk_001', 'tsk_002', 'tsk_003', 'tsk_004', 'tsk_005', 'tsk_007']);
    expect(await ids({ workOf: 'usr_002' })).toEqual(['tsk_006']);
    // A task in review passes a due range only when the range holds today, as the Dashboard counts it in week 1.
    expect(await ids({ workOf: 'usr_002', dueFrom: TODAY, dueTo: '2026-10-03' })).toEqual(['tsk_006']);
    expect(await ids({ workOf: 'usr_002', dueFrom: '2026-10-11', dueTo: '2026-10-17' })).toEqual([]);
    expect(await ids({ workOf: 'usr_003', dueFrom: TODAY, dueTo: '2026-10-03' })).toEqual(['tsk_003', 'tsk_004']);
  });
});
