import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TASKS = '/projects/prj_001?tab=tasks';

async function openBoard() {
  await userEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('radio', { name: 'Board' }));
  await userEvent.keyboard('{Escape}');
  await screen.findByRole('region', { name: /^To do/ });
}

const cardOf = (title: string) => within(screen.getByText(title).closest('li') as HTMLElement);

describe('a board card', () => {
  // The whole card kept 96 px free at its end for the two buttons, so the due words broke over three lines and the
  // waiting label was cut (audit 2026-10-03, F-13).
  it('keeps the due words on one line and gives the waiting label its own line', async () => {
    await renderApp(TASKS, as('usr_005'));
    await openBoard();
    const title = screen.getByText('Specifications draft');
    const card = cardOf('Specifications draft');
    // The free space follows the page direction, not the direction of the title text, so a Latin title in Arabic stays
    // clear of the buttons too.
    const titleBox = title.parentElement as HTMLElement;
    expect(titleBox).toHaveClass('pe-24');
    expect(titleBox).not.toHaveAttribute('dir');
    const face = titleBox.parentElement as HTMLElement;
    expect(face).not.toHaveClass('pe-24');
    const due = face.querySelector('span.tabular') as HTMLElement;
    expect(due.textContent).toMatch(/\d/);
    expect(due).toHaveClass('whitespace-nowrap');
    const waiting = card.getByText(/^Waiting for /);
    expect(waiting).not.toHaveClass('truncate');
    expect(waiting.parentElement).not.toBe(due.parentElement);
  });
});

describe('a refused board drop', () => {
  // A card in review went back with no visible reason when it was dropped on To do or In progress (audit 2026-10-03, F-9).
  it('marks To do and In progress as closed while the reviewer lifts a card in review', async () => {
    await renderApp(TASKS, as('usr_002'));
    await openBoard();
    expect(screen.queryByText('This task cannot move here.')).toBeNull();
    const grip = screen.getByRole('button', { name: 'Drag Toilet details' });
    grip.focus();
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
    expect(await screen.findByText('Picked up Toilet details.')).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('region', { name: /^To do/ })).getByText('This task cannot move here.')).toBeInTheDocument());
    expect(within(screen.getByRole('region', { name: /^In progress/ })).getByText('This task cannot move here.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: /^Done/ })).queryByText('This task cannot move here.')).toBeNull();
    expect(within(screen.getByRole('region', { name: /^In review/ })).queryByText('This task cannot move here.')).toBeNull();
    fireEvent.keyDown(grip, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByText('This task cannot move here.')).toBeNull());
  });

  it('says why after a drop on In progress, and Open task opens the review block', async () => {
    await renderApp(TASKS, as('usr_002'));
    await openBoard();
    // jsdom has no layout, so the columns get boxes side by side, and the card sits in In review.
    const card = screen.getByText('Toilet details').closest('li') as HTMLElement;
    const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    const columns = ['todo', 'in_progress', 'in_review', 'done'];
    const measure = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const at = columns.indexOf(this.getAttribute('data-column') ?? '');
      if (at >= 0) return box(at * 250, 0, 240, 600);
      if (this === card) return box(505, 60, 230, 80);
      return box(0, 0, 0, 0);
    });
    try {
      fireEvent.pointerDown(card, { clientX: 600, clientY: 100, isPrimary: true, button: 0 });
      fireEvent.pointerMove(document, { clientX: 590, clientY: 100 });
      fireEvent.pointerMove(document, { clientX: 360, clientY: 100 });
      fireEvent.pointerUp(document, { clientX: 360, clientY: 100 });
    } finally {
      measure.mockRestore();
    }
    expect(await screen.findByText('This task is in review. Use Send back and write a note for the lead.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open task' }));
    expect(await screen.findByRole('region', { name: 'Review' })).toBeInTheDocument();
  });

  // The lead of a task in review may only pull it back (F-19), so Done is closed for them. A drop there tells the lead who
  // finishes the task, not to send it back (the merge of F-9 and F-19, audit 2026-10-03).
  it('tells the lead that the task waits for the leader after a drop on Done', async () => {
    await renderApp(TASKS, (state) => {
      state.session.currentUserId = 'usr_005';
      // A task that needs review: only then does Done wait for the leader. Without review, the lead may finish it.
      Object.values(state.tasks).find((task) => task.title === 'Toilet details' && task.projectId === 'prj_001')!.needsReview = true;
    });
    await openBoard();
    const card = screen.getByText('Toilet details').closest('li') as HTMLElement;
    const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    const columns = ['todo', 'in_progress', 'in_review', 'done'];
    const measure = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const at = columns.indexOf(this.getAttribute('data-column') ?? '');
      if (at >= 0) return box(at * 250, 0, 240, 600);
      if (this === card) return box(505, 60, 230, 80);
      return box(0, 0, 0, 0);
    });
    try {
      fireEvent.pointerDown(card, { clientX: 600, clientY: 100, isPrimary: true, button: 0 });
      fireEvent.pointerMove(document, { clientX: 610, clientY: 100 });
      fireEvent.pointerMove(document, { clientX: 860, clientY: 100 });
      fireEvent.pointerUp(document, { clientX: 860, clientY: 100 });
    } finally {
      measure.mockRestore();
    }
    expect(await screen.findByText('This task waits for the leader to approve it.')).toBeInTheDocument();
    expect(screen.queryByText('This task is in review. Use Send back and write a note for the lead.')).toBeNull();
  });

  // On a phone the board scrolls while the card goes to the start edge. The delta of the drag end counts that scroll too,
  // so the drop point missed To do and no reason showed (audit 2026-10-03, F-9).
  it('says why after a drop on To do when the board scrolled during the drag', async () => {
    await renderApp(TASKS, as('usr_002'));
    await openBoard();
    const card = screen.getByText('Toilet details').closest('li') as HTMLElement;
    const board = screen.getByRole('region', { name: /^To do/ }).parentElement as HTMLElement;
    // jsdom has no layout. The board scrolls by its style and its scrollLeft, and the columns move with the scroll.
    let scroll = 500;
    board.style.overflowX = 'auto';
    Object.defineProperty(board, 'scrollLeft', { configurable: true, get: () => scroll, set: (value: number) => { scroll = value; } });
    const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    const columns = ['todo', 'in_progress', 'in_review', 'done'];
    const measure = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const at = columns.indexOf(this.getAttribute('data-column') ?? '');
      if (at >= 0) return box(at * 250 - scroll, 0, 240, 600);
      if (this === card) return box(505 - scroll, 60, 230, 80);
      if (this === board) return box(0, 0, 390, 600);
      return box(0, 0, 0, 0);
    });
    try {
      // At the start To do is off the screen and the card is in view. The board then scrolls to its start, and the
      // pointer lets go over To do.
      fireEvent.pointerDown(card, { clientX: 100, clientY: 100, isPrimary: true, button: 0 });
      fireEvent.pointerMove(document, { clientX: 90, clientY: 100 });
      scroll = 0;
      fireEvent.scroll(board);
      fireEvent.pointerMove(document, { clientX: 120, clientY: 100 });
      fireEvent.pointerUp(document, { clientX: 120, clientY: 100 });
    } finally {
      measure.mockRestore();
    }
    expect(await screen.findByText('This task is in review. Use Send back and write a note for the lead.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open task' })).toBeInTheDocument();
  });
});
