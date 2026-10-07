import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { todayISO } from '../../lib/dates';
import { renderApp } from '../../test/render';

// The shared order of the Tasks screen (owner, 2026-10-07). In the sample office, usr_005 leads Civil Defense drawings (tsk_012).
const ME = 'usr_005';

/** Two more of my tasks due today, and one task of another lead that I only help with. */
function today(state: State) {
  state.session.currentUserId = ME;
  const day = todayISO();
  const mine = state.tasks.tsk_012;
  mine.dueDate = day;
  state.tasks.tsk_901 = { ...structuredClone(mine), id: 'tsk_901', title: 'Probe stair section', prerequisiteIds: [] };
  state.counters.tsk = Math.max(state.counters.tsk, 901);
  const other = Object.values(state.tasks).find((task) => task.projectId === mine.projectId && task.ownerId !== null && task.ownerId !== ME
    && task.createdBy !== ME && task.status === 'todo' && state.projects[mine.projectId!].leaderId !== ME)!;
  other.title = 'Probe helper task';
  other.dueDate = day;
  other.helperIds = [ME];
  other.prerequisiteIds = [];
}

const titlesIn = (region: HTMLElement) => within(region).getAllByRole('listitem').map((item) => item.querySelector('[dir="auto"]')?.textContent ?? '');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the order of a date group on the Tasks screen', () => {
  it('gives a grip to each task I may move, and none to a task I only help with', async () => {
    await renderApp('/work', today);
    const group = await screen.findByRole('region', { name: 'Today' });
    expect(within(group).getByRole('button', { name: 'Move Civil Defense drawings up or down' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Move Probe stair section up or down' })).toBeInTheDocument();
    expect(within(group).getByText('Probe helper task')).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: 'Move Probe helper task up or down' })).toBeNull();
  });

  it('shows no grip in a group with one task', async () => {
    await renderApp('/work', (state) => {
      state.session.currentUserId = ME;
      // Only Civil Defense drawings stays open, in Later.
      for (const task of Object.values(state.tasks)) {
        if (task.id !== 'tsk_012' && (task.ownerId === ME || (task.helperIds ?? []).includes(ME))) task.status = 'done';
      }
    });
    const later = await screen.findByRole('region', { name: 'Later' });
    expect(within(later).getAllByRole('listitem')).toHaveLength(1);
    expect(within(later).queryByRole('button', { name: /up or down$/ })).toBeNull();
  });

  it('moves a task up with the keyboard, keeps the new order for everyone, and takes it back with Undo', async () => {
    const { store } = await renderApp('/work', today);
    const group = await screen.findByRole('region', { name: 'Today' });
    // jsdom has no layout, so each row gets a box under the one before it.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const item = this.parentElement?.tagName === 'LI' ? this.parentElement : this.tagName === 'LI' ? this : null;
      const at = item?.parentElement ? [...item.parentElement.children].indexOf(item) : -1;
      const top = at >= 0 ? at * 60 : 0;
      const height = at >= 0 ? 56 : 0;
      return { left: 0, top, width: 300, height, right: 300, bottom: top + height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    const before = titlesIn(group);
    // The lowest task with a grip that has a task above it moves up one place.
    const grips = within(group).getAllByRole('button', { name: /^Move .* up or down$/ });
    const titleOf = (button: HTMLElement) => button.getAttribute('aria-label')!.replace(/^Move | up or down$/g, '');
    const grip = grips.filter((button) => before.indexOf(titleOf(button)) > 0).at(-1)!;
    const moving = titleOf(grip);
    const from = before.indexOf(moving);
    grip.focus();
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
    // The place message follows the pick-up at once, so the screen reader hears where the task is.
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
    await waitFor(() => expect(titlesIn(group)).toEqual(expected));
    expect(await screen.findByText('Order saved.')).toBeInTheDocument();
    const ranked = Object.values(store.state.tasks).filter((task) => typeof task.rank === 'number');
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((task) => task.ownerId === ME)).toBe(true);
    expect(store.state.tasks.tsk_012.dueDate).toBe(todayISO());
    // Undo takes the whole new order back.
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(Object.values(store.state.tasks).filter((task) => typeof task.rank === 'number')).toHaveLength(0));
    await waitFor(() => expect(titlesIn(group)).toEqual(before));
  });
});
