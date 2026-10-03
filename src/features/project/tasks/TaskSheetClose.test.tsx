import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const TASK = '/projects/prj_001?tab=tasks&task=tsk_007';
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

/** A screen narrower than 640 px, where the task panel is a sheet from the bottom. */
function phoneWidth() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === '(max-width: 639px)', media: query, onchange: null,
    addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  }) as MediaQueryList);
}

const panelGone = () => waitFor(() => expect(screen.queryByRole('dialog', { name: /Stair details/ })).toBeNull());
/** The task saves that went to the API. The server skips a value it already has, so a count of events cannot see a second send. */
const updates = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(([name]) => name === 'tasks.update');

// Every way of closing the task panel saves what the person typed, as the X button does (audit 2026-10-03, F-15).
describe('closing the task panel keeps what the person typed (audit 2026-10-03, F-15)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('saves a typed description when Escape closes the panel', async () => {
    const { store } = await renderApp(TASK, as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByLabelText('Description'), 'Bring the drone and the tape.');
    await userEvent.keyboard('{Escape}');
    await panelGone();
    await waitFor(() => expect(store.state.tasks.tsk_007.description).toBe('Bring the drone and the tape.'));
  });

  it('saves a typed title when Escape closes the panel', async () => {
    const { store } = await renderApp(TASK, as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const title = within(sheet).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Stair and ramp details');
    await userEvent.keyboard('{Escape}');
    await panelGone();
    await waitFor(() => expect(store.state.tasks.tsk_007.title).toBe('Stair and ramp details'));
  });

  it('adds a typed checklist item when Escape closes the panel', async () => {
    const { store } = await renderApp(TASK, as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add an item' }), 'Handrail height');
    await userEvent.keyboard('{Escape}');
    await panelGone();
    await waitFor(() => expect(store.state.tasks.tsk_007.checklist).toEqual([expect.objectContaining({ text: 'Handrail height', done: false })]));
  });

  it('adds a typed checklist item when the X button closes the panel', async () => {
    const { store } = await renderApp(TASK, as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add an item' }), 'Handrail height');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await panelGone();
    await waitFor(() => expect(store.state.tasks.tsk_007.checklist).toEqual([expect.objectContaining({ text: 'Handrail height' })]));
  });

  it('saves a typed description when the link changes (Back)', async () => {
    const { store, router } = await renderApp(TASK, as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByLabelText('Description'), 'Check the north fence levels.');
    await act(() => router.navigate('/projects/prj_001?tab=tasks'));
    await panelGone();
    await waitFor(() => expect(store.state.tasks.tsk_007.description).toBe('Check the north fence levels.'));
  });

  it('saves a typed description when Escape closes the sheet on a phone', async () => {
    phoneWidth();
    const { store } = await renderApp(TASK, as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const description = within(sheet).getByLabelText('Description');
    await userEvent.click(description);
    await userEvent.type(description, 'Bring the drone.');
    await userEvent.keyboard('{Escape}');
    await panelGone();
    await waitFor(() => expect(store.state.tasks.tsk_007.description).toBe('Bring the drone.'));
  });

  it('sends a title change once when the X button closes the panel', async () => {
    // The save of the blur is still on its way when the panel closes, so only the panel's own memory stops a second send.
    const { store, api } = await renderApp(TASK, as('usr_002'), { latencyMs: 40 });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const title = within(sheet).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Stair and ramp details');
    const spy = vi.spyOn(api, 'call');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await panelGone();
    await waitFor(() => expect(store.state.tasks.tsk_007.title).toBe('Stair and ramp details'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(updates(spy)).toHaveLength(1);
  });

  it('saves nothing when nothing was typed', async () => {
    const { api } = await renderApp(TASK, as('usr_002'));
    await screen.findByRole('dialog', { name: 'Stair details' });
    const spy = vi.spyOn(api, 'call');
    await userEvent.keyboard('{Escape}');
    await panelGone();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(updates(spy)).toHaveLength(0);
  });
});

describe('the save on close never crosses to another person or a gone task (review 2026-10-03)', () => {
  it('drops what one person typed when another person becomes current (Preview as)', async () => {
    const { store, api } = await renderApp(TASK, as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add an item' }), 'Handrail height');
    await act(async () => { await api.call('session.previewAs', { userId: 'usr_001' }); });
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'Stair details' })).getByRole('textbox', { name: 'Add an item' })).toHaveValue(''));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(store.state.tasks.tsk_007.checklist).toEqual([]);
    expect(Object.values(store.state.events).some((e) => e.targetId === 'tsk_007' && e.actorId === 'usr_001')).toBe(false);
  });

  it('sends no save for a task that someone deleted while the panel was open', async () => {
    const { api } = await renderApp(TASK, as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add an item' }), 'Handrail height');
    const spy = vi.spyOn(api, 'call');
    await act(async () => { await api.call('tasks.delete', { id: 'tsk_007' }); });
    await panelGone();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(updates(spy)).toHaveLength(0);
    expect(screen.queryByText(/not found/i)).toBeNull();
  });
});
