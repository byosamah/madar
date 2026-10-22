import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { setNow, todayISO } from '../../lib/dates';
import { NOW } from '../../test/factories';
import { renderApp } from '../../test/render';

// The drag layer is a chunk of its own (performance audit 2026-10-21, FL-2). The list first draws static rows with the same markup, and
// the drag layer takes its place when it has loaded. This test holds the import of the layer, so the first frame is the static one.
const gate = vi.hoisted(() => ({ on: false, calls: 0, open: (() => undefined) as () => void, wait: Promise.resolve() }));
vi.mock('../project/tasks/dragLayerLoader', async (importOriginal) => {
  const real = await importOriginal<typeof import('../project/tasks/dragLayerLoader')>();
  return {
    ...real,
    loadedDragLayer: () => (gate.on ? null : real.loadedDragLayer()),
    loadDragLayer: async () => {
      if (gate.on) {
        gate.calls += 1;
        await gate.wait;
      }
      return real.loadDragLayer();
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

const ME = 'usr_005';
function today(state: State) {
  state.session.currentUserId = ME;
  const mine = state.tasks.tsk_012;
  mine.dueDate = todayISO();
  mine.startDate = todayISO();
  state.tasks.tsk_901 = { ...structuredClone(mine), id: 'tsk_901', title: 'Probe stair section', prerequisiteIds: [] };
  state.counters.tsk = Math.max(state.counters.tsk, 901);
}

afterEach(() => {
  gate.on = false;
  setNow(NOW);
});

describe('the static rows and the drag layer (FL-2)', () => {
  it('draws the grips first with no drag, then swaps in the drag layer, and the focus stays', async () => {
    hold();
    await renderApp('/work', today);
    const group = await screen.findByRole('region', { name: 'Today' });
    const grip = within(group).getByRole('button', { name: 'Move Civil Defense drawings up or down' });
    // The static grip has no dnd-kit attributes.
    expect(grip).not.toHaveAttribute('aria-roledescription');
    const items = within(group).getAllByRole('listitem');
    const rowIndex = items.findIndex((item) => item.contains(grip));
    const buttons: HTMLElement[] = [...items[rowIndex]!.querySelectorAll('button')];
    const controlIndex = buttons.indexOf(grip);
    const control = buttons[1]!;
    expect(controlIndex).toBeGreaterThan(1);
    act(() => control.focus());
    expect(document.activeElement).toBe(control);
    // Every style that a row of the list gets after the swap. A row that enters again starts at opacity 0.
    const styles: string[] = [];
    const note = (node: Node) => {
      if (node instanceof HTMLElement && node.tagName === 'LI') styles.push(node.getAttribute('style') ?? '');
      if (node instanceof HTMLElement) node.querySelectorAll('li').forEach((item) => styles.push(item.getAttribute('style') ?? ''));
    };
    const watch = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach(note);
        if (record.type === 'attributes') note(record.target);
      }
    });
    watch.observe(group, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
    await act(async () => { gate.open(); await Promise.resolve(); });
    await waitFor(() => expect(within(group).getByRole('button', { name: 'Move Civil Defense drawings up or down' })).toHaveAttribute('aria-roledescription', 'sortable'));
    watch.disconnect();
    // The rows are new nodes, and the focus is on the same control of the same row.
    expect(control.isConnected).toBe(false);
    const after = document.activeElement as HTMLElement;
    expect(after.tagName).toBe('BUTTON');
    expect(after.textContent).toBe(control.textContent);
    expect(within(group).getAllByRole('listitem').findIndex((item) => item.contains(after))).toBe(rowIndex);
    expect(styles.length).toBeGreaterThan(0);
    for (const style of styles) expect(style).not.toMatch(/opacity:\s*0(?![.\d])/);
  });

  it('never loads the drag layer for a list with no grip', async () => {
    hold();
    await renderApp('/work', (state) => {
      state.session.currentUserId = ME;
      // Only Civil Defense drawings stays open, so its group has one task and no grip.
      for (const task of Object.values(state.tasks)) {
        if (task.id !== 'tsk_012' && (task.ownerId === ME || (task.helperIds ?? []).includes(ME))) task.status = 'done';
      }
    });
    const later = await screen.findByRole('region', { name: 'Later' });
    expect(within(later).getAllByRole('listitem')).toHaveLength(1);
    await act(async () => { await new Promise((resolve) => { window.setTimeout(resolve, 50); }); });
    expect(gate.calls).toBe(0);
  });

  it('gives a row the new day when the list renders again, though the row is memoized', async () => {
    await renderApp('/work', today);
    const group = await screen.findByRole('region', { name: 'Today' });
    expect(within(group).getAllByText('Due today').length).toBeGreaterThan(0);
    // The clock moves one day. A press on a row opens the panel, so the list renders again with the new day.
    setNow(new Date(NOW.getTime() + 24 * 60 * 60 * 1000));
    await userEvent.click(within(group).getByRole('button', { name: /^Probe stair section/ }));
    await screen.findByRole('dialog');
    await waitFor(() => expect(screen.queryAllByText('1 day past due').length).toBeGreaterThan(0));
  });
});
