import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';
import { without } from '../../../test/rr2work';

/**
 * The checklist items of a to-do take the order that the person picks (fbk_043). The data already keeps the list as an array, so the
 * screen sends the whole list in the new order with tasks.update, once for each drop. A person who may only tick sees no grip.
 */
const OPEN = '/projects/prj_001?tab=tasks&task=tsk_007';
const ITEMS = [
  { id: 'chk_a', text: 'MASTER BEDROOM', done: false },
  { id: 'chk_b', text: 'MS. BATHROOM', done: true },
  { id: 'chk_c', text: 'MS. DRESSING', done: false },
];
const as = (userId: string, roles = false) => (state: State) => {
  state.session.currentUserId = userId;
  state.tasks.tsk_007.checklist = structuredClone(ITEMS);
  if (roles) state.settings.roles = without('task.details');
};
const sheet = () => screen.findByRole('dialog', { name: 'Stair details' });
const texts = (panel: HTMLElement) => within(within(panel).getByRole('heading', { name: 'Checklist' }).parentElement as HTMLElement).getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'));

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the order of the checklist items', () => {
  it('gives a grip to each item of a person who edits the checklist', async () => {
    await renderApp(OPEN, as('usr_006'));
    const panel = await sheet();
    expect(await within(panel).findByRole('button', { name: 'Move MASTER BEDROOM up or down' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Move MS. DRESSING up or down' })).toBeInTheDocument();
  });

  it('shows no grip for a person without the right to edit the details', async () => {
    await renderApp(OPEN, as('usr_006', true));
    const panel = await sheet();
    await within(panel).findByRole('checkbox', { name: 'MASTER BEDROOM' });
    expect(within(panel).queryByRole('button', { name: /^Move .* up or down$/ })).toBeNull();
  });

  it('shows no grip when the list has one item', async () => {
    await renderApp(OPEN, (state) => {
      as('usr_006')(state);
      state.tasks.tsk_007.checklist = [ITEMS[0]];
    });
    const panel = await sheet();
    await within(panel).findByRole('checkbox', { name: 'MASTER BEDROOM' });
    expect(within(panel).queryByRole('button', { name: /^Move .* up or down$/ })).toBeNull();
  });

  it('moves an item down with the keyboard and saves the whole list in the new order once', async () => {
    const { store, api } = await renderApp(OPEN, as('usr_006'));
    const panel = await sheet();
    rowBoxes();
    const updates: unknown[] = [];
    const original = api.call.bind(api);
    vi.spyOn(api, 'call').mockImplementation(((name: string, input: unknown, meta?: unknown) => {
      if (name === 'tasks.update') updates.push(input);
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call);
    const grip = await within(panel).findByRole('button', { name: 'Move MASTER BEDROOM up or down' });
    grip.focus();
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
    expect(await screen.findByText('MASTER BEDROOM is at place 1 of 3.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(grip, { key: 'ArrowDown', code: 'ArrowDown' });
    });
    expect(await screen.findByText('MASTER BEDROOM is at place 2 of 3.')).toBeInTheDocument();
    expect(updates).toHaveLength(0);
    await act(async () => {
      fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
    });
    await waitFor(() => expect(texts(panel)).toEqual(['MS. BATHROOM', 'MASTER BEDROOM', 'MS. DRESSING']));
    await waitFor(() => expect(store.state.tasks.tsk_007.checklist.map((item) => item.id)).toEqual(['chk_b', 'chk_a', 'chk_c']));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ id: 'tsk_007', patch: { checklist: [{ id: 'chk_b', done: true }, { id: 'chk_a', done: false }, { id: 'chk_c', done: false }] } });
    // The ticks stay with their items.
    expect(store.state.tasks.tsk_007.checklist.find((item) => item.id === 'chk_b')?.done).toBe(true);
  });

  it('saves nothing for a drop on the same place, and keeps the item that was typed but not added', async () => {
    const { api } = await renderApp(OPEN, as('usr_006'));
    const panel = await sheet();
    rowBoxes();
    const field = await within(panel).findByRole('textbox', { name: 'Add an item' });
    fireEvent.change(field, { target: { value: 'Half typed' } });
    const updates: unknown[] = [];
    const original = api.call.bind(api);
    vi.spyOn(api, 'call').mockImplementation(((name: string, input: unknown, meta?: unknown) => {
      if (name === 'tasks.update') updates.push(input);
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call);
    const grip = await within(panel).findByRole('button', { name: 'Move MS. BATHROOM up or down' });
    grip.focus();
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
    await screen.findByText('MS. BATHROOM is at place 2 of 3.');
    await act(async () => {
      fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
    });
    expect(updates).toHaveLength(0);
    expect(field).toHaveValue('Half typed');
  });
});
