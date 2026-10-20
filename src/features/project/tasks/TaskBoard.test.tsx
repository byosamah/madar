import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TASKS = '/projects/prj_001?tab=tasks';

describe('the task board', () => {
  it('shows the four columns with their counts', async () => {
    await renderApp(TASKS);
    await userEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('radio', { name: 'Board' }));
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('region', { name: 'To do: 4' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'In progress: 2' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'In review: 1' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Done: 6' })).toBeInTheDocument();
  });

  it("moves a member's card with the Move menu and offers Undo", async () => {
    const { store } = await renderApp(TASKS, as('usr_005'));
    await userEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('radio', { name: 'Board' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', { name: 'Move Civil Defense drawings' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'In progress' }));
    await waitFor(() => expect(store.state.tasks.tsk_012.status).toBe('in_progress'));
    expect(await screen.findByText('Moved to In progress.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'In progress: 3' })).getByText('Civil Defense drawings')).toBeInTheDocument();
  });

  it("gives no move controls on another person's card", async () => {
    await renderApp(TASKS, as('usr_005'));
    await userEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('radio', { name: 'Board' }));
    await userEvent.keyboard('{Escape}');
    await screen.findByRole('region', { name: 'To do: 4' });
    expect(screen.queryByRole('button', { name: 'Move Balady submission set' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Drag Balady submission set' })).toBeNull();
  });

  it('offers the reviewer only Done and Send back on a task in review (audit 2026-10-03, V-5)', async () => {
    await renderApp(TASKS, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('radio', { name: 'Board' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', { name: 'Move Toilet details' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Done', 'Send back with a note']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Send back with a note' }));
    const panel = await screen.findByRole('region', { name: 'Review' });
    expect(within(panel).getByRole('button', { name: 'Send back' })).toBeInTheDocument();
  });

  it('gives screen readers instructions in the interface language', async () => {
    await renderApp(TASKS);
    await userEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('radio', { name: 'Board' }));
    await userEvent.keyboard('{Escape}');
    await screen.findByRole('region', { name: 'To do: 4' });
    expect(screen.getByText(/Press Space to pick up a to-do/)).toBeInTheDocument();
  });
});
