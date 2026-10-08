import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

// Each render of a task row and of a project row (one ProgressLine for each project row) (performance audit 2026-10-07, RND-2, RND-M1).
const counts = vi.hoisted(() => ({ tasks: 0, projects: 0 }));
vi.mock('../project/tasks/TaskRowItem', async (importOriginal) => {
  const real = await importOriginal<typeof import('../project/tasks/TaskRowItem')>();
  return {
    ...real,
    TaskRowItem: (props: Parameters<typeof real.TaskRowItem>[0]) => {
      counts.tasks += 1;
      return createElement(real.TaskRowItem, props);
    },
  };
});
vi.mock('../../components/ProgressLine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../components/ProgressLine')>();
  return {
    ...real,
    ProgressLine: (props: Parameters<typeof real.ProgressLine>[0]) => {
      counts.projects += 1;
      return createElement(real.ProgressLine, props);
    },
  };
});

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

/** Waits until the rows stop rendering: the late answers and the effects of the last step are in. */
async function settled(): Promise<{ tasks: number; projects: number }> {
  let last = '';
  while (last !== JSON.stringify(counts)) {
    last = JSON.stringify(counts);
    await act(() => new Promise((resolve) => { window.setTimeout(resolve, 40); }));
  }
  return { ...counts };
}

describe('Home and the task panel (performance audit 2026-10-07, RND-2, RND-M1)', () => {
  it('does not render the task rows or the project rows again when a task panel opens or closes', async () => {
    await renderApp('/', as('usr_006'));
    const today = await screen.findByRole('region', { name: 'Today' });
    await screen.findByRole('list', { name: 'Your projects' });
    const before = await settled();
    expect(before.tasks).toBeGreaterThan(0);
    expect(before.projects).toBeGreaterThan(0);
    await userEvent.click(within(today).getByRole('button', { name: /^Stair details/ }));
    await screen.findByRole('dialog', { name: 'Stair details' });
    expect(await settled()).toEqual(before);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stair details' })).toBeNull());
    expect(await settled()).toEqual(before);
  });
});
