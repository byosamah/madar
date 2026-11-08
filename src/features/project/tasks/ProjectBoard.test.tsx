import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { stagesChrono } from '../../../lib/stageFlow';
import { phoneMedia } from '../../../test/phoneMedia';
import { renderApp } from '../../../test/render';

/**
 * The board of the project To-dos tab (fbk_085, owner 2026-11-08). Step 1, every project: a View button beside Filter (the look of the View
 * button of Work), the stage name on each card, a Done column of the last 7 days, and "n open, m done" on the cards of the list. Step 2, a
 * continuous project: the columns are the stages, a card shows its status as a sign and a word, and a drag or the menu moves it to a stage.
 * Today is 2026-09-30 in the test office. usr_002 leads prj_001, usr_005 is a member.
 */
const LOAD = { timeout: 10_000 };
const TASKS = '/projects/prj_001?tab=tasks';
const KEY = 'madar.tasks.view';
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const together = (userId: string) => (state: State) => {
  as(userId)(state);
  state.projects.prj_001.continuous = true;
};

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const stagesOf = (state: State) => stagesChrono(Object.values(state.stages).filter((stage) => stage.projectId === 'prj_001'));
const tasksOf = (state: State) => Object.values(state.tasks).filter((task) => task.projectId === 'prj_001');
const openIn = (state: State, stageId: string) => tasksOf(state).filter((task) => task.stageId === stageId && task.status !== 'done').length;
const doneIn = (state: State, stageId: string) => tasksOf(state).filter((task) => task.stageId === stageId && task.status === 'done').length;

/** The View button, then Board in its choice box. */
async function openBoard(regionName: RegExp = /^To do/) {
  await userEvent.click(await screen.findByRole('button', { name: 'View' }, LOAD));
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'View' })).getByRole('radio', { name: 'Board' }));
  await userEvent.keyboard('{Escape}');
  await screen.findAllByRole('region', { name: regionName }, LOAD);
}

describe('the View button of the To-dos tab', () => {
  it('sits beside Filter on a desk, and the choice of the view leaves the Filter box', async () => {
    await renderApp(TASKS, as('usr_002'));
    const filter = await screen.findByRole('button', { name: /^Filter/ }, LOAD);
    const view = screen.getByRole('button', { name: 'View' });
    // The View button keeps its own wrapper, as on Work, so the wrapper is the sibling of Filter.
    expect(view.parentElement?.parentElement).toBe(filter.parentElement);
    expect(filter.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(filter);
    const box = await screen.findByRole('dialog', { name: 'Filter' });
    expect(within(box).queryByRole('radio', { name: 'Board' })).toBeNull();
    expect(within(box).queryByRole('radio', { name: 'List' })).toBeNull();
    expect(within(box).getByRole('checkbox', { name: 'Show done to-dos' })).toBeInTheDocument();
  });

  it('opens List and Board, and keeps the choice on this device', async () => {
    await renderApp(TASKS, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'View' }, LOAD));
    const box = await screen.findByRole('dialog', { name: 'View' });
    expect(within(box).getByRole('radio', { name: 'List' })).toBeChecked();
    await userEvent.click(within(box).getByRole('radio', { name: 'Board' }));
    expect(window.localStorage.getItem(KEY)).toBe('board');
    expect(await screen.findByRole('region', { name: /^To do/ }, LOAD)).toBeInTheDocument();
  });

  it('is the round toggle of the Work page on a phone', async () => {
    phoneMedia(true);
    await renderApp(TASKS, as('usr_002'));
    const toggle = await screen.findByRole('button', { name: 'Board' }, LOAD);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveClass('size-11', 'rounded-full');
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem(KEY)).toBe('board');
  });
});

describe('the board of a project whose stages go in order', () => {
  it('names the stage on each card, in one quiet line', async () => {
    const { store } = await renderApp(TASKS, as('usr_002'));
    await openBoard();
    const task = tasksOf(store.state).find((one) => one.title === 'Specifications draft')!;
    const stage = store.state.stages[task.stageId!];
    const card = screen.getByText('Specifications draft').closest('li') as HTMLElement;
    const line = within(card).getByText(stage.name);
    expect(line.closest('p')).toHaveClass('text-footnote', 'text-ink-2');
  });

  it('shows only the last 7 days in Done, with the note "Last 7 days"', async () => {
    let recent = '';
    const { store } = await renderApp(TASKS, (state) => {
      as('usr_002')(state);
      const done = tasksOf(state).filter((task) => task.status === 'done');
      expect(done.length).toBeGreaterThan(2);
      done.forEach((task, at) => { task.completedAt = at === 0 ? '2026-09-28T09:00:00.000+03:00' : '2026-09-01T09:00:00.000+03:00'; });
      recent = done[0].title;
    });
    await openBoard();
    const column = await screen.findByRole('region', { name: 'Done: 1' });
    expect(within(column).getByText(recent)).toBeInTheDocument();
    expect(within(column).getByText('Last 7 days')).toBeInTheDocument();
    expect(tasksOf(store.state).filter((task) => task.status === 'done').length).toBeGreaterThan(2);
  });

  it('says "n open, m done" on the card of a stage in the list', async () => {
    const { store } = await renderApp(TASKS, as('usr_002'));
    const stage = stagesOf(store.state).map((one) => ({ one, open: openIn(store.state, one.id), done: doneIn(store.state, one.id) })).sort((a, b) => b.done - a.done)[0];
    expect(stage.done).toBeGreaterThan(0);
    const group = await screen.findByRole('region', { name: stage.one.name }, LOAD);
    expect(within(group).getByText(`${stage.open} open, ${stage.done} done`)).toBeInTheDocument();
    expect(within(group).queryByText(/^To-dos: /)).toBeNull();
  });
});

describe('the board of a continuous project', () => {
  it('has one column for each stage, with its open to-dos in the header', async () => {
    const { store } = await renderApp(TASKS, together('usr_002'));
    await openBoard(/, \d+ open$/);
    for (const stage of stagesOf(store.state)) {
      const column = screen.getByRole('region', { name: `${stage.name}, ${openIn(store.state, stage.id)} open` });
      expect(within(column).getByRole('heading', { name: new RegExp(`^${stage.name}`) })).toBeInTheDocument();
      expect(column).toHaveTextContent(`${openIn(store.state, stage.id)} open`);
    }
    expect(screen.queryByRole('region', { name: /^To do/ })).toBeNull();
    expect(screen.queryByRole('region', { name: /^In progress/ })).toBeNull();
  });

  it('shows the status of a card as a sign and an ink word, and no done card', async () => {
    const { store } = await renderApp(TASKS, together('usr_002'));
    await openBoard(/, \d+ open$/);
    const task = tasksOf(store.state).find((one) => one.status === 'in_progress')!;
    const card = screen.getByText(task.title).closest('li') as HTMLElement;
    const word = within(card).getByText('In progress');
    expect(word.closest('[data-task-status]')).toHaveAttribute('data-task-status', 'in_progress');
    expect(word.closest('[data-task-status]')?.querySelector('svg')).toBeInTheDocument();
    expect(word.closest('[data-task-status]')?.className ?? '').not.toMatch(/bg-/);
    for (const done of tasksOf(store.state).filter((one) => one.status === 'done')) expect(screen.queryByText(done.title)).toBeNull();
  });

  it('shows the done to-dos of a stage as one quiet line at the foot of its column', async () => {
    const { store } = await renderApp(TASKS, together('usr_002'));
    await openBoard(/, \d+ open$/);
    const stage = stagesOf(store.state).find((one) => doneIn(store.state, one.id) > 1)!;
    const column = screen.getByRole('region', { name: new RegExp(`^${stage.name}, `) });
    const line = within(column).getByText(`${doneIn(store.state, stage.id)} done`);
    expect(line.tagName).toBe('P');
    const list = column.querySelector('ul') as HTMLElement;
    expect(list.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('moves a card to a stage with the card menu: one tasks.update, a toast with Undo, and no reason asked', async () => {
    const { store } = await renderApp(TASKS, together('usr_002'));
    await openBoard(/, \d+ open$/);
    const stages = stagesOf(store.state);
    // A card of the last stage moves to the first: an earlier stage, which an ordered project would ask a reason for.
    const task = tasksOf(store.state).find((one) => one.stageId === stages[stages.length - 1].id && one.status !== 'done')
      ?? tasksOf(store.state).find((one) => one.status !== 'done' && one.stageId !== stages[0].id)!;
    const from = task.stageId;
    await userEvent.click(await screen.findByRole('button', { name: `Move ${task.title}` }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(stages.filter((stage) => stage.id !== from).map((stage) => stage.name));
    expect(screen.getByText('Move to stage')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: stages[0].name }));
    await waitFor(() => expect(store.state.tasks[task.id].stageId).toBe(stages[0].id));
    expect(await screen.findByText(`Moved to ${stages[0].name}.`)).toBeInTheDocument();
    expect(store.state.projects.prj_001.stageBack ?? null).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks[task.id].stageId).toBe(from));
  });

  it('moves a card with a drag from one stage column to another', async () => {
    const { store } = await renderApp(TASKS, together('usr_002'));
    await openBoard(/, \d+ open$/);
    const stages = stagesOf(store.state);
    const fromAt = stages.findIndex((stage) => openIn(store.state, stage.id) > 0);
    const toAt = fromAt === 2 ? 0 : 2;
    const task = tasksOf(store.state).find((one) => one.stageId === stages[fromAt].id && one.status !== 'done')!;
    const card = screen.getByText(task.title).closest('li') as HTMLElement;
    const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    const ids = stages.map((stage) => stage.id);
    const measure = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const at = ids.indexOf(this.getAttribute('data-column') ?? '');
      if (at >= 0) return box(at * 250, 0, 240, 600);
      // The lifted copy of the card (the drag overlay, outside the columns) has the box of the card. dnd-kit measures its first child.
      const overlay = !this.closest('[data-column]') && this.classList.contains('surface');
      if (this === card || overlay) return box(fromAt * 250 + 5, 60, 230, 80);
      return box(0, 0, 0, 0);
    });
    try {
      fireEvent.pointerDown(card, { clientX: fromAt * 250 + 100, clientY: 100, isPrimary: true, button: 0 });
      fireEvent.pointerMove(document, { clientX: fromAt * 250 + 110, clientY: 100 });
      fireEvent.pointerMove(document, { clientX: toAt * 250 + 100, clientY: 100 });
      fireEvent.pointerUp(document, { clientX: toAt * 250 + 100, clientY: 100 });
    } finally {
      measure.mockRestore();
    }
    await waitFor(() => expect(store.state.tasks[task.id].stageId).toBe(stages[toAt].id));
  });

  it('gives no drag and no menu on the card of another person to a member without the right to change its details', async () => {
    const { store } = await renderApp(TASKS, together('usr_005'));
    await openBoard(/, \d+ open$/);
    const other = tasksOf(store.state).find((one) => one.ownerId !== 'usr_005' && one.status !== 'done' && one.createdBy !== 'usr_005')!;
    await screen.findByText(other.title);
    expect(screen.queryByRole('button', { name: `Move ${other.title}` })).toBeNull();
    expect(screen.queryByRole('button', { name: `Drag ${other.title}` })).toBeNull();
  });

  it('keeps the status columns for a project whose stages go in order', async () => {
    await renderApp(TASKS, as('usr_002'));
    await openBoard();
    expect(screen.getByRole('region', { name: /^In progress/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /, \d+ open$/ })).toBeNull();
  });
});

describe('the board of a continuous project on a phone', () => {
  it('fills the width with one column and has a stage button in place of the dots', async () => {
    phoneMedia(true);
    Element.prototype.scrollIntoView = vi.fn();
    const { store } = await renderApp(TASKS, together('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Board' }, LOAD));
    const stages = stagesOf(store.state);
    const first = stages[0];
    const button = await screen.findByRole('button', { name: `${first.name}, ${openIn(store.state, first.id)} open` }, LOAD);
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    const lane = screen.getByRole('region', { name: new RegExp(`^${first.name}, `) }).parentElement as HTMLElement;
    expect(lane.className).toContain('max-sm:auto-cols-[100%]');
    // The four dots of the status board are gone.
    expect(screen.queryAllByRole('button', { name: /^(To do|In progress|In review|Done): / })).toHaveLength(0);
    await userEvent.click(button);
    const sheet = await screen.findByRole('dialog', { name: 'Stages' });
    const target = stages[3];
    await userEvent.click(within(sheet).getByRole('button', { name: `${target.name} ${openIn(store.state, target.id)} open` }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: `${target.name}, ${openIn(store.state, target.id)} open` })).toBeInTheDocument();
  });
});
