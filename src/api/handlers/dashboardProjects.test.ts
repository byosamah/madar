import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { insightCalls } from './insights';
import type { State } from '../store';
import type { TrackerEntry } from '../contract/entities';
import { setNow } from '../../lib/dates';
import { makeProject, makeTask, makeWorld, NOW, STAMP, testApi } from '../../test/factories';

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

