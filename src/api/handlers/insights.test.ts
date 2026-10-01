import { beforeEach, describe, expect, it } from 'vitest';
import { insightCalls } from './insights';
import type { State } from '../store';
import { makeTask, makeWorld, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

function world(): State {
  const state = makeWorld();
  state.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', dueDate: '2026-09-28', status: 'in_progress' });
  state.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_003', dueDate: '2026-10-01', createdAt: '2026-09-01T09:00:00.000+03:00' });
  state.tasks.tsk_003 = makeTask({
    id: 'tsk_003', ownerId: 'usr_002', status: 'done', createdAt: '2026-09-20T09:00:00.000+03:00', completedAt: '2026-09-29T09:00:00.000+03:00',
  });
  state.deadlines.ddl_001 = { id: 'ddl_001', projectId: 'prj_001', stageId: null, name: 'Client presentation', date: '2026-10-12' };
  state.deadlines.ddl_002 = { id: 'ddl_002', projectId: 'prj_001', stageId: null, name: 'Permit', date: '2026-11-30' };
  return state;
}

describe('dashboard.get', () => {
  it('counts the tiles and the health mix', async () => {
    const d = await testApi(insightCalls, world()).api.call('dashboard.get', {});
    expect(d.tiles).toEqual({
      activeProjects: 1, atRiskOrLate: 1, overdueTasks: 1, deadlinesNext14: 1,
      areaInDesign: 1000,
    });
    expect(d.charts.healthMix).toEqual({ on_track: 0, at_risk: 1, late: 0 });
    expect(d.charts.projectsPerStage).toEqual([{ stage: 'Schematic Design', count: 1 }]);
    expect(d.schedule.map((row) => row.project.code)).toEqual(['KH-26-001']);
  });

  it('counts created and done tasks per week for 12 weeks', async () => {
    const d = await testApi(insightCalls, world()).api.call('dashboard.get', {});
    expect(d.charts.throughput).toHaveLength(12);
    expect(d.charts.throughput[10]).toEqual({ weekStart: '2026-09-20', created: 1, done: 0 });
    expect(d.charts.throughput[11]).toEqual({ weekStart: '2026-09-27', created: 1, done: 1 });
  });

  it('flags overloaded people in the workload grid', async () => {
    const state = world();
    state.settings.workloadLimit = 1;
    state.tasks.tsk_004 = makeTask({ id: 'tsk_004', ownerId: 'usr_003', dueDate: '2026-10-02' });
    const d = await testApi(insightCalls, state).api.call('dashboard.get', {});
    expect(d.workload.weeks).toEqual(['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18']);
    const sara = d.workload.rows.find((row) => row.user.id === 'usr_003');
    expect(sara?.counts).toEqual([3, 0, 0, 0]);
    expect(sara?.over).toEqual([true, false, false, false]);
  });
});

describe('search.query', () => {
  it('ignores case and letter forms', async () => {
    const state = world();
    state.users.usr_004.name = 'أحمد';
    const { api } = testApi(insightCalls, state);
    expect((await api.call('search.query', { text: 'TEST tower' })).projects.map((p) => p.code)).toEqual(['KH-26-001']);
    expect((await api.call('search.query', { text: 'ground floor' })).tasks).toHaveLength(3);
    expect((await api.call('search.query', { text: 'احمد' })).people.map((p) => p.id)).toEqual(['usr_004']);
  });
});
