import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { paymentsOf } from '../store';

beforeEach(() => setNow(NOW));

/**
 * The numbers of an internal project (fbk_044, owner 2026-10-22). It counts in the workload, the to-do lists, the deadlines and the schedule.
 * It never counts in the client counts, the money, the map, the client parts of the office report, or the gaps that ask for client data
 * (no area, no sub-company). prj_001 is a client project with no area. "Today" is 2026-09-30.
 */
async function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.projects.prj_001.areaM2 = null;
  t.as('usr_002');
  const internal = await t.api.call('projects.create', {
    kind: 'internal', name: 'Portfolio 2026', teamIds: ['usr_003'], startDate: '2026-09-01', targetEndDate: '2026-12-01',
  });
  const id = internal.project.id;
  const stage = internal.currentStage.id;
  await t.api.call('tasks.create', { projectId: id, stageId: stage, title: 'Choose the projects', ownerId: 'usr_003', dueDate: '2026-10-02', needsReview: false });
  await t.api.call('deadlines.create', { projectId: id, name: 'Portfolio ready', date: '2026-10-05' });
  t.as('usr_001');
  return { t, id, state };
}

describe('dashboard.get with an internal project', () => {
  it('counts its to-dos in the workload and its deadlines, and shows it in the schedule', async () => {
    const { t, id } = await world();
    const view = await t.api.call('dashboard.get', {});
    const sara = view.workload.rows.find((row) => row.user.id === 'usr_003');
    expect(sara?.counts.reduce((sum, n) => sum + n, 0)).toBe(1);
    expect(view.tiles.deadlinesNext14).toBe(1);
    expect(view.schedule.map((row) => row.project.id)).toContain(id);
    expect(view.tiles.activeProjects).toBe(2);
  });

  it('leaves it out of the gaps that ask for client data, and out of the tile of projects with no area', async () => {
    const { t } = await world();
    const view = await t.api.call('dashboard.get', {});
    expect(view.gaps?.noArea).toBe(1);
    expect(view.tiles.inDesignWithoutArea).toBe(1);
    expect(view.gaps?.noSubCompany).toBe(0);
  });

  it('keeps the no-sub-company gap at the client projects when the office has sub-companies', async () => {
    const { t, state } = await world();
    state.subCompanies = { sub_001: { id: 'sub_001', name: 'Studio', nameAr: 'استوديو' } as never };
    const view = await t.api.call('dashboard.get', {});
    expect(view.gaps?.noSubCompany).toBe(1);
    const list = await t.api.call('projects.list', { filter: 'no_sub_company' });
    expect(list.map((row) => row.project.id)).toEqual(['prj_001']);
  });

  it('keeps it out of the money, whatever a stored payment says', async () => {
    const { t, id, state } = await world();
    paymentsOf(state).pay_900 = {
      id: 'pay_900', projectId: id, name: 'Stray', amount: 5000, dueDate: '2026-09-01', receivedOn: null, note: '', createdBy: 'usr_001',
      createdAt: '2026-09-01T09:00:00.000+03:00',
    };
    const view = await t.api.call('dashboard.get', {});
    expect(view.money?.pastDue.count).toBe(0);
    expect(view.money?.next30.count).toBe(0);
  });
});

describe('projects.list filters with an internal project', () => {
  it('leaves it out of the no-area filter', async () => {
    const { t } = await world();
    const list = await t.api.call('projects.list', { filter: 'no_area' });
    expect(list.map((row) => row.project.id)).toEqual(['prj_001']);
    const all = await t.api.call('projects.list', {});
    expect(all).toHaveLength(2);
  });

  it('keeps it in the stage-with-no-end filter, because its stages still have dates', async () => {
    const { t, id } = await world();
    const list = await t.api.call('projects.list', { filter: 'stage_no_end' });
    expect(list.map((row) => row.project.id)).toContain(id);
  });
});

describe('reports.office with an internal project', () => {
  it('counts its to-dos and deadlines, and leaves it out of the client gaps, the money and the Tracker', async () => {
    const { t, id, state } = await world();
    paymentsOf(state).pay_900 = {
      id: 'pay_900', projectId: id, name: 'Stray', amount: 5000, dueDate: '2026-09-01', receivedOn: null, note: '', createdBy: 'usr_001',
      createdAt: '2026-09-01T09:00:00.000+03:00',
    };
    const report = await t.api.call('reports.office', { period: 'month', start: '2026-09-01' });
    expect(report.projects.map((row) => row.project.id)).toContain(id);
    expect(report.totals.tasks.made).toBe(1);
    expect(report.gaps?.join(' | ')).toContain('Active projects with no area: 1');
    expect(report.money?.pastDueAtEnd).toBe(0);
    expect(report.tracker.opened).toBe(0);
    expect(report.totals.submissions).toBe(0);
  });
});
