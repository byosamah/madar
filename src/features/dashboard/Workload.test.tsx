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
