import { beforeEach, describe, expect, it } from 'vitest';
import { insightCalls } from './insights';
import type { State } from '../store';
import { makeTask, makeWorld, NOW, STAMP, testApi } from '../../test/factories';
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

  it('leaves out the area of a project in the last stage of the office, whatever its name (audit 2026-10-03, DSH-16)', async () => {
    const state = world();
    state.settings.defaultStages = ['Concept', 'Schematic Design', 'الإشراف'];
    state.stages.stg_002.name = 'الإشراف';
    expect((await testApi(insightCalls, state).api.call('dashboard.get', {})).tiles.areaInDesign).toBe(0);
    state.stages.stg_002.name = 'Schematic Design';
    expect((await testApi(insightCalls, state).api.call('dashboard.get', {})).tiles.areaInDesign).toBe(1000);
  });

  it('gives each schedule row its health, as the health mix counts it', async () => {
    const d = await testApi(insightCalls, world()).api.call('dashboard.get', {});
    expect(d.schedule.map((row) => row.health)).toEqual(['at_risk']);
    const state = world();
    state.projects.prj_001.healthOverride = { value: 'late', reason: 'Client paused the work', setBy: 'usr_001', setAt: '2026-09-30T09:00:00.000+03:00' };
    const late = await testApi(insightCalls, state).api.call('dashboard.get', {});
    expect(late.schedule[0].health).toBe('late');
    expect(late.charts.healthMix.late).toBe(1);
  });

  it('counts created and done tasks per week for 12 weeks', async () => {
    const d = await testApi(insightCalls, world()).api.call('dashboard.get', {});
    expect(d.charts.throughput).toHaveLength(12);
    expect(d.charts.throughput[10]).toEqual({ weekStart: '2026-09-20', created: 1, done: 0 });
    expect(d.charts.throughput[11]).toEqual({ weekStart: '2026-09-27', created: 1, done: 1 });
  });

  it('counts the open client items of each schedule row, for us and for the client', async () => {
    const state = world();
    const base = {
      projectId: 'prj_001', type: 'message' as const, note: '', date: '2026-09-28', closedAt: null, closedBy: null, fileIds: [], peopleIds: [], auto: null, createdBy: 'usr_002', createdAt: STAMP,
    };
    state.tracker = {
      trk_001: { ...base, id: 'trk_001', direction: 'out', title: 'We asked for the signed brief', waiting: 'client' },
      trk_002: { ...base, id: 'trk_002', direction: 'in', title: 'Client asked about the lobby', waiting: 'us' },
      trk_003: { ...base, id: 'trk_003', direction: 'in', title: 'Client asked for the lease plan', waiting: 'us' },
      trk_004: { ...base, id: 'trk_004', direction: 'in', title: 'Closed question', waiting: 'us', closedAt: STAMP, closedBy: 'usr_002' },
      trk_005: { ...base, id: 'trk_005', direction: 'out', title: 'Closed request', waiting: 'client', closedAt: STAMP, closedBy: 'usr_002' },
      trk_006: { ...base, id: 'trk_006', direction: 'in', title: 'A note with no loop', waiting: null },
    };
    const d = await testApi(insightCalls, state).api.call('dashboard.get', {});
    expect(d.schedule[0].openLoops).toEqual({ us: 2, client: 1 });
    const none = world();
    delete none.tracker;
    expect((await testApi(insightCalls, none).api.call('dashboard.get', {})).schedule[0].openLoops).toEqual({ us: 0, client: 0 });
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

  // The workload number opens the Task list of that person, which lists the tasks they lead and the ones they help on.
  // The number counts the same tasks, so the two always agree (audit PER-4).
  it('counts a task a person helps on in their workload, like the list it opens', async () => {
    const state = world();
    state.tasks.tsk_004 = makeTask({ id: 'tsk_004', ownerId: 'usr_003', helperIds: ['usr_002'], dueDate: '2026-10-02' });
    const d = await testApi(insightCalls, state).api.call('dashboard.get', {});
    const helper = d.workload.rows.find((row) => row.user.id === 'usr_002');
    expect(helper?.counts[0]).toBeGreaterThanOrEqual(1);
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

  // Posts and comments write a project link as "#KH-26-001", so people paste that form (audit PER-3).
  it('finds a project code written with a leading #, and treats a lone # as no search', async () => {
    const { api } = testApi(insightCalls, world());
    expect((await api.call('search.query', { text: '#KH-26-001' })).projects.map((p) => p.code)).toEqual(['KH-26-001']);
    expect(await api.call('search.query', { text: '#' })).toEqual({ projects: [], tasks: [], people: [], files: [] });
  });
});
