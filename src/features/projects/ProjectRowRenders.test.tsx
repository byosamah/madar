import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderApp } from '../../test/render';
import type { State } from '../../api/store';

// Project rows with 100 more projects (performance audit 2026-10-21, RN-6). One saved project reloads the list, and every row rendered
// again. A row renders one ProgressLine, so its count is the count of row bodies.
const counts = vi.hoisted(() => ({ rows: 0 }));
vi.mock('../../components/ProgressLine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../components/ProgressLine')>();
  return { ...real, ProgressLine: (props: Parameters<typeof real.ProgressLine>[0]) => { counts.rows += 1; return createElement(real.ProgressLine, props); } };
});

const BULK = 100;
function bulk(state: State) {
  state.session.currentUserId = 'usr_001';
  const base = state.projects['prj_001']!;
  for (let n = 0; n < BULK; n += 1) {
    const id = `prj_9${String(n).padStart(3, '0')}`;
    state.projects[id] = { ...base, id, name: `Bulk project ${n}`, code: `B${String(n).padStart(3, '0')}` } as never;
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

describe('the project rows with 100 more projects (RN-6)', () => {
  it('renders one row when one project changes, not every row', async () => {
    const { store, queryClient } = await renderApp('/projects', bulk);
    await screen.findByText('Bulk project 7', undefined, { timeout: 20_000 });
    const before = await settled();
    expect(before).toBeGreaterThanOrEqual(BULK);
    store.state.projects['prj_9004']!.name = 'Bulk project 4 changed';
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['api', 'projects.list'] });
    });
    await screen.findByText('Bulk project 4 changed', undefined, { timeout: 20_000 });
    const after = await settled();
    // Before the fix this was every row (100 and more). Two is room for the row and a neighbour.
    expect(after - before).toBeLessThanOrEqual(2);
  }, 120_000);
});
