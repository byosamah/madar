import { beforeEach, describe, expect, it } from 'vitest';
import { insightCalls } from './insights';
import type { State } from '../store';
import type { TrackerEntry } from '../contract/entities';
import { setNow } from '../../lib/dates';
import { makeProject, makeWorld, NOW, STAMP, testApi } from '../../test/factories';

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

