import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

// Each render of a task row that its list asks for (performance audit 2026-10-07, RND-2).
const rows = vi.hoisted(() => ({ renders: 0 }));
vi.mock('../project/tasks/TaskRowItem', async (importOriginal) => {
  const real = await importOriginal<typeof import('../project/tasks/TaskRowItem')>();
  return {
    ...real,
    TaskRowItem: (props: Parameters<typeof real.TaskRowItem>[0]) => {
      rows.renders += 1;
      return createElement(real.TaskRowItem, props);
    },
  };
});

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

/** Waits until the rows stop rendering: the late answers and the effects of the last step are in. */
async function settled(): Promise<number> {
  let last = -1;
  while (last !== rows.renders) {
    last = rows.renders;
    await act(() => new Promise((resolve) => { window.setTimeout(resolve, 40); }));
  }
  return rows.renders;
}

describe('the Tasks screen and the task panel (performance audit 2026-10-07, RND-2)', () => {
  it('does not render the rows again when a task panel opens or closes', async () => {
    await renderApp('/work', as('usr_005'));
    await screen.findByRole('region', { name: 'Today' });
    const before = await settled();
    expect(before).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: /^Civil Defense drawings/ }));
    await screen.findByRole('dialog', { name: 'Civil Defense drawings' });
    expect(await settled()).toBe(before);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Civil Defense drawings' })).toBeNull());
    expect(await settled()).toBe(before);
  });
});
