import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

// The drag layer of the checklist is a chunk of its own (fbk_043), as the layer of the task lists (FL-2). The list first draws static
// grips with no drag, and the layer takes their place when it has loaded. This test holds the import of the layer.
const gate = vi.hoisted(() => ({ on: false, calls: 0, open: (() => undefined) as () => void, wait: Promise.resolve() }));
vi.mock('./checklistLayerLoader', async (importOriginal) => {
  const real = await importOriginal<typeof import('./checklistLayerLoader')>();
  return {
    ...real,
    loadedChecklistLayer: () => (gate.on ? null : real.loadedChecklistLayer()),
    loadChecklistLayer: async () => {
      if (gate.on) {
        gate.calls += 1;
        await gate.wait;
      }
      return real.loadChecklistLayer();
    },
  };
});
function hold() {
  gate.on = true;
  gate.calls = 0;
  gate.wait = new Promise<void>((resolve) => {
    gate.open = () => {
      gate.on = false;
      resolve();
    };
  });
}

const OPEN = '/projects/prj_001?tab=tasks&task=tsk_007';
const two = (state: State) => {
  state.session.currentUserId = 'usr_006';
  state.tasks.tsk_007.checklist = [{ id: 'chk_a', text: 'First item', done: false }, { id: 'chk_b', text: 'Second item', done: false }];
};

afterEach(() => {
  gate.on = false;
});

describe('the static grips and the drag layer of the checklist', () => {
  it('draws the grips first with no drag, swaps in the layer, and keeps the focus on the same control', async () => {
    hold();
    await renderApp(OPEN, two);
    const panel = await screen.findByRole('dialog', { name: 'Stair details' });
    const grip = await within(panel).findByRole('button', { name: 'Move Second item up or down' });
    expect(grip).not.toHaveAttribute('aria-roledescription');
    const box = within(panel).getByRole('checkbox', { name: 'Second item' });
    act(() => box.focus());
    await act(async () => { gate.open(); await Promise.resolve(); });
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Move Second item up or down' })).toHaveAttribute('aria-roledescription', 'sortable'));
    expect(box.isConnected).toBe(false);
    expect(document.activeElement).toBe(within(panel).getByRole('checkbox', { name: 'Second item' }));
  });

  it('never loads the layer for a list with one item', async () => {
    hold();
    await renderApp(OPEN, (state) => {
      two(state);
      state.tasks.tsk_007.checklist = [{ id: 'chk_a', text: 'Only item', done: false }];
    });
    const panel = await screen.findByRole('dialog', { name: 'Stair details' });
    await within(panel).findByRole('checkbox', { name: 'Only item' });
    await act(async () => { await new Promise((resolve) => { window.setTimeout(resolve, 50); }); });
    expect(gate.calls).toBe(0);
  });
});
