import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TASKS = '/projects/prj_001?tab=tasks';
// In the sample office "Stair details" (tsk_007, five days past due) is needed first by "Structural drawings check" (tsk_008)
// and by the dynamic "Specifications draft" (tsk_009). "Stair details" needs "Reflected ceiling plans", which is done.

describe('Needs first and Unlocks in the task panel', () => {
  it('lists what a task needs first, with its state', async () => {
    await renderApp(`${TASKS}&task=tsk_008`, as('usr_002'));
    const panel = await screen.findByRole('dialog', { name: 'Structural drawings check' });
    const needs = await within(panel).findByRole('region', { name: 'Needs first' });
    expect(within(needs).getByText('Stair details')).toBeInTheDocument();
    expect(within(needs).getByText('In progress')).toBeInTheDocument();
  });

  it('lists the tasks that wait for this one, read only', async () => {
    await renderApp(`${TASKS}&task=tsk_007`, as('usr_002'));
    const panel = await screen.findByRole('dialog', { name: 'Stair details' });
    const unlocks = await within(panel).findByRole('region', { name: 'Unlocks' });
    expect(within(unlocks).getByText('Structural drawings check')).toBeInTheDocument();
    expect(within(unlocks).getByText('Specifications draft')).toBeInTheDocument();
    expect(within(unlocks).queryByRole('button')).toBeNull();
  });

  it('lets the leader add and remove what a task needs first', async () => {
    const { store } = await renderApp(`${TASKS}&task=tsk_008`, as('usr_002'));
    const panel = await screen.findByRole('dialog', { name: 'Structural drawings check' });
    await userEvent.selectOptions(await within(panel).findByLabelText('Add a task it needs first'), 'Coordination meeting notes');
    await waitFor(() => expect(store.state.tasks.tsk_008.prerequisiteIds).toEqual(['tsk_007', 'tsk_013']));
    await userEvent.click(await within(panel).findByRole('button', { name: 'Remove Stair details from the list' }));
    await waitFor(() => expect(store.state.tasks.tsk_008.prerequisiteIds).toEqual(['tsk_013']));
  });

  it('names the rule when the leader picks a task that would wait for itself', async () => {
    const { store } = await renderApp(`${TASKS}&task=tsk_007`, as('usr_002'));
    const panel = await screen.findByRole('dialog', { name: 'Stair details' });
    // "Specifications draft" already waits for this task, so it is not offered. Make the loop through a third task, then ask for it.
    store.state.tasks.tsk_013.prerequisiteIds = ['tsk_008'];
    await userEvent.selectOptions(await within(panel).findByLabelText('Add a task it needs first'), 'Coordination meeting notes');
    expect(await screen.findByText('These would wait for each other. Pick another one.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_007.prerequisiteIds).toEqual(['tsk_006']);
  });

  it('gives a team member the lists as text, with no way to change them', async () => {
    await renderApp(`${TASKS}&task=tsk_008`, as('usr_005'));
    const panel = await screen.findByRole('dialog', { name: 'Structural drawings check' });
    const needs = await within(panel).findByRole('region', { name: 'Needs first' });
    expect(within(needs).getByText('Stair details')).toBeInTheDocument();
    expect(within(panel).queryByLabelText('Add a task it needs first')).toBeNull();
    expect(within(panel).queryByRole('button', { name: /^Remove .* from the list$/ })).toBeNull();
  });
});

describe('a task that waits', () => {
  it('shows a quiet sign in its row, and its tick is still reachable and says why it cannot finish', async () => {
    const { store } = await renderApp(TASKS, as('usr_002'));
    const row = (await screen.findByText('Structural drawings check')).closest('li') as HTMLElement;
    expect(within(row).getByText('Waiting for Stair details')).toBeInTheDocument();
    const tick = within(row).getByRole('checkbox', { name: 'Structural drawings check cannot be finished yet. Waiting for Stair details.' });
    expect(tick).toHaveAttribute('aria-disabled', 'true');
    expect(tick).not.toBeDisabled();
    tick.focus();
    expect(tick).toHaveFocus();
    await userEvent.click(tick);
    expect(await screen.findByText('Not yet. This task is waiting for Stair details.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_008.status).toBe('in_progress');
  });

  it('shows no sign on a task that waits for nothing', async () => {
    await renderApp(TASKS, as('usr_002'));
    const row = (await screen.findByText('Stair details')).closest('li') as HTMLElement;
    expect(within(row).queryByText(/^Waiting for/)).toBeNull();
    expect(within(row).getByRole('checkbox', { name: 'Complete Stair details' })).not.toHaveAttribute('aria-disabled');
  });

  it('loses the sign when what it waits for is done', async () => {
    const { api } = await renderApp(TASKS, as('usr_002'));
    const row = (await screen.findByText('Structural drawings check')).closest('li') as HTMLElement;
    expect(within(row).getByText('Waiting for Stair details')).toBeInTheDocument();
    await api.call('tasks.complete', { id: 'tsk_007' });
    await waitFor(() => expect(within(screen.getByText('Structural drawings check').closest('li') as HTMLElement).queryByText(/^Waiting for/)).toBeNull());
  });

  it('waits for a stage too, in words', async () => {
    await renderApp('/projects/prj_004?tab=tasks', as('usr_001'));
    const row = (await screen.findByText('Permit fee receipt')).closest('li') as HTMLElement;
    expect(within(row).getByText('Waiting for Construction Documents')).toBeInTheDocument();
    expect(within(row).getByRole('checkbox', { name: /cannot be finished yet\. Waiting for Construction Documents\.$/ })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('the date note of a moved task', () => {
  it('says what moved, from which day to which, and why', async () => {
    const { api } = await renderApp(`${TASKS}&task=tsk_009`, as('usr_001'));
    const panel = await screen.findByRole('dialog', { name: 'Specifications draft' });
    expect(within(panel).queryByRole('region', { name: 'Date changes' })).toBeNull();
    // "Stair details" was due on Fri 25 Sep and is finished on Wed 30 Sep: 4 working days late.
    await api.call('tasks.complete', { id: 'tsk_007' });
    const note = await within(panel).findByRole('region', { name: 'Date changes' });
    expect(within(note).getByText('Moved from Wed 7 Oct to Tue 13 Oct: Stair details finished 4 working days late')).toBeInTheDocument();
  });
});
