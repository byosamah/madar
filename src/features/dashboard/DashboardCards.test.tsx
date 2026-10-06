import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

const card = (name: string | RegExp) => screen.findByRole('region', { name });

/** The cards that the Dashboard batch added (owner, 2026-10-06). Each shows only when it has something to say. */
describe('Waiting for our reply (owner, 2026-10-06, item 8)', () => {
  it('lists each project with the client items that wait for the office, and opens its Tracker', async () => {
    const { api } = await renderApp('/dashboard');
    const { waitingForUs } = await api.call('dashboard.get', {});
    expect(waitingForUs.length).toBeGreaterThan(0);
    const region = await card(/^Waiting for our reply/);
    const links = within(region).getAllByRole('link');
    expect(links).toHaveLength(waitingForUs.length);
    expect(links[0]).toHaveAttribute('href', `#/projects/${waitingForUs[0].project.id}?tab=tracker`);
    expect(links[0]).toHaveTextContent(waitingForUs[0].project.name);
    expect(links[0]).toHaveTextContent(waitingForUs[0].count === 1 ? '1 item waits for our reply' : `${waitingForUs[0].count} items wait for our reply`);
    await userEvent.click(links[0]);
    await waitFor(() => expect(window.location.hash).toContain('tab=tracker'));
  });

  it('shows no card when nothing waits for the office', async () => {
    await renderApp('/dashboard', (state) => {
      for (const entry of Object.values(state.tracker ?? {})) if (entry.waiting === 'us') entry.waiting = null;
    });
    await card('Projects per stage');
    expect(screen.queryByRole('region', { name: /^Waiting for our reply/ })).toBeNull();
  });

  it('uses the Arabic noun forms', async () => {
    await renderApp('/dashboard', (state) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    const region = await card(/^بانتظار ردنا/);
    expect(within(region).getAllByText(/بانتظار ردنا/).length).toBeGreaterThan(1);
  });
});
