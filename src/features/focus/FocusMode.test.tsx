import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

describe('Focus mode', () => {
  it('opens one task on a calm page from the task panel, and Exit brings the panel back', async () => {
    await renderApp('/projects/prj_001?tab=tasks&task=tsk_012', as('usr_005'));
    const panel = await screen.findByRole('dialog', { name: 'Civil Defense drawings' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Focus' }));
    const focus = await screen.findByRole('dialog', { name: 'Focus' });
    expect(within(focus).getByRole('heading', { level: 1, name: 'Civil Defense drawings' })).toBeInTheDocument();
    expect(within(focus).getByText('Corniche Office Tower')).toBeInTheDocument();
    expect(window.location.hash).toContain('focus=tsk_012');
    await waitFor(() => expect(within(focus).getByRole('button', { name: 'Done' })).toHaveFocus());
    expect(document.querySelector('.app-page')).toHaveProperty('inert', true);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Focus' })).toBeNull());
    expect(window.location.hash).toContain('task=tsk_012');
    expect(await screen.findByRole('dialog', { name: 'Civil Defense drawings' })).toBeInTheDocument();
    expect(document.querySelector('.app-page')).toHaveProperty('inert', false);
  });

  it('follows the review rule on Done, then closes', async () => {
    const { store } = await renderApp('/projects/prj_001?tab=tasks&focus=tsk_012', as('usr_005'));
    const focus = await screen.findByRole('dialog', { name: 'Focus' });
    await userEvent.click(within(focus).getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Sent to review. The leader checks it next.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_012.status).toBe('in_review');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Focus' })).toBeNull(), { timeout: 2000 });
    expect(window.location.hash).not.toContain('task=');
  });

  it('shows a person who may not change the task no Done button', async () => {
    await renderApp('/projects/prj_001?tab=tasks&focus=tsk_012', as('usr_003'));
    const focus = await screen.findByRole('dialog', { name: 'Focus' });
    expect(within(focus).queryByRole('button', { name: 'Done' })).toBeNull();
    expect(within(focus).getByRole('button', { name: 'Exit focus' })).toBeInTheDocument();
  });

  // A helper may tick the checklist, as in the task panel (spec 5.1, audit PER-6), and is told who finishes the task (PER-9).
  it('lets a helper tick the checklist and says who leads the task', async () => {
    await renderApp('/projects/prj_001?tab=tasks&focus=tsk_012', (state) => {
      state.session.currentUserId = 'usr_006';
      state.tasks.tsk_012.helperIds = ['usr_006'];
      state.tasks.tsk_012.checklist = [{ id: 'chk_900', text: 'Check the stair widths', done: false }];
    });
    const focus = await screen.findByRole('dialog', { name: 'Focus' });
    expect(within(focus).getByRole('checkbox', { name: 'Check the stair widths' })).toBeEnabled();
    expect(within(focus).queryByRole('button', { name: 'Done' })).toBeNull();
    expect(within(focus).getByText('Lead: Sara Al-Qahtani')).toBeInTheDocument();
  });

  // A task that waits shows the word and no Done; a task in review says so (audit PER-9: clear state words).
  it('shows Waiting for and no Done on a task that waits, and In review on a task in review', async () => {
    const first = await renderApp('/projects/prj_001?tab=tasks&focus=tsk_012', (state) => {
      state.session.currentUserId = 'usr_005';
      state.tasks.tsk_012.prerequisiteIds = ['tsk_013'];
      state.tasks.tsk_013.status = 'todo';
    });
    const focus = await screen.findByRole('dialog', { name: 'Focus' });
    expect(within(focus).getByText(/^Waiting for /)).toBeInTheDocument();
    expect(within(focus).queryByRole('button', { name: 'Done' })).toBeNull();
    first.unmount();
    await renderApp('/projects/prj_001?tab=tasks&focus=tsk_012', (state) => {
      state.session.currentUserId = 'usr_005';
      state.tasks.tsk_012.status = 'in_review';
    });
    expect(within(await screen.findByRole('dialog', { name: 'Focus' })).getByText('In review')).toBeInTheDocument();
  });

  it('runs a quiet 25-minute timer', async () => {
    await renderApp('/projects/prj_001?tab=tasks&focus=tsk_012', as('usr_005'));
    const timer = await screen.findByRole('region', { name: 'Focus timer' });
    expect(within(timer).getByRole('timer')).toHaveTextContent('25:00');
    await userEvent.click(within(timer).getByRole('button', { name: 'Start' }));
    expect(within(timer).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await userEvent.click(within(timer).getByRole('button', { name: 'Reset' }));
    expect(within(timer).getByRole('timer')).toHaveTextContent('25:00');
  });

  it('opens from the Next for you card', async () => {
    await renderApp('/', as('usr_005'));
    const card = await screen.findByRole('region', { name: 'Next for you' });
    await userEvent.click(within(card).getByRole('button', { name: 'Focus' }));
    expect(within(await screen.findByRole('dialog', { name: 'Focus' })).getByRole('heading', { level: 1, name: 'Facade details' })).toBeInTheDocument();
  });
});
