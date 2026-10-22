import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';
import { reduceMotion } from '../project/tasks/testMotion';

// Press and hold on a Board card on a phone (phone design D, task W5). In the sample office usr_005 is Sara Al-Qahtani (a member) and
// usr_002 leads Corniche Office Tower, where the "Toilet details" to-do waits for review. Today is 2026-09-30.
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const KEY = 'madar.work.view';

// The last props that the board gave to the drag overlay, so a test can read the drop animation.
const overlay = vi.hoisted(() => ({ props: null as null | { dropAnimation?: unknown } }));
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@dnd-kit/core')>();
  const { createElement } = await import('react');
  return {
    ...real,
    DragOverlay: (props: Parameters<typeof real.DragOverlay>[0]) => {
      overlay.props = props;
      return createElement(real.DragOverlay, props);
    },
  };
});

beforeEach(() => {
  localStorage.setItem(KEY, 'board');
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.removeItem(KEY);
});

const COLUMNS = ['todo', 'in_progress', 'in_review', 'done'];
const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
/** jsdom has no layout, so the columns get boxes side by side and the card gets its place in its column. */
function layout(card: HTMLElement) {
  const at = COLUMNS.indexOf((card.closest('[data-column]') as HTMLElement).dataset.column ?? '');
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const column = COLUMNS.indexOf(this.getAttribute('data-column') ?? '');
    if (column >= 0) return box(column * 250, 0, 240, 600);
    // The lifted copy of the card (the drag overlay, outside the columns) has the box of the card. dnd-kit measures its first child.
    const overlay = !this.closest('[data-column]') && this.classList.contains('surface');
    if (this === card || overlay) return box(at * 250 + 5, 60, 230, 80);
    return box(0, 0, 0, 0);
  });
}
const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });
const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
const status = () => [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent ?? '').join(' ');
/** The card of a title. The leader has two to-dos named "Toilet details", so a column can name the one. */
const cardOf = (title: string, column?: RegExp) => within(column ? screen.getByRole('region', { name: column }) : document.body).getByText(title, { selector: 'p' }).closest('li') as HTMLElement;
const lane = () => screen.getByRole('region', { name: /^To do/ }).parentElement as HTMLElement;

/** Hold, move, release. */
async function drop(card: HTMLElement, from: [number, number], to: [number, number]) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fireEvent.touchStart(card, touch(...from));
  await advance(400);
  fireEvent.touchMove(card, touch(...to));
  await advance(300);
  fireEvent.touchEnd(card, touch(...to));
  await advance(100);
}

async function openBoard(prepare: (state: State) => void, user: string) {
  phoneMedia({ phone: true, coarse: true });
  const view = await renderApp('/work', (state) => {
    state.session.currentUserId = user;
    prepare(state);
  });
  await screen.findByRole('region', { name: /^To do/ });
  return view;
}

describe('press and hold on a Board card', () => {
  it('shows why a reviewer card goes back after a touch drop on To do', async () => {
    await openBoard(() => undefined, 'usr_002');
    const card = cardOf('Toilet details', /^In review/);
    layout(card);
    await drop(card, [600, 100], [120, 100]);
    expect(await screen.findByText('This to-do is in review. Use Send back and write a note for the lead.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open to-do' })).toBeInTheDocument();
  });

  it('tells the lead that the to-do waits for the leader after a drop on Done', async () => {
    await openBoard((state) => {
      Object.values(state.tasks).find((task) => task.title === 'Toilet details' && task.projectId === 'prj_001')!.needsReview = true;
    }, 'usr_005');
    const card = cardOf('Toilet details');
    layout(card);
    await drop(card, [600, 100], [860, 100]);
    expect(await screen.findByText('This to-do waits for the leader to approve it.')).toBeInTheDocument();
  });

  // The project To-dos tab shares the board, and it lists a to-do that has no lead. The leader of the project may lift it.
  it('tells a card with no lead to get a lead first, with a way to open it', async () => {
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/projects/prj_001?tab=tasks', (state) => {
      state.session.currentUserId = 'usr_002';
      const task = Object.values(state.tasks).find((item) => item.title === 'Specifications draft' && item.projectId === 'prj_001')!;
      task.ownerId = null;
      task.status = 'todo';
    });
    // On a phone the project To-dos tab switches List and Board with one press of its View button (track P).
    await userEvent.click(await screen.findByRole('button', { name: /^View/ }));
    await screen.findByRole('region', { name: /^To do/ });
    const card = cardOf('Specifications draft', /^To do/);
    layout(card);
    await drop(card, [100, 100], [860, 100]);
    expect(await screen.findByText('Not yet. Give this to-do a lead first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open to-do' })).toBeInTheDocument();
  });

  it('moves a card to an open column after a touch drop', async () => {
    const { store } = await openBoard(() => undefined, 'usr_005');
    const card = cardOf('Civil Defense drawings');
    layout(card);
    await drop(card, [100, 100], [370, 100]);
    expect(await screen.findByText('Moved to In progress.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_012.status).toBe('in_progress');
  });

  it('does not lift when the finger swipes the lane', async () => {
    await openBoard(() => undefined, 'usr_005');
    const card = cardOf('Civil Defense drawings');
    layout(card);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.touchStart(card, touch(100, 100));
    await advance(100);
    fireEvent.touchMove(card, touch(130, 100));
    await advance(400);
    expect(status()).not.toMatch(/Picked up|is over/);
    fireEvent.touchEnd(card, touch(130, 100));
    await advance(100);
  });

  it('keeps the Move menu working: a touch on its button starts no lift', async () => {
    await openBoard(() => undefined, 'usr_005');
    const card = cardOf('Civil Defense drawings');
    layout(card);
    const button = within(card).getByRole('button', { name: 'Move Civil Defense drawings' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.touchStart(button, touch(100, 100));
    await advance(500);
    expect(status()).not.toMatch(/Picked up|is over/);
    fireEvent.touchEnd(button, touch(100, 100));
    await advance(100);
    vi.useRealTimers();
    await userEvent.click(button);
    expect(await screen.findByRole('menuitem', { name: 'In progress' })).toBeInTheDocument();
  });

  it('hides the grip, frees the title and stops the context menu on a touch phone', async () => {
    await openBoard(() => undefined, 'usr_005');
    const card = cardOf('Civil Defense drawings');
    expect(within(card).getByRole('button', { name: 'Drag Civil Defense drawings' })).toHaveClass('sr-only');
    const titleBox = within(card).getByText('Civil Defense drawings').parentElement as HTMLElement;
    expect(titleBox).toHaveClass('max-sm:pointer-coarse:pe-12', 'pe-24');
    expect(fireEvent.contextMenu(card)).toBe(false);
  });

  it('keeps the grip on a desk and lets the context menu through', async () => {
    phoneMedia({ phone: false });
    await renderApp('/work', as('usr_005'));
    await screen.findByRole('region', { name: /^To do/ });
    const card = cardOf('Civil Defense drawings');
    expect(within(card).getByRole('button', { name: 'Drag Civil Defense drawings' })).not.toHaveClass('sr-only');
    expect(fireEvent.contextMenu(card)).toBe(true);
  });

  it('turns the snap off while a card is lifted', async () => {
    await openBoard(() => undefined, 'usr_005');
    const card = cardOf('Civil Defense drawings');
    layout(card);
    expect(lane()).toHaveClass('max-sm:snap-x');
    const grip = within(card).getByRole('button', { name: 'Drag Civil Defense drawings' });
    grip.focus();
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
    await waitFor(() => expect(lane()).toHaveClass('max-sm:snap-none'));
    expect(lane()).not.toHaveClass('max-sm:snap-x');
    fireEvent.keyDown(grip, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(lane()).toHaveClass('max-sm:snap-x'));
  });

  it('scrolls the target column into view for a keyboard drag', async () => {
    await openBoard(() => undefined, 'usr_005');
    const card = cardOf('Civil Defense drawings');
    layout(card);
    const grip = within(card).getByRole('button', { name: 'Drag Civil Defense drawings' });
    grip.focus();
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
    await screen.findByText(/Civil Defense drawings is over To do\./);
    await act(async () => { fireEvent.keyDown(grip, { key: 'ArrowRight', code: 'ArrowRight' }); });
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    const call = scroll.mock.calls.findIndex((_, i) => (scroll.mock.contexts[i] as Element).getAttribute('data-column') === 'in_progress');
    expect(call).toBeGreaterThanOrEqual(0);
    expect(scroll.mock.calls[call]![0]).toEqual({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    fireEvent.keyDown(grip, { key: 'Escape', code: 'Escape' });
  });

  it('gives the drop animation on a touch phone', async () => {
    await openBoard(() => undefined, 'usr_005');
    expect(overlay.props?.dropAnimation).toEqual({ duration: 350, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.15)' });
  });

  it('sets no drop animation under reduced motion', async () => {
    phoneMedia({ phone: true, coarse: true });
    reduceMotion();
    await renderApp('/work', as('usr_005'));
    await screen.findByRole('region', { name: /^To do/ });
    expect(overlay.props?.dropAnimation).toBeNull();
  });
});
