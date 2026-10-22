import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderApp } from '../../../test/render';
import type { State } from '../../../api/store';

// Task rows with 150 more tasks (performance audit 2026-10-21, RN-5). One saved task reloads the list, and the list gave every row a new
// closure and new drag inputs, so every row rendered again. TaskPeople sits inside the row, so its count is the count of row bodies.
const counts = vi.hoisted(() => ({ rows: 0 }));
vi.mock('./TaskPeople', async (importOriginal) => {
  const real = await importOriginal<typeof import('./TaskPeople')>();
  return { ...real, TaskPeople: (props: Parameters<typeof real.TaskPeople>[0]) => { counts.rows += 1; return createElement(real.TaskPeople, props); } };
});

const BULK = 150;
function bulk(state: State) {
  state.session.currentUserId = 'usr_001';
  const base = Object.values(state.tasks).find((x) => x.projectId === 'prj_001' && x.status !== 'done')!;
  for (let n = 0; n < BULK; n += 1) {
    const id = `tsk_9${String(n).padStart(3, '0')}`;
    state.tasks[id] = { ...base, id, title: `Bulk task ${n}`, ownerId: 'usr_001', dueDate: `2026-10-${String(1 + (n % 28)).padStart(2, '0')}`, rank: undefined } as never;
  }
}

async function settled(): Promise<number> {
  let last = -1;
  while (last !== counts.rows) {
    last = counts.rows;
    await act(() => new Promise((resolve) => { window.setTimeout(resolve, 80); }));
  }
  return counts.rows;
}

describe('the rows of the project To-dos tab with 150 more tasks (RN-5)', () => {
  it('renders one row when one task changes, not every row', async () => {
    const { store, queryClient } = await renderApp('/projects/prj_001?tab=tasks', bulk);
    await screen.findByText('Bulk task 7', undefined, { timeout: 20_000 });
    const before = await settled();
    expect(before).toBeGreaterThanOrEqual(BULK);
    store.state.tasks['tsk_9004']!.title = 'Bulk task 4 changed';
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['api', 'tasks.list'] });
      await queryClient.invalidateQueries({ queryKey: ['api', 'projects.get'] });
    });
    await screen.findByText('Bulk task 4 changed', undefined, { timeout: 20_000 });
    const after = await settled();
    // Before the fix this was every row (150 and more). Two is room for the row and a neighbour.
    expect(after - before).toBeLessThanOrEqual(2);
  }, 120_000);
});
