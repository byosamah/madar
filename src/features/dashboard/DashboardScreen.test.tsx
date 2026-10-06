import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
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
  // The delay is on purpose: the schedule of the new status comes after the link changes, so the test waits for it (V-12 repair).
  it('keeps its filters in the link, and Status changes the schedule rows, not the numbers', async () => {
    await renderApp('/dashboard?view=schedule', undefined, { latencyMs: 100 });
    await userEvent.click(await screen.findByRole('button', { name: 'Filter' }));
    await userEvent.selectOptions(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('combobox', { name: 'Status' }), 'on_hold');
    await waitFor(() => expect(window.location.hash).toContain('status=on_hold'));
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
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

  // The numbers count the tasks of the team's projects, so each link to the Task list carries the team too (audit 2026-10-03, V-37b).
  it('keeps the Team filter in every link that opens the Task list (audit 2026-10-03, V-37b)', async () => {
    await renderApp('/dashboard?team=tm_003');
    expect((await tile(/Past-due tasks/)).getAttribute('href')).toContain('team=tm_003');
    expect((await tile(/Deadlines, next 14 days/)).getAttribute('href')).toContain('team=tm_003');
    const week = within(screen.getByRole('region', { name: 'Tasks done and created per week' })).getAllByRole('link');
    expect(week.length).toBeGreaterThan(0);
    for (const link of week) expect(link.getAttribute('href')).toContain('team=tm_003');
    await userEvent.click(screen.getByRole('tab', { name: 'People' }));
    const cells = within(await screen.findByRole('region', { name: 'Workload' })).getAllByRole('link');
    expect(cells.length).toBeGreaterThan(0);
    for (const link of cells) expect(link.getAttribute('href')).toContain('team=tm_003');
  });

  // A person who leads no project in the status gave an empty Dashboard, so the Leader list offers only real leaders (audit 2026-10-03, F-14).
  describe('the Leader filter (audit 2026-10-03, F-14)', () => {
    const leaderOptions = async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
      const leader = within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('combobox', { name: 'Leader' });
      await waitFor(() => expect(within(leader).getAllByRole('option').length).toBeGreaterThan(1));
      return within(leader).getAllByRole('option').map((option) => option.textContent);
    };
    const leadersOf = (state: State, statuses: string[]) => [...new Set(Object.values(state.projects)
      .filter((p) => statuses.includes(p.status) && p.leaderId !== null)
      .map((p) => state.users[p.leaderId as string].name))].sort((a, b) => a.localeCompare(b));

    it('lists only the people who lead an active project', async () => {
      let seed: State | undefined;
      await renderApp('/dashboard', (state) => { seed = state; });
      const expected = leadersOf(seed as State, ['active']);
      expect(expected.length).toBeGreaterThan(1);
      expect(await leaderOptions()).toEqual(['Any leader', ...expected]);
      expect(expected).not.toContain('Noura Al-Shammari');
      expect(expected).not.toContain('Turki Al-Otaibi');
    });

    it('follows the Status of the schedule', async () => {
      let seed: State | undefined;
      await renderApp('/dashboard?view=schedule&status=on_hold', (state) => { seed = state; });
      expect(await leaderOptions()).toEqual(['Any leader', ...leadersOf(seed as State, ['on_hold'])]);
    });

    it('takes the leaders from dashboard.get, so it loads no summary of every project (cleanup 2026-10-06)', async () => {
      const names: string[] = [];
      await renderApp('/dashboard?view=schedule&status=all', undefined, { failFirst: (name) => { names.push(name); return false; } });
      await leaderOptions();
      expect(names).toContain('dashboard.get');
      expect(names).not.toContain('projects.list');
    });

    it('keeps a leader from the link in the list, so the choice stays visible', async () => {
      // Khalid (usr_008) leads no project in the sample office.
      await renderApp('/dashboard?leader=usr_008');
      const options = await leaderOptions();
      const leader = within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('combobox', { name: 'Leader' });
      expect(leader).toHaveValue('usr_008');
      expect(options).toContain('Khalid Al-Mutairi');
    });
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
