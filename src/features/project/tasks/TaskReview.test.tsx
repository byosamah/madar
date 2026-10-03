import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const TASKS = '/projects/prj_001?tab=tasks';
/** Sara (usr_005, a member) leads "Toilet details", which waits for the leader's review. Faisal (usr_002) leads the project. */
const saraWaits = (state: State) => {
  state.session.currentUserId = 'usr_005';
  Object.assign(state.tasks.tsk_010, { ownerId: 'usr_005', status: 'in_review', needsReview: true });
};

async function showBoard() {
  await userEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('radio', { name: 'Board' }));
  await userEvent.keyboard('{Escape}');
}

// While a task waits for the leader's review, Done does nothing for its lead. So the lead gets only the pull-back choices,
// To do and In progress, next to "In review" (audit 2026-10-03, F-19).
describe('the lead of a task in review (audit 2026-10-03, F-19)', () => {
  it('sees In review with To do and In progress in the Status menu, and no Done', async () => {
    const { store } = await renderApp(`${TASKS}&task=tsk_010`, saraWaits);
    const sheet = await screen.findByRole('dialog', { name: 'Toilet details' });
    const status = within(sheet).getByLabelText('Status');
    expect(status).toHaveDisplayValue('In review');
    expect(within(status).getAllByRole('option').map((option) => option.textContent)).toEqual(['To do', 'In progress', 'In review']);
    await userEvent.selectOptions(status, 'In progress');
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('in_progress'));
  });

  it('gets only To do and In progress in the board Move menu', async () => {
    await renderApp(TASKS, saraWaits);
    await showBoard();
    await userEvent.click(await screen.findByRole('button', { name: 'Move Toilet details' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['To do', 'In progress']);
  });

  it('still gets Done for a task in review that needs no review', async () => {
    await renderApp(`${TASKS}&task=tsk_010`, (state) => {
      saraWaits(state);
      state.tasks.tsk_010.needsReview = false;
    });
    const sheet = await screen.findByRole('dialog', { name: 'Toilet details' });
    expect(within(within(sheet).getByLabelText('Status')).getAllByRole('option').map((option) => option.textContent)).toEqual(['To do', 'In progress', 'In review', 'Done']);
  });
});
