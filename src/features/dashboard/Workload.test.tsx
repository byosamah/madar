import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
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
    expect(within(grid).getByText('2 people have no to-dos in these weeks')).toBeInTheDocument();
  });

  it('says how many people have no tasks with the Arabic noun forms', async () => {
    await renderApp('/dashboard?view=people', (state) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    const grid = await screen.findByRole('region', { name: 'عبء العمل' });
    expect(within(grid).getByText('لا مهام لدى شخصين في هذه الأسابيع')).toBeInTheDocument();
  });

  it('names one task in the singular in the cell label (audit 2026-10-03, F-10)', async () => {
    await renderApp('/dashboard?view=people');
    const grid = await screen.findByRole('region', { name: 'Workload' });
    const names = within(grid).getAllByRole('link').map((link) => link.getAttribute('aria-label') ?? '');
    expect(names.filter((name) => /: 1 to-dos/.test(name))).toEqual([]);
    expect(names.some((name) => /: 1 to-do(,|$)/.test(name))).toBe(true);
    expect(names.some((name) => /: [02-9]\d* to-dos(,|$)/.test(name))).toBe(true);
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

// fbk_024: the open tasks with no lead have their own row at the top, in the same columns, so nobody counts them by hand.
describe('the No lead row of the workload grid (fbk_024)', () => {
  /** Three open tasks with no lead in an active project: one past due, one due this week and one due in week 2. */
  const unled = (state: State) => {
    const model = Object.values(state.tasks).find((task) => task.projectId === 'prj_001' && task.status === 'todo')!;
    const add = (id: string, title: string, dueDate: string) => {
      state.tasks[id] = { ...model, id, title, ownerId: null, helperIds: [], prerequisiteIds: [], dueDate };
    };
    add('tsk_901', 'Survey photos', '2026-09-28');
    add('tsk_902', 'Soil report', '2026-10-01');
    add('tsk_903', 'Site permit', '2026-10-06');
  };
  const list = () => within(screen.getByRole('main')).getByRole('list');

  it('puts a No lead row above the people, with a quiet mark in place of a face', async () => {
    await renderApp('/dashboard?view=people', unled);
    const grid = await screen.findByRole('region', { name: 'Workload' });
    const rows = within(grid).getAllByRole('row');
    expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('No lead');
    expect(within(rows[1]).getByTestId('no-lead-mark')).toBeInTheDocument();
    expect(within(rows[2]).getByRole('rowheader')).not.toHaveTextContent('No lead');
    expect(within(rows[1]).getAllByRole('link').map((link) => link.getAttribute('aria-label'))).toEqual([
      'No lead: all open to-dos',
      'No lead, past due: 1 to-do', 'No lead, week of 30 Sept: 1 to-do', 'No lead, week of 4 Oct: 1 to-do',
      'No lead, week of 11 Oct: 0 to-dos', 'No lead, week of 18 Oct: 0 to-dos',
    ]);
    expect(within(rows[1]).getByRole('link', { name: 'No lead, past due: 1 to-do' })).toHaveClass('text-attn');
  });

  it('opens the list of tasks with no lead for a week', async () => {
    await renderApp('/dashboard?view=people', unled);
    const grid = await screen.findByRole('region', { name: 'Workload' });
    await userEvent.click(within(grid).getByRole('link', { name: 'No lead, week of 30 Sept: 1 to-do' }));
    await waitFor(() => expect(window.location.hash).toContain('filter=no_lead'));
    expect(window.location.hash).toContain('from=2026-09-30');
    expect(window.location.hash).toContain('to=2026-10-03');
    expect(await screen.findByRole('heading', { level: 1, name: 'To-dos with no lead' })).toBeInTheDocument();
    await waitFor(() => expect(within(list()).getAllByRole('listitem')).toHaveLength(1));
    expect(within(list()).getByText('Soil report')).toBeInTheDocument();
  });

  it('opens the past-due tasks with no lead', async () => {
    await renderApp('/dashboard?view=people', unled);
    const grid = await screen.findByRole('region', { name: 'Workload' });
    await userEvent.click(within(grid).getByRole('link', { name: 'No lead, past due: 1 to-do' }));
    await waitFor(() => expect(window.location.hash).toContain('filter=no_lead'));
    expect(window.location.hash).toContain('to=2026-09-29');
    await waitFor(() => expect(within(list()).getAllByRole('listitem')).toHaveLength(1));
    expect(within(list()).getByText('Survey photos')).toBeInTheDocument();
    expect(await screen.findByText('Due until 29 Sept')).toBeInTheDocument();
  });

  it('opens every open task with no lead from the name, also the ones with no date', async () => {
    await renderApp('/dashboard?view=people', (state) => {
      unled(state);
      state.tasks.tsk_904 = { ...state.tasks.tsk_901, id: 'tsk_904', title: 'Client brief', dueDate: null };
    });
    const grid = await screen.findByRole('region', { name: 'Workload' });
    await userEvent.click(within(grid).getByRole('link', { name: 'No lead: all open to-dos' }));
    await waitFor(() => expect(window.location.hash).toContain('filter=no_lead'));
    await waitFor(() => expect(within(list()).getAllByRole('listitem')).toHaveLength(4));
    expect(within(list()).getByText('Client brief')).toBeInTheDocument();
  });

  it('keeps the Dashboard filters in the links of the row', async () => {
    await renderApp('/dashboard?view=people&leader=usr_002', unled);
    const grid = await screen.findByRole('region', { name: 'Workload' });
    const link = within(grid).getByRole('link', { name: 'No lead, week of 30 Sept: 1 to-do' });
    expect(link.getAttribute('href')).toContain('leader=usr_002');
  });

  it('shows no row when every open task has a lead', async () => {
    await renderApp('/dashboard?view=people');
    const grid = await screen.findByRole('region', { name: 'Workload' });
    expect(within(grid).queryByText('No lead')).toBeNull();
  });

  it('says it in Arabic', async () => {
    await renderApp('/dashboard?view=people', (state) => {
      unled(state);
      state.users.usr_001.preferences.language = 'ar';
    });
    const grid = await screen.findByRole('region', { name: 'عبء العمل' });
    expect(within(within(grid).getAllByRole('row')[1]).getByRole('rowheader')).toHaveTextContent('بلا مسؤول رئيسي');
  });
});
