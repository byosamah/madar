import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { State } from '../../api/store';
import { todayISO } from '../../lib/dates';
import { renderApp } from '../../test/render';
import { phoneMedia } from '../../test/phoneMedia';
import { reduceMotion } from '../project/tasks/testMotion';

// Press and hold on a list row (phone design D, task W2). usr_005 leads Civil Defense drawings (tsk_012).
const ME = 'usr_005';
const PROJECT = 'prj_001';

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

/** Two tasks of mine in one stage of the project. */
function inOneStage(state: State) {
  state.session.currentUserId = ME;
  const sameProject = Object.values(state.tasks).find((task) => task.projectId === PROJECT)!;
  const task = state.tasks.tsk_012;
  task.projectId = PROJECT;
  task.stageId = sameProject.stageId;
  task.status = 'todo';
  state.tasks.tsk_901 = { ...structuredClone(task), id: 'tsk_901', title: 'Probe stair section', prerequisiteIds: [] };
  state.counters.tsk = Math.max(state.counters.tsk, 901);
}

/** jsdom has no layout, so each row gets a box under the one before it. */
function mockRects() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const item = this.parentElement?.tagName === 'LI' ? this.parentElement : this.tagName === 'LI' ? this : null;
    const at = item?.parentElement ? [...item.parentElement.children].indexOf(item) : -1;
    const top = at >= 0 ? at * 60 : 0;
    const height = at >= 0 ? 56 : 0;
    return { left: 0, top, width: 300, height, right: 300, bottom: top + height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

const rowBox = (group: HTMLElement, title: string) => within(group).getByText(title).closest('li')!.firstElementChild as HTMLElement;
const grip = (group: HTMLElement, title: string) => within(group).getByRole('button', { name: `Move ${title} up or down` });
// Each list has its own live region of dnd-kit, so the page holds several. The one that speaks has text.
const status = () => [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent ?? '').join(' ');
const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });
const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });

async function openToday(): Promise<HTMLElement> {
  const view = await renderApp('/work', today);
  const group = await screen.findByRole('region', { name: 'Today' });
  // The grips come from the drag layer. Wait for it.
  await waitFor(() => expect(grip(group, 'Civil Defense drawings')).toHaveAttribute('aria-roledescription'));
  void view;
  return group;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('press and hold on a list row', () => {
  it('hides the grip and the spacer on a touch phone', async () => {
    phoneMedia({ phone: true, coarse: true });
    const group = await openToday();
    expect(grip(group, 'Civil Defense drawings')).toHaveClass('sr-only');
    // The row of the task that I only help with has no blank in the place of the grip.
    expect(group.querySelectorAll('li span[aria-hidden].w-8')).toHaveLength(0);
  });

  it('keeps the grip and the spacer on a desk', async () => {
    const group = await openToday();
    expect(grip(group, 'Civil Defense drawings')).not.toHaveClass('sr-only');
    expect(group.querySelectorAll('li span[aria-hidden].w-8').length).toBeGreaterThan(0);
  });

  it('lifts a row after a 400 ms hold', async () => {
    phoneMedia({ phone: true, coarse: true });
    const group = await openToday();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.touchStart(rowBox(group, 'Civil Defense drawings'), touch(100, 100));
    await advance(399);
    expect(status()).not.toMatch(/Picked up|is at place/);
    await advance(1);
    // The live region of dnd-kit says the place at once, and the place message follows the pick-up in the same step.
    expect(status()).toMatch(/Civil Defense drawings is at place \d of \d\./);
    expect(rowBox(group, 'Civil Defense drawings')).toHaveClass('scale-[1.02]', 'motion-reduce:scale-100');
    // End the drag, so its click guard on the document does not stay for the next test.
    fireEvent.touchEnd(rowBox(group, 'Civil Defense drawings'), touch(100, 100));
    await advance(100);
  });

  it('does not lift when the finger moves 12 px before 400 ms, and sends no order call', async () => {
    phoneMedia({ phone: true, coarse: true });
    const { store } = await renderApp('/work', today);
    const group = await screen.findByRole('region', { name: 'Today' });
    await waitFor(() => expect(grip(group, 'Civil Defense drawings')).toHaveAttribute('aria-roledescription'));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.touchStart(rowBox(group, 'Civil Defense drawings'), touch(100, 100));
    await advance(200);
    fireEvent.touchMove(rowBox(group, 'Civil Defense drawings'), touch(100, 112));
    await advance(400);
    expect(status()).not.toMatch(/Picked up|is at place/);
    expect(Object.values(store.state.tasks).filter((task) => typeof task.rank === 'number')).toHaveLength(0);
  });

  it('does not lift on a desk', async () => {
    const group = await openToday();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.touchStart(rowBox(group, 'Civil Defense drawings'), touch(100, 100));
    await advance(500);
    expect(status()).not.toMatch(/Picked up|is at place/);
  });

  it('keeps a plain tap working on the tick, the title and the conversation button', async () => {
    phoneMedia({ phone: true, coarse: true });
    const { store } = await renderApp('/work', today);
    const group = await screen.findByRole('region', { name: 'Today' });
    await waitFor(() => expect(grip(group, 'Civil Defense drawings')).toHaveAttribute('aria-roledescription'));
    const tap = (target: HTMLElement) => {
      fireEvent.touchStart(target, touch(50, 50));
      fireEvent.touchEnd(target, touch(50, 50));
      fireEvent.click(target);
    };
    // The tick starts the finish (the call runs after 0.5 s).
    const tick = within(group).getByRole('checkbox', { name: /Probe stair section/ });
    tap(tick);
    await waitFor(() => expect(within(group).getByRole('checkbox', { name: /Probe stair section/ })).toHaveAttribute('aria-checked', 'true'));
    // The conversation button opens the to-do on its Conversation.
    tap(within(group).getByRole('button', { name: /Conversation about “Civil Defense drawings”/ }));
    await waitFor(() => expect(window.location.hash).toMatch(/thread=/));
    expect(status()).not.toMatch(/Picked up|is at place/);
    // The title opens the to-do.
    tap(within(group).getByText('Civil Defense drawings'));
    await waitFor(() => expect(window.location.hash).toMatch(/task=tsk_012/));
    void store;
  });

  it('ignores a click within 250 ms of a drop, and accepts it after', async () => {
    phoneMedia({ phone: true, coarse: true });
    mockRects();
    const group = await openToday();
    const handle = grip(group, 'Probe stair section');
    handle.focus();
    fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
    await screen.findByText(/Probe stair section is at place \d of \d\./);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await act(async () => { fireEvent.keyDown(handle, { key: ' ', code: 'Space' }); });
    const title = within(group).getByText('Civil Defense drawings');
    fireEvent.click(title);
    expect(window.location.hash).not.toMatch(/task=tsk_012/);
    now.mockReturnValue(1_000_300);
    fireEvent.click(title);
    await waitFor(() => expect(window.location.hash).toMatch(/task=tsk_012/));
  });

  it('stops the context menu of a touch row only', async () => {
    phoneMedia({ phone: true, coarse: true });
    const group = await openToday();
    expect(fireEvent.contextMenu(rowBox(group, 'Civil Defense drawings'))).toBe(false);
  });

  it('lets the context menu through on a desk', async () => {
    const group = await openToday();
    expect(fireEvent.contextMenu(rowBox(group, 'Civil Defense drawings'))).toBe(true);
  });

  it('gives the hold to the project To-dos tab', async () => {
    phoneMedia({ phone: true, coarse: true });
    await renderApp(`/projects/${PROJECT}?tab=tasks`, inOneStage);
    const handle = await screen.findByRole('button', { name: 'Move Civil Defense drawings up or down' });
    await waitFor(() => expect(handle).toHaveClass('sr-only'));
  });

  it('sets no slide on the moved rows under reduced motion', async () => {
    phoneMedia({ phone: true, coarse: true });
    reduceMotion();
    mockRects();
    const group = await openToday();
    const handle = grip(group, 'Probe stair section');
    handle.focus();
    fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
    await screen.findByText(/Probe stair section is at place \d of \d\./);
    await act(async () => { fireEvent.keyDown(handle, { key: 'ArrowUp', code: 'ArrowUp' }); });
    const boxes = within(group).getAllByRole('listitem').map((item) => item.firstElementChild as HTMLElement);
    expect(boxes.some((box) => box.style.transition !== '')).toBe(false);
  });

  it('keeps the slide of the moved rows without reduced motion', async () => {
    phoneMedia({ phone: true, coarse: true });
    mockRects();
    const group = await openToday();
    const handle = grip(group, 'Probe stair section');
    handle.focus();
    fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
    await screen.findByText(/Probe stair section is at place \d of \d\./);
    await act(async () => { fireEvent.keyDown(handle, { key: 'ArrowUp', code: 'ArrowUp' }); });
    const boxes = within(group).getAllByRole('listitem').map((item) => item.firstElementChild as HTMLElement);
    expect(boxes.some((box) => box.style.transition !== '')).toBe(true);
  });
});
