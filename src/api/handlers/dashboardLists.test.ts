import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { buildSeed } from '../../data/seed';
import { addDays, setNow } from '../../lib/dates';
import { NOW, testApi, TODAY } from '../../test/factories';

beforeEach(() => setNow(NOW));

const sample = async () => testApi(calls, await buildSeed(TODAY, async () => undefined));

/**
 * The Dashboard counts only the projects of its Leader and Client filters, so the lists its numbers open take the same filters
 * (owner, 2026-10-06, item 3). Each number and the list it opens must agree.
 */
describe('the Leader and Client filters of the lists that the Dashboard opens (owner, 2026-10-06)', () => {
  it('lists in tasks.list only the tasks of the projects that the person leads, as the Dashboard counts them', async () => {
    const { api, store } = await sample();
    const leaders = [...new Set(Object.values(store.state.projects).filter((p) => p.status === 'active').map((p) => p.leaderId as string))];
    expect(leaders.length).toBeGreaterThan(1);
    let some = 0;
    for (const leaderId of leaders) {
      const { tiles } = await api.call('dashboard.get', { leaderId });
      const rows = await api.call('tasks.list', { filter: 'overdue', includeDone: false, leaderId });
      expect(rows.length, leaderId).toBe(tiles.overdueTasks);
      for (const row of rows) expect(store.state.projects[row.project!.id].leaderId).toBe(leaderId);
      some += rows.length;
    }
    expect(some).toBeGreaterThan(0);
  });

  it('lists in tasks.list only the tasks of the projects of the client', async () => {
    const { api, store } = await sample();
    const clientId = Object.values(store.state.projects).find((p) => p.status === 'active' && p.clientId !== null)!.clientId as string;
    const rows = await api.call('tasks.list', { clientId });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(store.state.projects[row.project!.id].clientId).toBe(clientId);
    const all = await api.call('tasks.list', {});
    expect(rows.length).toBeLessThan(all.length);
    // A client that does not exist matches nothing, like a team that does not exist.
    expect(await api.call('tasks.list', { clientId: 'cli_999' })).toEqual([]);
  });

  it('lists in deadlines.list only the deadlines of the projects of the leader and the client, as the Dashboard counts them', async () => {
    const { api, store } = await sample();
    const from = TODAY;
    const to = addDays(TODAY, 14);
    let some = 0;
    for (const project of Object.values(store.state.projects).filter((p) => p.status === 'active')) {
      const filters = { leaderId: project.leaderId as string, clientId: project.clientId ?? undefined };
      const { tiles } = await api.call('dashboard.get', filters);
      const rows = await api.call('deadlines.list', { from, to, ...filters });
      expect(rows.length, project.id).toBe(tiles.deadlinesNext14);
      for (const row of rows) {
        expect(store.state.projects[row.project.id].leaderId).toBe(filters.leaderId);
        if (filters.clientId) expect(store.state.projects[row.project.id].clientId).toBe(filters.clientId);
      }
      some += rows.length;
    }
    expect(some).toBeGreaterThan(0);
  });
});
