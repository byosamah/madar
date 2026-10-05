import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

// Tasks with no lead (owner, 2026-10-05, item 2). In Corniche Office Tower (prj_001), Faisal (usr_002) leads the project and
// Sara (usr_005) is on the team. "Coordination meeting notes" (tsk_013) is an open task; the tests take its lead off.
const TASKS = '/projects/prj_001?tab=tasks';
const TASK = (task: string) => `${TASKS}&task=${task}`;
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const noLead = (...ids: string[]) => (state: State) => {
  for (const id of ids) state.tasks[id].ownerId = null;
};
const both = (...steps: ((state: State) => void)[]) => (state: State) => steps.forEach((step) => step(state));

describe('a task with no lead in the task panel', () => {
  it('gives a team member one button, Take it, and Undo gives the task back', async () => {
    const { store } = await renderApp(TASK('tsk_013'), both(as('usr_005'), noLead('tsk_013')));
    const sheet = await screen.findByRole('dialog', { name: 'Coordination meeting notes' });
    const block = within(sheet).getByRole('region', { name: 'No lead' });
    expect(within(block).getByText('Nobody leads this task yet. Take it to work on it and finish it.')).toBeInTheDocument();
    expect(within(sheet).queryByText(/You can view this task/)).toBeNull();
    await userEvent.click(within(block).getByRole('button', { name: 'Take it' }));
    expect(await screen.findByText('This task is yours now.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_013.ownerId).toBe('usr_005');
    await waitFor(() => expect(within(sheet).queryByRole('button', { name: 'Take it' })).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_013.ownerId).toBeNull());
  });

  it('puts "No lead" first in the Lead list, and takes the lead off with an Undo toast', async () => {
    const { store } = await renderApp(TASK('tsk_013'));
    const sheet = await screen.findByRole('dialog', { name: 'Coordination meeting notes' });
    const lead = within(sheet).getByLabelText('Lead') as HTMLSelectElement;
    expect(lead.options[0].textContent).toBe('No lead');
    await userEvent.selectOptions(lead, '');
    expect(await screen.findByText('This task has no lead now.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_013.ownerId).toBeNull();
    await waitFor(() => expect(lead.value).toBe(''));
    // A task with no lead cannot finish, so the Status list has no Done and no In review.
    const status = within(sheet).getByLabelText('Status') as HTMLSelectElement;
    expect([...status.options].map((option) => option.value)).toEqual(['todo', 'in_progress']);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_013.ownerId).toBe('usr_006'));
  });

  it('offers no "No lead" for a task in review, which keeps its lead', async () => {
    await renderApp(TASK('tsk_010'));
    const sheet = await screen.findByRole('dialog', { name: 'Toilet details' });
    const lead = within(sheet).getByLabelText('Lead') as HTMLSelectElement;
    expect([...lead.options].some((option) => option.value === '')).toBe(false);
  });

  it('says "No lead" as plain text to a person who cannot change the lead', async () => {
    await renderApp(TASK('tsk_013'), both(as('usr_004'), noLead('tsk_013')));
    const sheet = await screen.findByRole('dialog', { name: 'Coordination meeting notes' });
    expect(within(sheet).getByText('No lead')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Take it' })).toBeNull();
  });
});

describe('a task with no lead in the Tasks tab', () => {
  it('shows an empty dashed circle named "No lead", and its tick says it needs a lead first', async () => {
    const { store } = await renderApp(TASKS, noLead('tsk_013'));
    const group = await screen.findByRole('region', { name: 'Construction Documents' });
    const row = within(group).getByText('Coordination meeting notes').closest('li') as HTMLElement;
    expect(within(row).getByRole('img', { name: 'No lead' })).toBeInTheDocument();
    const tick = within(row).getByRole('checkbox', { name: 'Coordination meeting notes cannot be finished yet. It has no lead.' });
    expect(tick).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(tick);
    expect(await screen.findByText('Not yet. Give this task a lead first.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_013.status).toBe('todo');
  });

  it('gives the leader one gentle line with the count, and one press shows those tasks', async () => {
    await renderApp(TASKS, both(as('usr_002'), noLead('tsk_013', 'tsk_012')));
    expect(await screen.findByText(/^2 tasks have no lead\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show them' }));
    await waitFor(() => expect(screen.queryByText('Stair details')).toBeNull());
    expect(screen.getByText('Coordination meeting notes')).toBeInTheDocument();
    expect(screen.getByText('Civil Defense drawings')).toBeInTheDocument();
    expect(screen.queryByText(/tasks have no lead/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Filter, 1 active' })).toBeInTheDocument();
  });

  it('shows no count line to a team member, who finds the tasks with the "No lead" filter', async () => {
    await renderApp(TASKS, both(as('usr_005'), noLead('tsk_013')));
    await screen.findByText('Stair details');
    expect(screen.queryByText(/has no lead\./)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^Filter/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('radio', { name: 'No lead' }));
    await waitFor(() => expect(screen.queryByText('Stair details')).toBeNull());
    expect(screen.getByText('Coordination meeting notes')).toBeInTheDocument();
  });
});
