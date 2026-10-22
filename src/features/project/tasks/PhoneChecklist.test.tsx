import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderPanel, setupTask } from '../../../test/renderPanel';
import { PhoneDetails } from './PhoneDetails';
import type { TaskPanel } from './useTaskPanel';

const ITEMS = [
  { id: 'chk_a', text: 'MASTER BEDROOM', done: false },
  { id: 'chk_b', text: 'MS. BATHROOM', done: true },
  { id: 'chk_c', text: 'MS. DRESSING', done: false },
];
const details = (panel: TaskPanel) => <PhoneDetails panel={panel} />;
const withItems = (userId: string, items = ITEMS) => (state: State) => {
  setupTask('tsk_007', userId)(state);
  state.tasks.tsk_007.checklist = structuredClone(items);
};
const open = (userId = 'usr_006', items = ITEMS, render = details) => renderPanel('tsk_007', { phone: true, prepare: withItems(userId, items), render });
const group = (title = 'Checklist · 1 of 3') => screen.findByRole('region', { name: title });
/** The calls of tasks.update that go to the API. */
function watchUpdates(api: { call: (...args: never[]) => unknown }) {
  const updates: unknown[] = [];
  const original = (api.call as (n: string, i: unknown, m?: unknown) => unknown).bind(api);
  vi.spyOn(api as { call: unknown } as { call: (n: string, i: unknown, m?: unknown) => unknown }, 'call').mockImplementation((name, input, meta) => {
    if (name === 'tasks.update') updates.push(input);
    return original(name, input, meta);
  });
  return updates;
}
// jsdom has no layout, so each row gets a box under the one before it.
function rowBoxes() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const item = this.parentElement?.tagName === 'LI' ? this.parentElement : this.tagName === 'LI' ? this : null;
    const at = item?.parentElement ? [...item.parentElement.children].indexOf(item) : -1;
    const top = at >= 0 ? at * 60 : 0;
    const height = at >= 0 ? 56 : 0;
    return { left: 0, top, width: 300, height, right: 300, bottom: top + height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

afterEach(() => vi.restoreAllMocks());

describe('PhoneDetails, the Checklist group', () => {
  it('titles the group Checklist · n of m', async () => {
    await open();
    expect(await group()).toBeInTheDocument();
  });

  it('ticks an item with a tap on the text, once', async () => {
    const { store, api } = await open();
    const box = await group();
    const updates = watchUpdates(api);
    await userEvent.click(within(box).getByText('MASTER BEDROOM'));
    await waitFor(() => expect(store.state.tasks.tsk_007.checklist.find((item) => item.id === 'chk_a')?.done).toBe(true));
    expect(updates).toHaveLength(1);
    expect(within(box).getByRole('checkbox', { name: 'MASTER BEDROOM' }).closest('label')).toHaveTextContent('MASTER BEDROOM');
  });

  it('does not tick when the grip is tapped', async () => {
    const { store, api } = await open();
    const box = await group();
    const updates = watchUpdates(api);
    await userEvent.click(await within(box).findByRole('button', { name: 'Move MASTER BEDROOM up or down' }));
    expect(updates).toHaveLength(0);
    expect(store.state.tasks.tsk_007.checklist.find((item) => item.id === 'chk_a')?.done).toBe(false);
  });

  it('shows boxes that stay off for an editor without the tick right, and icons for a reader', async () => {
    const view = await open('usr_006', ITEMS, (panel) => <PhoneDetails panel={{ ...panel, viewerCan: { ...panel.viewerCan, contribute: false } }} />);
    const box = await group();
    expect(within(box).getByRole('checkbox', { name: 'MASTER BEDROOM' })).toBeDisabled();
    view.unmount();
    await open('usr_005');
    const reader = await group();
    expect(within(reader).queryByRole('checkbox')).toBeNull();
    expect(within(reader).getByText('MASTER BEDROOM')).toBeInTheDocument();
  });

  it('removes an item with a 44 px X, and adds an item in the last row with Enter', async () => {
    const { store } = await open();
    const box = await group();
    const remove = within(box).getByRole('button', { name: 'Remove MS. DRESSING' });
    expect(remove).toHaveClass('size-11');
    await userEvent.click(remove);
    await waitFor(() => expect(store.state.tasks.tsk_007.checklist.map((item) => item.id)).toEqual(['chk_a', 'chk_b']));
    await userEvent.type(await within(await group('Checklist · 1 of 2')).findByRole('textbox', { name: 'Add an item' }), 'Handrail height{Enter}');
    await waitFor(() => expect(store.state.tasks.tsk_007.checklist.map((item) => item.text)).toEqual(['MASTER BEDROOM', 'MS. BATHROOM', 'Handrail height']));
  });

  it('keeps the grip with the keyboard order change and marks it data-vaul-no-drag', async () => {
    const { store, api } = await open();
    const box = await group();
    rowBoxes();
    const updates = watchUpdates(api);
    const grip = await within(box).findByRole('button', { name: 'Move MASTER BEDROOM up or down' });
    expect(grip).toHaveAttribute('data-vaul-no-drag');
    expect(grip).toHaveClass('w-11');
    grip.focus();
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
    expect(await screen.findByText('MASTER BEDROOM is at place 1 of 3.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(grip, { key: 'ArrowDown', code: 'ArrowDown' });
    });
    await act(async () => {
      fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
    });
    await waitFor(() => expect(store.state.tasks.tsk_007.checklist.map((item) => item.id)).toEqual(['chk_b', 'chk_a', 'chk_c']));
    expect(updates).toHaveLength(1);
  });

  it('saves a typed new item when the panel closes', async () => {
    const { store, unmount } = await open();
    const box = await group();
    await userEvent.type(within(box).getByRole('textbox', { name: 'Add an item' }), 'Handrail height');
    unmount();
    await waitFor(() => expect(store.state.tasks.tsk_007.checklist.map((item) => item.text)).toContain('Handrail height'));
  });

  it('keeps 40 long items in one list with no horizontal overflow classes', async () => {
    const many = Array.from({ length: 40 }, (_, n) => ({ id: `chk_${n}`, text: `Item ${n} ${'very long words '.repeat(8)}`, done: false }));
    await open('usr_006', many);
    const box = await group('Checklist · 0 of 40');
    const lists = box.querySelectorAll('ul');
    expect(lists).toHaveLength(1);
    expect(lists[0].children).toHaveLength(40);
    expect(box.outerHTML).not.toMatch(/overflow-x|whitespace-nowrap/);
    expect(lists[0].querySelector('label')).toHaveClass('min-w-0');
  });
});
