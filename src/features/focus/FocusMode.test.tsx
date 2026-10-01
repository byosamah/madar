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
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Focus' })).toBeNull());
    expect(window.location.hash).toContain('task=tsk_012');
    expect(await screen.findByRole('dialog', { name: 'Civil Defense drawings' })).toBeInTheDocument();
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
