import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { insightCalls } from './insights';
import type { State } from '../store';
import type { Payment, TrackerEntry } from '../contract/entities';
import { setNow } from '../../lib/dates';
import { makeProject, makeTask, makeUser, makeWorld, NOW, STAMP, testApi } from '../../test/factories';

beforeEach(() => setNow(NOW));

/** TODAY is Wednesday 2026-09-30. The office week starts on Sunday 2026-09-27. */
function entry(id: string, overrides: Partial<TrackerEntry>): TrackerEntry {
  return {
    id, projectId: 'prj_001', type: 'message', direction: 'out', title: id, note: '', date: '2026-09-28', waiting: null, closedAt: null, closedBy: null,
    fileIds: [], peopleIds: [], auto: null, createdBy: 'usr_002', createdAt: STAMP, ...overrides,
  };
}

function world(): State {
  const state = makeWorld();
  state.projects.prj_002 = makeProject({ id: 'prj_002', code: 'KH-26-002', name: 'Second Villa', leaderId: 'usr_003' });
  state.counters.prj = 2;
  return state;
}

describe('the Submissions chart of dashboard.get (owner, 2026-10-06)', () => {
  it('counts the Tracker entries sent to the client by their own date, for 12 weeks, in the projects of the filters', async () => {
    const state = world();
    state.tracker = {
      trk_001: entry('trk_001', { date: '2026-09-28' }),
      // Created this week, but dated in the week before: it counts in its own week.
      trk_002: entry('trk_002', { date: '2026-09-22', createdAt: STAMP }),
      trk_003: entry('trk_003', { date: '2026-09-27', type: 'file', auto: 'delivered' }),
      // Not sent to the client.
      trk_004: entry('trk_004', { direction: 'in' }),
      trk_005: entry('trk_005', { direction: 'both', type: 'meeting' }),
      trk_006: entry('trk_006', { direction: 'third_party', type: 'balady' }),
      // Older than 12 weeks.
      trk_007: entry('trk_007', { date: '2026-07-01' }),
      // Another leader's project.
      trk_008: entry('trk_008', { projectId: 'prj_002' }),
    };
    const { api } = testApi(insightCalls, state);
    const d = await api.call('dashboard.get', {});
    expect(d.charts.submissions).toHaveLength(12);
    expect(d.charts.submissions[0].weekStart).toBe('2026-07-12');
    expect(d.charts.submissions[11]).toEqual({ weekStart: '2026-09-27', count: 3 });
    expect(d.charts.submissions[10]).toEqual({ weekStart: '2026-09-20', count: 1 });
    expect(d.charts.submissions.reduce((sum, week) => sum + week.count, 0)).toBe(4);
    const led = await api.call('dashboard.get', { leaderId: 'usr_002' });
    expect(led.charts.submissions[11].count).toBe(2);
    // The old chart stays in the output for agents.
    expect(led.charts.throughput).toHaveLength(12);
  });
});

describe('waitingForUs of dashboard.get (owner, 2026-10-06)', () => {
  it('counts the open client items that wait for the office, per active project in the filters, the most first', async () => {
    const state = world();
    state.projects.prj_003 = makeProject({ id: 'prj_003', code: 'KH-26-003', name: 'Paused Mall', status: 'on_hold' });
    state.tracker = {
      trk_001: entry('trk_001', { direction: 'in', waiting: 'us' }),
      trk_002: entry('trk_002', { projectId: 'prj_002', direction: 'in', waiting: 'us' }),
      trk_003: entry('trk_003', { projectId: 'prj_002', direction: 'in', waiting: 'us' }),
      // Closed, waiting for the client, not a loop, or in a paused project: none counts.
      trk_004: entry('trk_004', { direction: 'in', waiting: 'us', closedAt: STAMP, closedBy: 'usr_002' }),
      trk_005: entry('trk_005', { waiting: 'client' }),
      trk_006: entry('trk_006', { direction: 'in' }),
      trk_007: entry('trk_007', { projectId: 'prj_003', direction: 'in', waiting: 'us' }),
    };
    const { api } = testApi(insightCalls, state);
    const d = await api.call('dashboard.get', {});
    expect(d.waitingForUs.map((row) => [row.project.id, row.count])).toEqual([['prj_002', 2], ['prj_001', 1]]);
    expect(d.waitingForUs[0].project).toMatchObject({ code: 'KH-26-002', name: 'Second Villa' });
    expect((await api.call('dashboard.get', { leaderId: 'usr_002' })).waitingForUs.map((row) => row.project.id)).toEqual(['prj_001']);
    // Like every number, it counts the active projects of the status: a status of paused projects has none.
    expect((await api.call('dashboard.get', { status: 'on_hold' })).waitingForUs).toEqual([]);
    delete state.tracker;
    expect((await testApi(insightCalls, state).api.call('dashboard.get', {})).waitingForUs).toEqual([]);
  });
});

describe('inReview of dashboard.get (owner, 2026-10-06, item 9)', () => {
  /** Sara finishes two tasks of the tower (Faisal reviews), and Omar one of the villa (Sara reviews). */
  async function reviews() {
    const state = world();
    state.members['prj_002:usr_004'] = { projectId: 'prj_002', userId: 'usr_004', discipline: 'Structural' };
    state.tasks.tsk_001 = makeTask({ id: 'tsk_001', title: 'Facade details' });
    state.tasks.tsk_002 = makeTask({ id: 'tsk_002', title: 'Roof plan' });
    state.tasks.tsk_003 = makeTask({ id: 'tsk_003', projectId: 'prj_002', ownerId: 'usr_004', title: 'Stair details' });
    state.stages.stg_009 = { id: 'stg_009', projectId: 'prj_002', name: 'Concept', order: 0, startDate: null, endDate: null };
    state.tasks.tsk_003.stageId = 'stg_009';
    state.counters.tsk = 3;
    state.counters.stg = 9;
    const t = testApi(calls, state);
    setNow(new Date('2026-09-25T06:00:00Z'));
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    setNow(new Date('2026-09-29T06:00:00Z'));
    await t.api.call('tasks.complete', { id: 'tsk_002' });
    t.as('usr_004');
    await t.api.call('tasks.complete', { id: 'tsk_003' });
    setNow(NOW);
    t.as('usr_001');
    return t;
  }

  it('groups the tasks in review by reviewer, with the count and the oldest wait, the longest wait first', async () => {
    const { api } = await reviews();
    const d = await api.call('dashboard.get', {});
    expect(d.inReview.map((row) => [row.reviewer.id, row.count, row.oldestDays])).toEqual([['usr_002', 2, 5], ['usr_003', 1, 1]]);
    expect(d.inReview[0].tasks).toEqual([
      { id: 'tsk_001', title: 'Facade details', projectId: 'prj_001', projectCode: 'KH-26-001', days: 5 },
      { id: 'tsk_002', title: 'Roof plan', projectId: 'prj_001', projectCode: 'KH-26-001', days: 1 },
    ]);
  });

  it('follows the filters and leaves out the paused projects', async () => {
    const t = await reviews();
    expect((await t.api.call('dashboard.get', { leaderId: 'usr_003' })).inReview.map((row) => row.reviewer.id)).toEqual(['usr_003']);
    t.store.state.projects.prj_001.status = 'on_hold';
    expect((await t.api.call('dashboard.get', {})).inReview.map((row) => row.reviewer.id)).toEqual(['usr_003']);
  });

  it('counts the wait from the last move to review, and 0 days when no change names it', async () => {
    const t = await reviews();
    // Sent back, then sent to review again today: the wait starts again.
    t.as('usr_002');
    await t.api.call('tasks.sendBack', { id: 'tsk_001', note: 'Fix the joints' });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    t.store.state.tasks.tsk_004 = makeTask({ id: 'tsk_004', title: 'Old review', status: 'in_review' });
    t.as('usr_001');
    const faisal = (await t.api.call('dashboard.get', {})).inReview.find((row) => row.reviewer.id === 'usr_002')!;
    expect(faisal.tasks.map((task) => [task.id, task.days])).toEqual([['tsk_002', 1], ['tsk_001', 0], ['tsk_004', 0]]);
    expect(faisal.oldestDays).toBe(1);
  });

  it('gives one row to each Admin when the project has no active leader (reviewersOf)', async () => {
    const t = await reviews();
    t.store.state.users.usr_002.active = false;
    const d = await t.api.call('dashboard.get', {});
    expect(d.inReview.map((row) => [row.reviewer.id, row.count])).toEqual([['usr_001', 2], ['usr_003', 1]]);
  });
});

describe('gaps of dashboard.get, for the Admin only (owner, 2026-10-06, item 10)', () => {
  function gapWorld(): State {
    const state = world();
    state.users.usr_006 = makeUser('usr_006', { name: 'Hala Assistant', kind: 'agent', discipline: 'Agent', ownerId: 'usr_001' });
    state.projects.prj_002.areaM2 = null;
    state.projects.prj_003 = makeProject({ id: 'prj_003', code: 'KH-26-003', name: 'Paused Mall', status: 'on_hold', areaM2: null });
    state.stages.stg_009 = { id: 'stg_009', projectId: 'prj_002', name: 'Concept', order: 0, startDate: '2026-09-01', endDate: null };
    state.stages.stg_010 = { id: 'stg_010', projectId: 'prj_003', name: 'Concept', order: 0, startDate: null, endDate: null };
    // A second open-ended stage of the same project: the gap counts the project once.
    state.stages.stg_011 = { id: 'stg_011', projectId: 'prj_002', name: 'Permits', order: 1, startDate: null, endDate: null };
    state.tasks.tsk_001 = makeTask({ id: 'tsk_001', dueDate: null });
    state.tasks.tsk_002 = makeTask({ id: 'tsk_002', dueDate: null, ownerId: null });
    state.tasks.tsk_003 = makeTask({ id: 'tsk_003', dueDate: '2026-10-05', ownerId: null });
    state.tasks.tsk_004 = makeTask({ id: 'tsk_004', dueDate: null, status: 'done', completedAt: STAMP });
    state.tasks.tsk_005 = makeTask({ id: 'tsk_005', projectId: 'prj_003', stageId: 'stg_010', dueDate: null, ownerId: null });
    state.counters.tsk = 5;
    state.counters.usr = 6;
    return state;
  }

  it('counts the open tasks with no due date or no lead, the projects with a stage with no end date and the projects with no area', async () => {
    const t = testApi(calls, gapWorld());
    t.as('usr_001');
    expect((await t.api.call('dashboard.get', {})).gaps).toEqual({ noDueDate: 2, noLead: 2, projectsStageNoEnd: 1, noArea: 1 });
    expect((await t.api.call('dashboard.get', { leaderId: 'usr_002' })).gaps).toEqual({ noDueDate: 2, noLead: 2, projectsStageNoEnd: 0, noArea: 0 });
    // Each count opens a list that holds the same records.
    expect(await t.api.call('tasks.list', { filter: 'no_date', includeDone: false })).toHaveLength(2);
    expect(await t.api.call('tasks.list', { filter: 'no_lead', includeDone: false })).toHaveLength(2);
    expect((await t.api.call('projects.list', { filter: 'no_area' })).map((s) => s.project.id)).toEqual(['prj_002']);
    expect((await t.api.call('projects.list', { filter: 'stage_no_end' })).map((s) => s.project.id)).toEqual(['prj_002']);
  });

  // The number must equal the list it opens: two open-ended stages of one project are one project (review, 2026-10-06).
  it('counts a project with a stage with no end date once, as the list it opens holds it once', async () => {
    const t = testApi(calls, gapWorld());
    t.as('usr_001');
    for (const filters of [{}, { leaderId: 'usr_003' }, { clientId: 'cli_009' }]) {
      const { gaps } = await t.api.call('dashboard.get', filters);
      expect(gaps!.projectsStageNoEnd, JSON.stringify(filters)).toBe((await t.api.call('projects.list', { filter: 'stage_no_end', ...filters })).length);
    }
    expect((await t.api.call('dashboard.get', {})).gaps!.projectsStageNoEnd).toBe(1);
  });

  it('gives the gaps to the Admin and to an agent that acts for the Admin, and null to anyone else', async () => {
    const t = testApi(calls, gapWorld());
    for (const [id, sees] of [['usr_001', true], ['usr_006', true], ['usr_002', false], ['usr_003', false], ['usr_005', false]] as const) {
      t.as(id);
      const { gaps } = await t.api.call('dashboard.get', {});
      expect(gaps === null, id).toBe(!sees);
    }
    t.store.state.users.usr_002.systemRole = 'management';
    t.as('usr_002');
    expect((await t.api.call('dashboard.get', {})).gaps).toBeNull();
  });
});

describe('money of dashboard.get, for the people who handle payments (owner, 2026-10-06, item 11)', () => {
  const pay = (id: string, projectId: string, amount: number, dueDate: string, receivedOn: string | null = null): Payment => ({
    id, projectId, name: `Fee ${id}`, amount, dueDate, receivedOn, note: '', createdBy: 'usr_001', createdAt: STAMP,
  });
  function moneyWorld(): State {
    const state = world();
    state.users.usr_006 = makeUser('usr_006', { name: 'Hala Assistant', kind: 'agent', discipline: 'Agent', ownerId: 'usr_001' });
    state.users.usr_007 = makeUser('usr_007', { name: 'Turki Management', systemRole: 'management' });
    state.users.usr_008 = makeUser('usr_008', { name: 'Noura Accounting', systemRole: 'accounting' });
    state.projects.prj_003 = makeProject({ id: 'prj_003', code: 'KH-26-003', name: 'Paused Mall', status: 'on_hold' });
    state.payments = {
      pay_001: pay('pay_001', 'prj_001', 120000, '2026-09-20'),
      pay_002: pay('pay_002', 'prj_001', 50000, '2026-09-25', '2026-09-26'),
      pay_003: pay('pay_003', 'prj_002', 80000, '2026-10-10'),
      pay_004: pay('pay_004', 'prj_002', 30000.5, '2026-10-30'),
      pay_005: pay('pay_005', 'prj_002', 99000, '2026-10-31'),
      // A paused project still owes its money.
      pay_006: pay('pay_006', 'prj_003', 40000, '2026-09-01'),
      // Due today: not past due yet.
      pay_007: pay('pay_007', 'prj_001', 10000, '2026-09-30'),
    };
    state.counters.usr = 8;
    return state;
  }

  it('sums the payments past due and the payments due in the next 30 days, the soonest first', async () => {
    const t = testApi(calls, moneyWorld());
    t.as('usr_001');
    const { money } = await t.api.call('dashboard.get', {});
    expect(money?.pastDue).toMatchObject({ count: 2, total: 160000 });
    expect(money?.pastDue.payments.map((p) => p.id)).toEqual(['pay_006', 'pay_001']);
    expect(money?.pastDue.payments[1]).toEqual({ id: 'pay_001', projectId: 'prj_001', projectCode: 'KH-26-001', name: 'Fee pay_001', amount: 120000, dueDate: '2026-09-20' });
    expect(money?.next30).toMatchObject({ count: 3, total: 120000.5 });
    expect(money?.next30.payments.map((p) => p.id)).toEqual(['pay_007', 'pay_003', 'pay_004']);
    const led = (await t.api.call('dashboard.get', { leaderId: 'usr_003' })).money;
    expect([led?.pastDue.count, led?.next30.count]).toEqual([0, 2]);
  });

  it('gives the money to the Admin, Management, Accounting and their agents, and null to anyone else', async () => {
    const t = testApi(calls, moneyWorld());
    for (const [id, sees] of [['usr_001', true], ['usr_006', true], ['usr_007', true], ['usr_008', true], ['usr_002', false], ['usr_003', false], ['usr_005', false]] as const) {
      t.as(id);
      expect((await t.api.call('dashboard.get', {})).money === null, id).toBe(!sees);
    }
  });
});

