import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const tile = (name: RegExp) => screen.findByRole(name.source.startsWith('Office') ? 'button' : 'link', { name });

describe('the Dashboard', () => {
  it('shows three numbers, then the Projects section with its rows', async () => {
    await renderApp('/dashboard');
    expect(await tile(/Active projects/)).toHaveTextContent('10');
    expect(await tile(/At risk or late/)).toHaveTextContent('5');
    expect(await tile(/Office hours this week/)).toBeInTheDocument();
    for (const name of [/Past-due tasks/, /Deadlines, next 14 days/, /Area in design/]) expect(await tile(name)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('region', { name: 'Workload' })).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('shows one section at a time and keeps it in the link', async () => {
    await renderApp('/dashboard');
    await userEvent.click(await screen.findByRole('tab', { name: 'People' }));
    expect(await screen.findByRole('region', { name: 'Workload' })).toBeInTheDocument();
    expect(window.location.hash).toContain('view=people');
    expect(screen.queryByRole('region', { name: 'Projects per stage' })).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
    expect(await screen.findByRole('region', { name: 'Office schedule' })).toBeInTheDocument();
  });

  it('opens the list behind a tile', async () => {
    await renderApp('/dashboard');
    await userEvent.click(await tile(/At risk or late/));
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Projects' })).getAllByRole('listitem')).toHaveLength(5));
  });

  it('keeps its filters in the link', async () => {
    await renderApp('/dashboard');
    await userEvent.click(await screen.findByRole('button', { name: 'Filter' }));
    await userEvent.selectOptions(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('combobox', { name: 'Status' }), 'on_hold');
    await waitFor(() => expect(window.location.hash).toContain('status=on_hold'));
    await waitFor(async () => expect(await tile(/Active projects/)).toHaveTextContent('0'));
  });

  it('shows hours per person to the Admin only', async () => {
    const first = await renderApp('/dashboard');
    await userEvent.click(await tile(/Office hours this week/));
    const sheet = await screen.findByRole('dialog', { name: 'Hours this week' });
    expect(within(sheet).getByText('Per person')).toBeInTheDocument();
    first.unmount();
    await renderApp('/dashboard', (state: State) => {
      state.session.currentUserId = 'usr_005';
    });
    await userEvent.click(await tile(/Office hours this week/));
    const other = await screen.findByRole('dialog', { name: 'Hours this week' });
    expect(within(other).queryByText('Per person')).toBeNull();
    expect(within(other).getByText('Per project')).toBeInTheDocument();
  });
});
