import { beforeEach, describe, expect, it } from 'vitest';
import { insightCalls } from './insights';
import type { State } from '../store';
import { makeProject, makeStage, makeTask, makeWorld, NOW, STAMP, testApi, TODAY } from '../../test/factories';
import { calls } from '../calls';
import { buildSeed } from '../../data/seed';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

function world(): State {
  const state = makeWorld();
  // 3 days past due, so the project is at risk (owner, 2026-10-06).
  state.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', dueDate: '2026-09-27', status: 'in_progress' });
  state.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_003', dueDate: '2026-10-01', createdAt: '2026-09-01T09:00:00.000+03:00' });
  state.tasks.tsk_003 = makeTask({
    id: 'tsk_003', ownerId: 'usr_002', status: 'done', createdAt: '2026-09-20T09:00:00.000+03:00', completedAt: '2026-09-29T09:00:00.000+03:00',
  });
  state.deadlines.ddl_001 = { id: 'ddl_001', projectId: 'prj_001', stageId: null, name: 'Client presentation', date: '2026-10-12' };
  state.deadlines.ddl_002 = { id: 'ddl_002', projectId: 'prj_001', stageId: null, name: 'Permit', date: '2026-11-30' };
  // A last stage with no task yet, as a real project has, so the project is in design (audit 2026-10-03, V-17).
  state.stages.stg_003 = makeStage({ id: 'stg_003', name: 'Supervision', order: 2, startDate: '2026-11-01', endDate: '2027-06-30' });
  state.counters.stg = 3;
  return state;
}

/** Puts the open tasks of prj_001 in its last stage, so its stage tag is that stage. */
function onSite(state: State, lastStageName: string): State {
  state.stages.stg_003.name = lastStageName;
  for (const task of Object.values(state.tasks)) if (task.status !== 'done') task.stageId = 'stg_003';
  return state;
}

describe('dashboard.get', () => {
  // The Leader filter of the Dashboard reads this list, so the screen loads no summary of every project (cleanup 2026-10-06).
  it('names the people who lead a project in the status, whatever the leader, client and team filters say', async () => {
    const state = world();
    state.projects.prj_002 = makeProject({ id: 'prj_002', code: 'KH-26-002', leaderId: 'usr_003', status: 'on_hold' });
    state.projects.prj_003 = makeProject({ id: 'prj_003', code: 'KH-26-003', leaderId: 'usr_004', status: 'completed' });
    state.projects.prj_004 = makeProject({ id: 'prj_004', code: 'KH-26-004', leaderId: 'usr_002', clientId: null });
    state.counters.prj = 4;
    const { api } = testApi(insightCalls, state);
    const leaders = async (input: Parameters<typeof api.call<'dashboard.get'>>[1]) => (await api.call('dashboard.get', input)).leaders.map((user) => user.id);
    expect(await leaders({})).toEqual(['usr_002']);
    expect(await leaders({ status: 'on_hold' })).toEqual(['usr_003']);
    // All statuses: the active and the paused projects, as the schedule rows.
    expect(await leaders({ status: 'all' })).toEqual(['usr_002', 'usr_003']);
    expect(await leaders({ status: 'all', leaderId: 'usr_003', clientId: 'cli_009' })).toEqual(['usr_002', 'usr_003']);
  });

  it('counts the tiles and the health mix', async () => {
    const d = await testApi(insightCalls, world()).api.call('dashboard.get', {});
    expect(d.tiles).toEqual({
      activeProjects: 1, atRiskOrLate: 1, overdueTasks: 1, deadlinesNext14: 1,
      areaInDesign: 1000, inDesignWithoutArea: 0,
    });
    expect(d.charts.healthMix).toEqual({ on_track: 0, at_risk: 1, late: 0 });
    expect(d.charts.projectsPerStage).toEqual([{ stage: 'Schematic Design', count: 1 }]);
    expect(d.schedule.map((row) => row.project.code)).toEqual(['KH-26-001']);
  });

  // A task 1 or 2 days past due counts in "Past-due tasks" from day 1, but marks its project At risk only from day 3 (owner, 2026-10-06).
  it('counts a task 2 days past due as past due, but not its project as at risk', async () => {
    const state = world();
    state.tasks.tsk_001.dueDate = '2026-09-28';
    const d = await testApi(insightCalls, state).api.call('dashboard.get', {});
    expect(d.tiles.overdueTasks).toBe(1);
    expect(d.tiles.atRiskOrLate).toBe(0);
    expect(d.charts.healthMix).toEqual({ on_track: 1, at_risk: 0, late: 0 });
  });

  it('leaves out the area of a project in its own last stage, whatever its name (audit 2026-10-03, DSH-16, V-17)', async () => {
    const area = async (state: State) => (await testApi(insightCalls, state).api.call('dashboard.get', {})).tiles.areaInDesign;
    expect(await area(world())).toBe(1000);
    const arabic = onSite(world(), 'الإشراف');
    arabic.settings.defaultStages = ['Concept', 'Schematic Design', 'الإشراف'];
    expect(await area(arabic)).toBe(0);
    // The Admin renames the last stage of the office list. Older projects keep their own stage name and stay out of design.
    const renamed = onSite(world(), 'Supervision');
    renamed.settings.defaultStages = [...renamed.settings.defaultStages.slice(0, -1), 'Site supervision'];
    expect(await area(renamed)).toBe(0);
    // A name that only this project uses.
    expect(await area(onSite(world(), 'Site supervision'))).toBe(0);
  });

  // The area in design reads low when a project has no area, so the Dashboard says how many (owner, 2026-10-06, item 4).
  it('counts the projects in design that have no area', async () => {
    const state = world();
    const d = await testApi(insightCalls, state).api.call('dashboard.get', {});
    expect(d.tiles.inDesignWithoutArea).toBe(0);
    state.projects.prj_001.areaM2 = null;
    expect((await testApi(insightCalls, state).api.call('dashboard.get', {})).tiles).toMatchObject({ areaInDesign: 0, inDesignWithoutArea: 1 });
    // On site, or paused: not in design, so not a gap of this number.
    expect((await testApi(insightCalls, onSite(structuredClone(state), 'Supervision')).api.call('dashboard.get', {})).tiles.inDesignWithoutArea).toBe(0);
    state.projects.prj_001.status = 'on_hold';
    expect((await testApi(insightCalls, state).api.call('dashboard.get', {})).tiles.inDesignWithoutArea).toBe(0);
  });

  it('takes the last stage of the project list, so a stage with no dates yet never becomes the last stage (audit 2026-10-03, V-17)', async () => {
    const area = async (state: State) => (await testApi(insightCalls, state).api.call('dashboard.get', {})).tiles.areaInDesign;
    // Schematic Design, in the middle of the list, has no dates. The open tasks sit in Supervision, the last stage of the list.
    const state = onSite(world(), 'Supervision');
    state.stages.stg_002.startDate = null;
    state.stages.stg_002.endDate = null;
    expect(await area(state)).toBe(0);
    // With the open tasks in the undated design stage, the tag is that stage, and the project is in design.
    for (const task of Object.values(state.tasks)) if (task.status !== 'done') task.stageId = 'stg_002';
    expect(await area(state)).toBe(1000);
  });

  it('counts a project with one stage as in design, because it has no separate site stage (audit 2026-10-03, V-17)', async () => {
    const area = async (state: State) => (await testApi(insightCalls, state).api.call('dashboard.get', {})).tiles.areaInDesign;
    const state = world();
    delete state.stages.stg_002;
    delete state.stages.stg_003;
    for (const task of Object.values(state.tasks)) task.stageId = 'stg_001';
    expect(await area(state)).toBe(1000);
    const t = testApi(calls, world());
    t.as('usr_001');
    await t.api.call('projects.create', { name: 'Small fit-out', areaM2: 500, stages: ['Design'] });
    expect((await t.api.call('dashboard.get', {})).tiles.areaInDesign).toBe(1500);
  });

  it('keeps the area in design of the sample office when the Admin renames the last default stage (audit 2026-10-03, V-17)', async () => {
    const { api } = testApi(calls, await buildSeed(TODAY, async () => undefined));
    const before = (await api.call('dashboard.get', { status: 'active' })).tiles.areaInDesign;
    const stages = (await api.call('settings.get', {})).defaultStages;
    await api.call('settings.update', { defaultStages: [...stages.slice(0, -1), 'Site supervision'] });
    expect((await api.call('dashboard.get', { status: 'active' })).tiles.areaInDesign).toBe(before);
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
    // tsk_001 is past due, so it counts in Overdue, not in a week (owner, 2026-10-06).
    expect(sara?.overdue).toBe(1);
    expect(sara?.counts).toEqual([2, 0, 0, 0]);
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
    expect(await api.call('search.query', { text: '#' })).toEqual({ projects: [], tasks: [], people: [], subCompanies: [], files: [] });
  });
});
