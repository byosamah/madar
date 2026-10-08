import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { calls } from '../../api/calls';
import { createApi } from '../../api/client';
import type { TaskRow } from '../../api/contract/views';
import { memoryPersister } from '../../api/persist';
import { Store } from '../../api/store';
import { buildSeed } from '../../data/seed';
import { sampleOffice } from '../../data/sampleOffice';
import { setNow } from '../../lib/dates';
import { NOW, TODAY } from '../../test/factories';
import { HOME_MINE, homePlaceholder, openRows } from './minePlaceholder';

describe('the open tasks from the list of Home (performance audit 2026-10-07, FET-9)', () => {
  it('equals tasks.list {filter: mine, includeDone: false} for every person of the sample office, rows and order', async () => {
    setNow(NOW);
    const state = await buildSeed(TODAY, async () => undefined);
    const api = createApi(calls, { store: new Store(state, memoryPersister()), latencyMs: 0, sampleOffice });
    const people = (await api.call('session.get', {})).previewUsers.map((user) => user.id);
    expect(people.length).toBeGreaterThan(5);
    let doneRows = 0;
    for (const userId of people) {
      await api.call('session.previewAs', { userId });
      const home = await api.call('tasks.list', { filter: 'mine' });
      const tasks = await api.call('tasks.list', { filter: 'mine', includeDone: false });
      doneRows += home.length - openRows(home).length;
      expect(openRows(home)).toEqual(tasks);
    }
    // The sample office has finished tasks, so the test removes real rows.
    expect(doneRows).toBeGreaterThan(0);
  });

  it('comes only from a Home answer that exists and that no change marked', async () => {
    const client = new QueryClient();
    expect(homePlaceholder(client)).toBeUndefined();
    const open = { task: { id: 'tsk_001', status: 'todo' } } as TaskRow;
    const done = { task: { id: 'tsk_002', status: 'done' } } as TaskRow;
    client.setQueryData(HOME_MINE, [open, done]);
    expect(homePlaceholder(client)).toEqual([open]);
    await client.invalidateQueries({ queryKey: HOME_MINE, refetchType: 'none' });
    expect(homePlaceholder(client)).toBeUndefined();
  });
});
