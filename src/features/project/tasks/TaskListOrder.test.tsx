import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

// The shared order inside one stage of a project (owner, 2026-10-08). usr_005 leads Civil Defense drawings (tsk_012).
const ME = 'usr_005';
const PROJECT = 'prj_001';

/** Two tasks of mine in one stage of the project: the sample task and a copy of it. */
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

const titlesIn = (region: HTMLElement) => within(region).getAllByRole('listitem').map((item) => item.querySelector('[dir="auto"]')?.textContent ?? '');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the order inside a stage of the project task list', () => {
  it('gives a grip to each task of the stage that I may move', async () => {
    await renderApp(`/projects/${PROJECT}?tab=tasks`, inOneStage);
    expect(await screen.findByRole('button', { name: 'Move Civil Defense drawings up or down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Probe stair section up or down' })).toBeInTheDocument();
  });

  it('moves a task up with the keyboard inside its stage and keeps the new order', async () => {
    const { store } = await renderApp(`/projects/${PROJECT}?tab=tasks`, inOneStage);
    const grip = await screen.findByRole('button', { name: 'Move Probe stair section up or down' });
    const region = grip.closest('section') as HTMLElement;
    // jsdom has no layout, so each row gets a box under the one before it.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const item = this.parentElement?.tagName === 'LI' ? this.parentElement : this.tagName === 'LI' ? this : null;
      const at = item?.parentElement ? [...item.parentElement.children].indexOf(item) : -1;
      const top = at >= 0 ? at * 60 : 0;
      const height = at >= 0 ? 56 : 0;
      return { left: 0, top, width: 300, height, right: 300, bottom: top + height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    const before = titlesIn(region);
    const moving = 'Probe stair section';
    const from = before.indexOf(moving);
    expect(from).toBeGreaterThan(0);
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
    await waitFor(() => expect(titlesIn(region)).toEqual(expected));
    expect(store.state.tasks.tsk_901.stageId).toBe(store.state.tasks.tsk_012.stageId);
    expect(typeof store.state.tasks.tsk_901.rank).toBe('number');
  });
});
