import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

const tile = (name: RegExp) => screen.findByRole('link', { name });

describe('the Dashboard', () => {
  it('shows the numbers, then the Projects section with its rows', async () => {
    await renderApp('/dashboard');
    expect(await tile(/Active projects/)).toHaveTextContent('9');
    expect(await tile(/At risk or late/)).toHaveTextContent('5');
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

  // The Status choice changes only the schedule rows; the numbers count active projects whatever it says (audit 2026-10-03, V-12).
  it('keeps its filters in the link, and Status changes the schedule rows, not the numbers', async () => {
    await renderApp('/dashboard?view=schedule');
    await userEvent.click(await screen.findByRole('button', { name: 'Filter' }));
    await userEvent.selectOptions(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('combobox', { name: 'Status' }), 'on_hold');
    await waitFor(() => expect(window.location.hash).toContain('status=on_hold'));
    const schedule = screen.getByRole('region', { name: 'Office schedule' });
    await waitFor(() => expect(within(schedule).getAllByRole('link').map((link) => link.getAttribute('aria-label'))).toEqual(['Open Gulf Crest HQ Interiors', 'Open Tamr Staff Housing']));
    expect(await tile(/Active projects/)).toHaveTextContent('9');
    expect(await tile(/At risk or late/)).toHaveTextContent('5');
  });

  it('shows the Status choice only in the Schedule section, and reads a status in the link as Active elsewhere (audit 2026-10-03, V-12)', async () => {
    await renderApp('/dashboard?status=on_hold');
    expect(await tile(/Active projects/)).toHaveTextContent('9');
    expect(within(await screen.findByRole('region', { name: 'Projects per stage' })).getAllByRole('link').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(within(screen.getByRole('dialog', { name: 'Filter' })).queryByRole('combobox', { name: 'Status' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('tab', { name: 'People' }));
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(within(screen.getByRole('dialog', { name: 'Filter' })).queryByRole('combobox', { name: 'Status' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
    await userEvent.click(screen.getByRole('button', { name: 'Filter, 1 active' }));
    expect(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('combobox', { name: 'Status' })).toHaveValue('on_hold');
  });

  // Interiors is tm_003. Each number opens the Projects screen with the same team, so the list has the counted projects.
  for (const name of [/Active projects/, /At risk or late/]) {
    it(`keeps the Team filter in the list that ${name.source} opens (audit 2026-10-03, DSH-7)`, async () => {
      await renderApp('/dashboard?team=tm_003');
      const n = Number((await tile(name)).textContent?.match(/\d+/)?.[0]);
      await userEvent.click(await tile(name));
      expect(window.location.hash).toContain('team=tm_003');
      await waitFor(() => expect(within(screen.getByRole('list', { name: 'Projects' })).getAllByRole('listitem')).toHaveLength(n));
    });
  }

  it('keeps the Team filter in the chart links and the Area in design row (audit 2026-10-03, DSH-7)', async () => {
    await renderApp('/dashboard?team=tm_003');
    for (const link of within(await screen.findByRole('region', { name: 'Health mix' })).getAllByRole('link')) expect(link.getAttribute('href')).toContain('team=tm_003');
    for (const link of within(screen.getByRole('region', { name: 'Projects per stage' })).getAllByRole('link')) expect(link.getAttribute('href')).toContain('team=tm_003');
    expect((await tile(/Area in design/)).getAttribute('href')).toContain('team=tm_003');
  });

  it('offers only the statuses that change the numbers, and reads Completed or Archived in a link as Active (audit 2026-10-03, DSH-13)', async () => {
    await renderApp('/dashboard?view=schedule&status=completed');
    expect(await tile(/Active projects/)).toHaveTextContent('9');
    await userEvent.click(await screen.findByRole('button', { name: 'Filter' }));
    const status = within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('combobox', { name: 'Status' });
    expect(status).toHaveValue('active');
    expect(within(status).getAllByRole('option').map((option) => option.textContent)).toEqual(['Active', 'Paused', 'All statuses']);
  });
});
