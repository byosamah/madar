import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { State } from '../../api/store';
import { todayISO } from '../../lib/dates';
import { renderApp } from '../../test/render';

// The shared order on Home (owner, 2026-10-08). In the sample office, usr_005 leads Civil Defense drawings (tsk_012).
const ME = 'usr_005';

/** Two of my tasks due today: the sample task and a copy of it. */
function today(state: State) {
  state.session.currentUserId = ME;
  const day = todayISO();
  const mine = state.tasks.tsk_012;
  mine.dueDate = day;
  state.tasks.tsk_901 = { ...structuredClone(mine), id: 'tsk_901', title: 'Probe stair section', prerequisiteIds: [] };
  state.counters.tsk = Math.max(state.counters.tsk, 901);
}

const titlesIn = (region: HTMLElement) => within(region).getAllByRole('listitem').map((item) => item.querySelector('[dir="auto"]')?.textContent ?? '');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the order of today on Home', () => {
  it('gives a grip to each task of today that I may move', async () => {
    await renderApp('/', today);
    const panel = await screen.findByRole('region', { name: 'Today' });
    expect(within(panel).getByRole('button', { name: 'Move Civil Defense drawings up or down' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Move Probe stair section up or down' })).toBeInTheDocument();
  });

  it('shows no grip in Coming up, because those tasks fall on different days', async () => {
    await renderApp('/', (state) => {
      state.session.currentUserId = ME;
      // Nothing of mine is due today or past due, so Home shows Coming up. Only Civil Defense drawings has a later date.
      for (const task of Object.values(state.tasks)) {
        if ((task.ownerId === ME || (task.helperIds ?? []).includes(ME)) && task.dueDate !== null && task.dueDate <= todayISO()) task.dueDate = '2099-06-01';
      }
      state.tasks.tsk_012.dueDate = '2099-01-15';
    });
    const panel = await screen.findByRole('region', { name: 'Coming up' });
    expect(within(panel).queryByRole('button', { name: /up or down$/ })).toBeNull();
  });

  it('moves a task up with the keyboard, and the Tasks screen shows the same new order', async () => {
    const { store } = await renderApp('/', today);
    const panel = await screen.findByRole('region', { name: 'Today' });
    // jsdom has no layout, so each row gets a box under the one before it.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const item = this.parentElement?.tagName === 'LI' ? this.parentElement : this.tagName === 'LI' ? this : null;
      const at = item?.parentElement ? [...item.parentElement.children].indexOf(item) : -1;
      const top = at >= 0 ? at * 60 : 0;
      const height = at >= 0 ? 56 : 0;
      return { left: 0, top, width: 300, height, right: 300, bottom: top + height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    const before = titlesIn(panel);
    const moving = 'Probe stair section';
    const from = before.indexOf(moving);
    expect(from).toBeGreaterThan(0);
    const grip = within(panel).getByRole('button', { name: `Move ${moving} up or down` });
    grip.focus();
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
    // The place message follows the pick-up at once, so the drag has started before the arrow key.
    expect(await screen.findByText(`${moving} is at place ${from + 1} of ${before.length}.`)).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(grip, { key: 'ArrowUp', code: 'ArrowUp' });
    });
    expect(await screen.findByText(`${moving} is at place ${from} of ${before.length}.`)).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
    });
    const expected = [...before];
    expected.splice(from, 1);
    expected.splice(from - 1, 0, moving);
    await waitFor(() => expect(titlesIn(panel)).toEqual(expected));
    expect(store.state.tasks.tsk_901.dueDate).toBe(todayISO());
    expect(typeof store.state.tasks.tsk_901.rank).toBe('number');
  });
});
