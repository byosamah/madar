import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TASKS = '/projects/prj_001?tab=tasks';
const filter = async () => {
  await userEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  return screen.getByRole('dialog', { name: 'Filter' });
};

describe('the Tasks tab list', () => {
  it('groups open tasks by stage and shows done tasks on request', async () => {
    await renderApp(TASKS);
    const group = await screen.findByRole('region', { name: 'Construction Documents' });
    expect(within(group).getByText('Stair details')).toBeInTheDocument();
    expect(within(group).queryByText('Door and window schedule')).toBeNull();
    await userEvent.click(within(await filter()).getByRole('checkbox', { name: 'Show done tasks' }));
    expect(await within(group).findByText('Door and window schedule')).toBeInTheDocument();
  });

  it('keeps the task choices in one filter button, with no chip row', async () => {
    await renderApp(TASKS);
    await screen.findByText('Stair details');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    await userEvent.click(within(await filter()).getByRole('radio', { name: 'Past due' }));
    expect(screen.getByRole('button', { name: 'Filter, 1 active' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Specifications draft')).toBeNull());
    expect(screen.getByText('Stair details')).toBeInTheDocument();
  });

  it("sends a member's tick to review, then undoes it", async () => {
    const { store } = await renderApp(TASKS, as('usr_005'));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Complete Civil Defense drawings' }));
    expect(await screen.findByText('Sent to review. The leader checks it next.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_012.status).toBe('in_review');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_012.status).toBe('todo'));
  });

  it("does not let a member tick another person's task", async () => {
    await renderApp(TASKS, as('usr_005'));
    expect(await screen.findByRole('checkbox', { name: 'Complete Balady submission set' })).toBeDisabled();
  });

  it('adds a task to a stage from its quick add row', async () => {
    const { store } = await renderApp(TASKS, as('usr_005'));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Add a task in Permits' }), 'Fire strategy report{Enter}');
    await waitFor(() => expect(Object.values(store.state.tasks)
      .some((task) => task.title === 'Fire strategy report' && task.stageId === 'stg_005' && task.ownerId === 'usr_005')).toBe(true));
    expect(await screen.findByText('Fire strategy report')).toBeInTheDocument();
  });

  it('does not count the board view as a filter', async () => {
    await renderApp(TASKS);
    await screen.findByText('Stair details');
    await userEvent.click(within(await filter()).getByRole('radio', { name: 'Board' }));
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('button', { name: 'Filter' })).toBeInTheDocument();
  });

  it('says how late a task is, gently, and shows counts only when there are some', async () => {
    await renderApp(TASKS);
    const row = (await screen.findByText('Stair details')).closest('li') as HTMLElement;
    expect(within(row).getByText(/days past due$/)).toHaveClass('text-attn');
    expect(within(row).queryByText('Overdue')).toBeNull();
    expect(within(row).queryByText(/^0 /)).toBeNull();
  });

  it('puts the open task in the link', async () => {
    await renderApp(TASKS);
    await userEvent.click(await screen.findByRole('button', { name: /^Stair details/ }));
    await waitFor(() => expect(window.location.hash).toContain('task=tsk_007'));
  });

  it('says so when every task of a stage is done', async () => {
    await renderApp(TASKS);
    expect(await within(await screen.findByRole('region', { name: 'Schematic Design' })).findByText('All tasks in this stage are done.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Concept' })).getByText('No tasks here yet.')).toBeInTheDocument();
  });
});

describe('the conversation button on a task row', () => {
  it('opens the task straight at its conversation', async () => {
    await renderApp(TASKS);
    await userEvent.click(await screen.findByRole('button', { name: /^Conversation about “Toilet details”/ }));
    await waitFor(() => expect(window.location.hash).toContain('thread=1'));
    expect(await screen.findByRole('tab', { name: /^Conversation/ })).toHaveAttribute('aria-selected', 'true');
  });
});
