import { beforeEach, describe, expect, it } from 'vitest';
import { setNow } from '../../lib/dates';
import { makeProject, makeStage, makeTask, makeUser, makeWorld, NOW, STAMP, testApi, TODAY } from '../../test/factories';
import type { State } from '../store';
import { insightCalls } from './insights';
import { historyCalls } from './history';
import { projectCalls } from './projects';
import { reportsCalls } from './reports';
import { subCompanyCalls } from './subCompanies';
import { taskCalls } from './tasks';

beforeEach(() => setNow(NOW));

const calls = { ...subCompanyCalls, ...historyCalls, ...insightCalls, ...projectCalls, ...reportsCalls, ...taskCalls };
const SUB = (id: string, name: string, nameAr: string) => ({ id, name, nameAr, logo: null, createdBy: 'usr_001', createdAt: STAMP });

/**
 * The world of the factories with three projects: prj_001 names Vado, prj_002 names Bunah, prj_003 names none. Each has one open
 * task, one past due. usr_006 is Management. usr_018 is an agent of the Admin.
 */
function office(): State {
  const state = makeWorld();
  state.users.usr_006 = makeUser('usr_006', { name: 'Turki Management', systemRole: 'management' });
  state.users.usr_018 = makeUser('usr_018', { name: 'Admin Agent', kind: 'agent', discipline: 'Agent', ownerId: 'usr_001' });
  state.subCompanies = { sub_001: SUB('sub_001', 'Vado', 'فادو'), sub_002: SUB('sub_002', 'Bunah', 'بناة') };
  Object.assign(state.projects.prj_001, { subCompanyId: 'sub_001' });
  state.projects.prj_002 = makeProject({ id: 'prj_002', code: 'KH-26-002', name: 'Beta Tower', currentStageId: 'stg_003', subCompanyId: 'sub_002' });
  state.projects.prj_003 = makeProject({ id: 'prj_003', code: 'KH-26-003', name: 'Gamma Tower', currentStageId: 'stg_004', areaM2: null });
  state.stages.stg_003 = makeStage({ id: 'stg_003', projectId: 'prj_002', name: 'Concept', startDate: '2026-09-01', endDate: '2026-10-31' });
  state.stages.stg_004 = makeStage({ id: 'stg_004', projectId: 'prj_003', name: 'Concept', startDate: '2026-09-01', endDate: '2026-10-31' });
  state.tasks.tsk_001 = makeTask({ id: 'tsk_001', projectId: 'prj_001', dueDate: '2026-09-20' });
  state.tasks.tsk_002 = makeTask({ id: 'tsk_002', projectId: 'prj_002', stageId: 'stg_003', dueDate: '2026-09-21' });
  state.tasks.tsk_003 = makeTask({ id: 'tsk_003', projectId: 'prj_003', stageId: 'stg_004', dueDate: '2026-09-22' });
  state.deadlines.ddl_001 = { id: 'ddl_001', projectId: 'prj_001', stageId: null, name: 'Submit', date: '2026-10-05' };
  state.deadlines.ddl_002 = { id: 'ddl_002', projectId: 'prj_002', stageId: null, name: 'Review', date: '2026-10-06' };
  state.counters = { ...state.counters, prj: 3, tsk: 3, stg: 4, sub: 2 };
  return state;
}

describe('the sub-company filter of the Dashboard and of the lists that its numbers open (INT-09)', () => {
  it('counts in dashboard.get only the projects of the sub-company', async () => {
    const t = testApi(calls, office());
    expect((await t.api.call('dashboard.get', {})).tiles.activeProjects).toBe(3);
    const vado = await t.api.call('dashboard.get', { subCompanyId: 'sub_001' });
    expect(vado.tiles.activeProjects).toBe(1);
    expect(vado.tiles.overdueTasks).toBe(1);
    expect(vado.tiles.deadlinesNext14).toBe(1);
    expect(vado.schedule.map((row) => row.project.id)).toEqual(['prj_001']);
  });

  it('lists in tasks.list and deadlines.list what the number counts, and nothing else', async () => {
    const t = testApi(calls, office());
    const rows = await t.api.call('tasks.list', { filter: 'overdue', includeDone: false, subCompanyId: 'sub_002' });
    expect(rows.map((row) => row.task.id)).toEqual(['tsk_002']);
    const deadlines = await t.api.call('deadlines.list', { from: TODAY, to: '2026-10-30', subCompanyId: 'sub_002' });
    expect(deadlines.map((row) => row.project.id)).toEqual(['prj_002']);
  });

  it('leaves the office tasks out of a filtered number, as the other filters do', async () => {
    const state = office();
    state.tasks.tsk_900 = makeTask({ id: 'tsk_900', projectId: null, stageId: null, ownerId: 'usr_001', createdBy: 'usr_001', dueDate: '2026-09-10' });
    const t = testApi(calls, state);
    expect((await t.api.call('dashboard.get', {})).tiles.overdueTasks).toBe(4);
    expect((await t.api.call('dashboard.get', { subCompanyId: 'sub_001' })).tiles.overdueTasks).toBe(1);
    const rows = await t.api.call('tasks.list', { subCompanyId: 'sub_001' });
    expect(rows.map((row) => row.task.id)).toEqual(['tsk_001']);
  });

  it('matches nothing for a sub-company that does not exist', async () => {
    const t = testApi(calls, office());
    expect((await t.api.call('dashboard.get', { subCompanyId: 'sub_099' })).tiles.activeProjects).toBe(0);
    expect(await t.api.call('tasks.list', { subCompanyId: 'sub_099' })).toEqual([]);
  });
});

describe('the projects with no sub-company (INT-10)', () => {
  it('lists them with the filter no_sub_company, and counts them in the data gaps', async () => {
    const t = testApi(calls, office());
    const rows = await t.api.call('projects.list', { filter: 'no_sub_company' });
    expect(rows.map((row) => row.project.id)).toEqual(['prj_003']);
    expect((await t.api.call('dashboard.get', {})).gaps?.noSubCompany).toBe(1);
  });

  it('counts no gap when the office has no sub-company', async () => {
    const state = office();
    state.subCompanies = {};
    for (const project of Object.values(state.projects)) delete project.subCompanyId;
    const t = testApi(calls, state);
    expect((await t.api.call('dashboard.get', {})).gaps?.noSubCompany).toBe(0);
  });

  it('adds the gap to the lines of the report for the Admin', async () => {
    const t = testApi(calls, office());
    const report = await t.api.call('reports.office', { period: 'week', start: '2026-09-27' });
    expect(report.gaps).toContain('Active projects with no sub-company: 1');
  });
});

describe('the sub-company filter of the report (INT-09)', () => {
  it('counts only the projects of the sub-company in the rows, the totals and the people', async () => {
    const t = testApi(calls, office());
    const all = await t.api.call('reports.office', { period: 'week', start: '2026-09-27' });
    const vado = await t.api.call('reports.office', { period: 'week', start: '2026-09-27', subCompanyId: 'sub_001' });
    expect(all.projects.map((row) => row.project.id)).toEqual(['prj_001', 'prj_002', 'prj_003']);
    expect(vado.projects.map((row) => row.project.id)).toEqual(['prj_001']);
    expect(vado.totals.projects.active).toBe(1);
    expect(vado.totals.tasks.pastDueAtEnd).toBe(1);
    expect(all.totals.tasks.pastDueAtEnd).toBe(3);
    expect(vado.office.name).toBe('Vado');
  });
});

describe('Search finds a sub-company by its name (INT-25)', () => {
  it('answers one row for the sub-company, with the number of its projects', async () => {
    const t = testApi(calls, office());
    const found = await t.api.call('search.query', { text: 'vado' });
    expect(found.subCompanies).toEqual([{ id: 'sub_001', name: 'Vado', nameAr: 'فادو', projects: 1 }]);
    expect((await t.api.call('search.query', { text: 'فادو' })).subCompanies?.map((row) => row.id)).toEqual(['sub_001']);
    expect((await t.api.call('search.query', { text: 'xyz' })).subCompanies).toEqual([]);
  });
});

describe('an agent never undoes a sub-company change (INT-27)', () => {
  it('refuses the undo of a made sub-company for the agent of the Admin, and allows it for the Admin', async () => {
    const t = testApi(calls, office());
    const made = await t.api.call('subCompanies.save', { name: 'Third', nameAr: 'ثالث', logo: null });
    const event = Object.values(t.store.state.events).find((item) => item.verb === 'subCompany.created' && item.targetId === made.id)!;
    t.as('usr_018');
    await expect(t.api.call('events.undo', { eventId: event.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.subCompanies?.[made.id]).toBeDefined();
    t.as('usr_001');
    await t.api.call('events.undo', { eventId: event.id });
    expect(t.store.state.subCompanies?.[made.id]).toBeUndefined();
  });
});

describe('the count of projects and the move on delete (PRJ-12, INT-24)', () => {
  it('gives the number of projects of each sub-company in the list', async () => {
    const t = testApi(calls, office());
    expect((await t.api.call('subCompanies.list', {})).map((sub) => [sub.name, sub.projectCount])).toEqual([['Bunah', 1], ['Vado', 1]]);
  });

  it('moves the projects to another sub-company, deletes the first, and one Undo takes it all back', async () => {
    const t = testApi(calls, office());
    const run = await t.api.run('subCompanies.delete', { id: 'sub_001', moveToId: 'sub_002' });
    expect(t.store.state.projects.prj_001.subCompanyId).toBe('sub_002');
    expect(t.store.state.subCompanies?.sub_001).toBeUndefined();
    await t.api.call('events.undoStory', { correlationId: run.storyId });
    expect(t.store.state.projects.prj_001.subCompanyId).toBe('sub_001');
    expect(t.store.state.subCompanies?.sub_001).toBeDefined();
  });

  it('can move the projects to no sub-company', async () => {
    const t = testApi(calls, office());
    await t.api.call('subCompanies.delete', { id: 'sub_001', moveToId: null });
    expect(t.store.state.projects.prj_001.subCompanyId ?? null).toBeNull();
    expect(t.store.state.subCompanies?.sub_001).toBeUndefined();
  });

  it('refuses a move to itself or to a sub-company that does not exist', async () => {
    const t = testApi(calls, office());
    await expect(t.api.call('subCompanies.delete', { id: 'sub_001', moveToId: 'sub_001' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('subCompanies.delete', { id: 'sub_001', moveToId: 'sub_099' })).rejects.toMatchObject({ code: 'not_found' });
    expect(t.store.state.projects.prj_001.subCompanyId).toBe('sub_001');
  });

  it('still refuses to delete a used sub-company with no move, and names the count', async () => {
    const t = testApi(calls, office());
    await expect(t.api.call('subCompanies.delete', { id: 'sub_001' })).rejects.toMatchObject({ code: 'conflict', details: { reason: 'sub_company_in_use', count: 1 } });
  });
});
