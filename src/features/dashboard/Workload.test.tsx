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
    // The cell counts her work: her open tasks and the tasks she reviews (owner, 2026-10-06).
    await waitFor(() => expect(window.location.hash).toContain('work=usr_005'));
  });

  // Overdue first, then the weeks from today, so a past-due task counts once (owner, 2026-10-06, item 1).
  it('puts the past-due tasks of each person first, in the attention colour above 0, and opens them', async () => {
    const { api } = await renderApp('/dashboard?view=people');
    const grid = await screen.findByRole('region', { name: 'Workload' });
    const headers = within(grid).getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers.slice(0, 3)).toEqual(['Person', 'Past due', '30 Sept']);
    const d = await api.call('dashboard.get', {});
    const late = d.workload.rows.find((row) => row.overdue > 0)!;
    const calm = d.workload.rows.find((row) => row.overdue === 0 && row.counts.some((n) => n > 0))!;
    const nameOf = (id: string) => d.workload.rows.find((row) => row.user.id === id)!.user.name;
    const cell = within(grid).getByRole('link', { name: new RegExp(`^${nameOf(late.user.id)}, past due: `) });
    expect(cell).toHaveClass('text-attn');
    expect(within(grid).getByRole('link', { name: new RegExp(`^${nameOf(calm.user.id)}, past due: `) })).not.toHaveClass('text-attn');
    await userEvent.click(cell);
    await waitFor(() => expect(window.location.hash).toContain('filter=overdue'));
    expect(window.location.hash).toContain(`owner=${late.user.id}`);
    await waitFor(() => expect(within(within(screen.getByRole('main')).getByRole('list')).getAllByRole('listitem')).toHaveLength(late.overdue));
  });

  // A person with nothing in any column is noise on the tab (owner, 2026-10-06, item 7).
  it('hides a person with nothing in any column, and says how many under the table', async () => {
    const { api } = await renderApp('/dashboard?view=people');
    const grid = await screen.findByRole('region', { name: 'Workload' });
    const d = await api.call('dashboard.get', {});
    const idle = d.workload.rows.filter((row) => row.overdue === 0 && row.counts.every((n) => n === 0));
    expect(idle.length).toBe(2);
    for (const row of idle) expect(within(grid).queryByText(row.user.name)).toBeNull();
    expect(within(grid).getAllByRole('row')).toHaveLength(d.workload.rows.length - idle.length + 1);
    expect(within(grid).getByText('2 people have no tasks in these weeks')).toBeInTheDocument();
  });

  it('says how many people have no tasks with the Arabic noun forms', async () => {
    await renderApp('/dashboard?view=people', (state) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    const grid = await screen.findByRole('region', { name: 'عبء العمل' });
    expect(within(grid).getByText('شخصان ليس لديهما مهام في هذه الأسابيع')).toBeInTheDocument();
  });

  it('names one task in the singular in the cell label (audit 2026-10-03, F-10)', async () => {
    await renderApp('/dashboard?view=people');
    const grid = await screen.findByRole('region', { name: 'Workload' });
    const names = within(grid).getAllByRole('link').map((link) => link.getAttribute('aria-label') ?? '');
    expect(names.filter((name) => /: 1 tasks/.test(name))).toEqual([]);
    expect(names.some((name) => /: 1 task(,|$)/.test(name))).toBe(true);
    expect(names.some((name) => /: [02-9]\d* tasks(,|$)/.test(name))).toBe(true);
  });

  it('counts the tasks in Arabic with the right noun form (audit 2026-10-03, F-10)', async () => {
    await renderApp('/dashboard?view=people', (state) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    const grid = await screen.findByRole('region', { name: 'عبء العمل' });
    const names = within(grid).getAllByRole('link').map((link) => link.getAttribute('aria-label') ?? '');
    expect(names.some((name) => name.includes('مهمة واحدة'))).toBe(true);
    expect(names.some((name) => name.includes('لا مهام'))).toBe(true);
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
