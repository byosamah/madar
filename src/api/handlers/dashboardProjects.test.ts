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
