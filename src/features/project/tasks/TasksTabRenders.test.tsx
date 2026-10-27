import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/render';

// Each render of a task row that its list asks for (performance audit 2026-10-07, RND-2).
const rows = vi.hoisted(() => ({ renders: 0 }));
vi.mock('./TaskRowItem', async (importOriginal) => {
  const real = await importOriginal<typeof import('./TaskRowItem')>();
  return {
    ...real,
    TaskRowItem: (props: Parameters<typeof real.TaskRowItem>[0]) => {
      rows.renders += 1;
      return createElement(real.TaskRowItem, props);
    },
  };
});

// Each render of the New to-do sheet. It calls useSheetSteps('newTask') once for each render, and no other part of this tab calls it.
const sheets = vi.hoisted(() => ({ renders: 0 }));
vi.mock('../../../app/insight/useSheetSteps', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../app/insight/useSheetSteps')>();
  return {
    ...real,
    useSheetSteps: (...args: Parameters<typeof real.useSheetSteps>) => {
      if (args[0] === 'newTask') sheets.renders += 1;
      return real.useSheetSteps(...args);
    },
  };
});

/** Waits until the rows stop rendering: the late answers and the effects of the last step are in. */
async function settled(): Promise<number> {
  let last = -1;
  while (last !== rows.renders) {
    last = rows.renders;
    await act(() => new Promise((resolve) => { window.setTimeout(resolve, 40); }));
  }
  return rows.renders;
}

describe('the project Tasks tab and the task panel (performance audit 2026-10-07, RND-2)', () => {
  it('does not render the rows again when a task panel opens or closes', async () => {
    await renderApp('/projects/prj_001?tab=tasks');
    await screen.findByText('Stair details', undefined, { timeout: 10_000 });
    const before = await settled();
    expect(before).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: /^Stair details/ }));
    await screen.findByRole('dialog', { name: 'Stair details' });
    expect(await settled()).toBe(before);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stair details' })).toBeNull());
    expect(await settled()).toBe(before);
  });

  it('does not render the closed New to-do sheet when a key is typed in a quick add', async () => {
    await renderApp('/projects/prj_001?tab=tasks', (state) => { state.session.currentUserId = 'usr_002'; });
    const field = await screen.findByRole('textbox', { name: 'Add a to-do in Construction Documents' });
    let last = -1;
    while (last !== sheets.renders) {
      last = sheets.renders;
      await act(() => new Promise((resolve) => { window.setTimeout(resolve, 40); }));
    }
    const before = sheets.renders;
    expect(before).toBeGreaterThan(0);
    await userEvent.type(field, 'Quick');
    expect(field).toHaveValue('Quick');
    expect(sheets.renders).toBe(before);
  });
});
