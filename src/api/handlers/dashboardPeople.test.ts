import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { insightCalls } from './insights';
import type { State } from '../store';
import { buildSeed } from '../../data/seed';
import { addDays, setNow } from '../../lib/dates';
import { makeTask, makeWorld, NOW, testApi, TODAY } from '../../test/factories';

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
