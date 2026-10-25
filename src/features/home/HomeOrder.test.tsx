import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { State } from '../../api/store';
import { addDays, todayISO } from '../../lib/dates';
import { renderApp } from '../../test/render';

// The Today list of Home holds two date groups in one list: past due first, then due today. A new order lives inside one group,
// so a drop across the two groups saves nothing (review 2026-10-25). In the sample office, usr_005 leads tsk_012.
const ME = 'usr_005';

/** tsk_012 is due today. Copies of it are past due: "Probe past due A" and, with `two`, "Probe past due B". */
const office = (two: boolean) => (state: State) => {
  state.session.currentUserId = ME;
  const day = todayISO();
  // The other tasks of this person leave the Today list, so it holds only the tasks of the test.
  for (const task of Object.values(state.tasks)) if (task.ownerId === ME && task.id !== 'tsk_012') task.dueDate = addDays(day, 30);
  const mine = state.tasks.tsk_012;
  mine.dueDate = day;
  mine.title = 'Probe due today';
  mine.prerequisiteIds = [];
  const copies = two ? ['A', 'B'] : ['A'];
  copies.forEach((name, i) => {
    const id = `tsk_90${i + 1}`;
    state.tasks[id] = { ...structuredClone(mine), id, title: `Probe past due ${name}`, dueDate: addDays(day, -1) };
  });
  state.counters.tsk = Math.max(state.counters.tsk, 902);
};

const titlesIn = (region: HTMLElement) => within(region).getAllByRole('listitem').map((item) => item.querySelector('[dir="auto"]')?.textContent ?? '');
const ranked = (state: State) => Object.values(state.tasks).filter((task) => typeof task.rank === 'number');

/** jsdom has no layout, so each row gets a box under the one before it. */
function rowBoxes() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const item = this.parentElement?.tagName === 'LI' ? this.parentElement : this.tagName === 'LI' ? this : null;
    const at = item?.parentElement ? [...item.parentElement.children].indexOf(item) : -1;
    const top = at >= 0 ? at * 60 : 0;
    const height = at >= 0 ? 56 : 0;
    return { left: 0, top, width: 300, height, right: 300, bottom: top + height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

/** Picks up the task with the keyboard, moves it one place up and drops it. */
async function moveUp(region: HTMLElement, title: string, from: number, count: number) {
  const grip = within(region).getByRole('button', { name: `Move ${title} up or down` });
  grip.focus();
  fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
  expect(await screen.findByText(`${title} is at place ${from} of ${count}.`)).toBeInTheDocument();
  await act(async () => {
    fireEvent.keyDown(grip, { key: 'ArrowUp', code: 'ArrowUp' });
  });
  expect(await screen.findByText(`${title} is at place ${from - 1} of ${count}.`)).toBeInTheDocument();
  await act(async () => {
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the order of the Today list on Home (review 2026-10-25)', () => {
  it('saves nothing for a drop across past due and due today, and says the move is cancelled', async () => {
    const { store } = await renderApp('/', office(false));
    const today = await screen.findByRole('region', { name: 'Today' });
    await waitFor(() => expect(titlesIn(today)).toEqual(['Probe past due A', 'Probe due today']));
    rowBoxes();
    await moveUp(today, 'Probe due today', 2, 2);
    expect(await screen.findByText('The move of Probe due today is cancelled.')).toBeInTheDocument();
    await act(() => new Promise((done) => setTimeout(done, 100)));
    expect(ranked(store.state)).toHaveLength(0);
    expect(screen.queryByText('Order saved.')).toBeNull();
    expect(titlesIn(today)).toEqual(['Probe past due A', 'Probe due today']);
  });

  it('still saves a new order inside one group', async () => {
    const { store } = await renderApp('/', office(true));
    const today = await screen.findByRole('region', { name: 'Today' });
    await waitFor(() => expect(titlesIn(today)).toEqual(['Probe past due A', 'Probe past due B', 'Probe due today']));
    rowBoxes();
    await moveUp(today, 'Probe past due B', 2, 3);
    expect(await screen.findByText('Order saved.')).toBeInTheDocument();
    await waitFor(() => expect(titlesIn(today)).toEqual(['Probe past due B', 'Probe past due A', 'Probe due today']));
    expect(ranked(store.state).length).toBeGreaterThan(0);
  });
});
