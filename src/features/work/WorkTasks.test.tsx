import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

describe('My Work tasks', () => {
  it('groups my open tasks by date', async () => {
    await renderApp('/work', as('usr_005'));
    expect(within(await screen.findByRole('region', { name: 'Today' })).getByText('Toilet details')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Later' })).getByText('Civil Defense drawings')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Waiting for my review' })).toBeNull();
  });

  it('shows a leader the tasks that wait for their review first', async () => {
    await renderApp('/work', as('usr_002'));
    const review = await screen.findByRole('region', { name: 'Waiting for my review' });
    expect(within(review).getByText('Toilet details')).toBeInTheDocument();
    const regions = screen.getAllByRole('region');
    expect(regions[0]).toBe(review);
  });

  it('ticks a task from My Work', async () => {
    const { store } = await renderApp('/work', as('usr_005'));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Complete Civil Defense drawings' }));
    expect(await screen.findByText('Sent to review. The leader checks it next.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_012.status).toBe('in_review');
  });

  it('opens the task panel in place', async () => {
    await renderApp('/work', as('usr_005'));
    await userEvent.click(await screen.findByRole('button', { name: /Civil Defense drawings/ }));
    expect(await screen.findByRole('dialog', { name: 'Civil Defense drawings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'My Work', hidden: true })).toBeInTheDocument();
  });

  it('says when there is nothing open', async () => {
    await renderApp('/work', (state) => {
      state.session.currentUserId = 'usr_005';
      for (const task of Object.values(state.tasks)) task.status = 'done';
    });
    expect(await screen.findByText('You have no open tasks.')).toBeInTheDocument();
  });

  it('shows Retry when My Work cannot load', async () => {
    await renderApp('/work', as('usr_005'), { failFirst: 'tasks.list' });
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Civil Defense drawings')).toBeInTheDocument();
  });
});
