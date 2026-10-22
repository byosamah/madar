import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import type { State } from '../../api/store';
import { todayISO } from '../../lib/dates';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';

// The hint line of the Work list and the early drag layer (phone design D, task W6). The gate holds the import of the drag layer.
const gate = vi.hoisted(() => ({ on: false, calls: 0, warmed: 0, open: (() => undefined) as () => void, wait: Promise.resolve() }));
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
    warmDragLayer: () => {
      gate.warmed += 1;
      real.warmDragLayer();
    },
  };
});
function hold() {
  gate.on = true;
  gate.wait = new Promise<void>((resolve) => {
    gate.open = () => {
      gate.on = false;
      resolve();
    };
  });
}

// Each render of a task row (performance rule RND-2).
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

const ME = 'usr_005';
const HINT = 'Press and hold a to-do to change its order.';

/** Two of my tasks due today (so the Today group has two rows I may move). */
function today(state: State) {
  state.session.currentUserId = ME;
  const mine = state.tasks.tsk_012;
  mine.dueDate = todayISO();
  state.tasks.tsk_901 = { ...structuredClone(mine), id: 'tsk_901', title: 'Probe stair section', prerequisiteIds: [] };
  state.counters.tsk = Math.max(state.counters.tsk, 901);
}

/** I only help: the lead of every open to-do of mine is someone else, so no row can move. */
function onlyHelping(state: State) {
  today(state);
  for (const task of Object.values(state.tasks)) {
    if (task.ownerId === ME) {
      task.ownerId = 'usr_006';
      task.helperIds = [ME];
    }
  }
}

beforeEach(() => {
  gate.on = false;
  gate.calls = 0;
  gate.warmed = 0;
  localStorage.removeItem('madar.work.view');
});
afterEach(() => {
  gate.on = false;
  localStorage.removeItem('madar.work.view');
});

async function settled(): Promise<number> {
  let last = -1;
  while (last !== rows.renders) {
    last = rows.renders;
    await act(() => new Promise((resolve) => { window.setTimeout(resolve, 40); }));
  }
  return rows.renders;
}

describe('the hold hint of the Work list', () => {
  it('shows the hint after the last group on a touch phone, in the List view', async () => {
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/work', today);
    const hint = await screen.findByText(HINT);
    expect(hint).toHaveClass('text-footnote');
    const sections = screen.getAllByRole('region');
    const last = sections[sections.length - 1]!;
    // The hint comes after the last group in the page.
    expect(last.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('waits for the drag layer', async () => {
    hold();
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/work', today);
    await screen.findByRole('region', { name: 'Today' });
    await act(async () => { await new Promise((resolve) => { window.setTimeout(resolve, 50); }); });
    expect(screen.queryByText(HINT)).toBeNull();
    await act(async () => { gate.open(); await Promise.resolve(); });
    expect(await screen.findByText(HINT)).toBeInTheDocument();
  });

  it('shows no hint on a desk', async () => {
    phoneMedia({ phone: false });
    await renderApp('/work', today);
    await screen.findByRole('region', { name: 'Today' });
    await act(async () => { await new Promise((resolve) => { window.setTimeout(resolve, 50); }); });
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('shows no hint on a narrow window with a mouse', async () => {
    phoneMedia({ phone: true, coarse: false });
    await renderApp('/work', today);
    await screen.findByRole('region', { name: 'Today' });
    await act(async () => { await new Promise((resolve) => { window.setTimeout(resolve, 50); }); });
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('shows no hint in the Board view', async () => {
    localStorage.setItem('madar.work.view', 'board');
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/work', today);
    await screen.findByRole('region', { name: /^To do/ });
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('shows no hint when no group has two rows to move', async () => {
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/work', (state) => {
      state.session.currentUserId = ME;
      // Only Civil Defense drawings stays open, so its group has one task.
      for (const task of Object.values(state.tasks)) {
        if (task.id !== 'tsk_012' && (task.ownerId === ME || (task.helperIds ?? []).includes(ME))) task.status = 'done';
      }
    });
    await screen.findByRole('region', { name: 'Later' });
    await act(async () => { await new Promise((resolve) => { window.setTimeout(resolve, 50); }); });
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('shows no hint when the person only helps (no row can move)', async () => {
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/work', onlyHelping);
    await screen.findByRole('region', { name: 'Today' });
    await act(async () => { await new Promise((resolve) => { window.setTimeout(resolve, 50); }); });
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('warms the drag layer when the screen opens, also with no sortable group', async () => {
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/work', (state) => {
      state.session.currentUserId = ME;
      for (const task of Object.values(state.tasks)) {
        if (task.id !== 'tsk_012' && (task.ownerId === ME || (task.helperIds ?? []).includes(ME))) task.status = 'done';
      }
    });
    await screen.findByRole('region', { name: 'Later' });
    expect(gate.warmed).toBe(1);
  });

  it('changes no row when the layer becomes ready', async () => {
    hold();
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/work', today);
    const group = await screen.findByRole('region', { name: 'Today' });
    const before = await settled();
    expect(within(group).getAllByRole('listitem').length).toBeGreaterThan(1);
    await act(async () => { gate.open(); await Promise.resolve(); });
    await screen.findByText(HINT);
    await waitFor(() => expect(within(group).getByRole('button', { name: 'Move Civil Defense drawings up or down' })).toHaveAttribute('aria-roledescription', 'sortable'));
    // The swap to the drag layer makes the rows once more; the hint adds no render of its own. A second wait finds no new render.
    const after = await settled();
    expect(await settled()).toBe(after);
    expect(after - before).toBeLessThanOrEqual(before);
  });
});

describe('the fade between List and Board on a phone', () => {
  it('sits the content in a box that fades in on a phone', async () => {
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/work', today);
    const group = await screen.findByRole('region', { name: 'Today' });
    // The list is in its own box (the fade), inside the box of the screen, which also holds the task panel.
    const box = group.parentElement as HTMLElement;
    expect(box).toHaveClass('flex', 'flex-col', 'gap-5');
    expect(box.parentElement).toHaveClass('flex', 'flex-col', 'gap-5');
  });

  it('keeps the DOM of the desk', async () => {
    phoneMedia({ phone: false });
    await renderApp('/work', today);
    const group = await screen.findByRole('region', { name: 'Today' });
    expect(group.parentElement).toHaveClass('flex', 'flex-col', 'gap-5');
    expect(group.parentElement!.parentElement).not.toHaveClass('gap-5');
  });
});
