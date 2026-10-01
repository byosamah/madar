import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

describe('the workload grid', () => {
  it("opens a person's tasks for a week", async () => {
    await renderApp('/dashboard?view=people');
    const grid = await screen.findByRole('region', { name: 'Workload' });
    const [cell] = within(grid).getAllByRole('link', { name: /^Sara Al-Qahtani, week of/ });
    await userEvent.click(cell);
    await waitFor(() => expect(window.location.hash).toContain('owner=usr_005'));
  });

  it('marks a week over the limit with a word, and clears it when the limit rises', async () => {
    const low = await renderApp('/dashboard?view=people', (state) => {
      state.settings.workloadLimit = 1;
    });
    const grid = await screen.findByRole('region', { name: 'Workload' });
    expect(within(grid).getAllByText('Over').length).toBeGreaterThan(0);
    low.unmount();
    await renderApp('/dashboard?view=people', (state) => {
      state.settings.workloadLimit = 100;
    });
    const calm = await screen.findByRole('region', { name: 'Workload' });
    expect(within(calm).queryByText('Over')).toBeNull();
  });
});
