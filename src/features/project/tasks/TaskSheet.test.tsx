import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TASK = (id: string) => `/projects/prj_001?tab=tasks&task=${id}`;

describe('the task sheet', () => {
  it('opens from the row', async () => {
    await renderApp('/projects/prj_001?tab=tasks');
    await userEvent.click(await screen.findByRole('button', { name: /Stair details/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(within(sheet).getByLabelText('Owner')).toHaveDisplayValue('Yousef Saleh');
  });

  it('saves a new title when the person leaves the field, and lists the change', async () => {
    const { store } = await renderApp(TASK('tsk_007'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const title = within(sheet).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Stair and ramp details');
    await userEvent.tab();
    await waitFor(() => expect(store.state.tasks.tsk_007.title).toBe('Stair and ramp details'));
    expect(await within(await screen.findByRole('dialog')).findByText('changed the title')).toBeInTheDocument();
  });

  it('lets the leader approve a task in review', async () => {
    const { store } = await renderApp(TASK('tsk_010'), as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Toilet details' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('done'));
  });

  it('asks for a note before a task goes back', async () => {
    const { store } = await renderApp(TASK('tsk_010'), as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Toilet details' });
    const send = within(sheet).getByRole('button', { name: 'Send back' });
    expect(send).toBeDisabled();
    await userEvent.type(within(sheet).getByLabelText('What needs to change?'), 'Add the vanity detail.');
    await userEvent.click(send);
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('in_progress'));
  });

  it("shows another person's task as read only", async () => {
    await renderApp(TASK('tsk_011'), as('usr_005'));
    const sheet = await screen.findByRole('dialog', { name: 'Balady submission set' });
    expect(within(sheet).getByText('You can view this task. Only its owner and the project leader can change it.')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Title')).toHaveAttribute('readonly');
    expect(within(sheet).queryByRole('button', { name: 'Delete task' })).toBeNull();
  });

  it('deletes a task, then brings it back with Undo', async () => {
    const { store } = await renderApp(TASK('tsk_013'), as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Coordination meeting notes' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete task' }));
    expect(await screen.findByText('Task deleted.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_013).toBeUndefined();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_013).toBeDefined());
  });

  it('adds and ticks a checklist item', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add an item' }), 'Handrail height{Enter}');
    await userEvent.click(await within(sheet).findByRole('checkbox', { name: 'Handrail height' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.checklist).toEqual([expect.objectContaining({ text: 'Handrail height', done: true })]));
  });
});
