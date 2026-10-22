import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';

describe('the Task list', () => {
  it('shows overdue tasks', async () => {
    await renderApp('/tasks?filter=overdue');
    expect(await screen.findByRole('heading', { level: 1, name: 'Past-due to-dos' })).toBeInTheDocument();
    expect(await screen.findByText('Stair details')).toBeInTheDocument();
  });

  it("shows a person's open tasks for a week", async () => {
    await renderApp('/tasks?owner=usr_005&from=2026-10-18&to=2026-10-24');
    expect(await screen.findByRole('heading', { level: 1, name: 'To-dos of Sara Al-Qahtani' })).toBeInTheDocument();
    expect(await screen.findByText('Civil Defense drawings')).toBeInTheDocument();
    expect(screen.getByText('Due 18 Oct to 24 Oct')).toBeInTheDocument();
  });

  // The Past due cell of the People tab opens this list for one person (owner, 2026-10-06).
  it('names the person of a past-due list', async () => {
    const { api } = await renderApp('/tasks?filter=overdue&owner=usr_005');
    expect(await screen.findByRole('heading', { level: 1, name: 'Past-due to-dos of Sara Al-Qahtani' })).toBeInTheDocument();
    const expected = await api.call('tasks.list', { filter: 'overdue', ownerId: 'usr_005', includeDone: false });
    expect(expected.length).toBeGreaterThan(0);
    await waitFor(() => expect(within(within(screen.getByRole('main')).getByRole('list')).getAllByRole('listitem')).toHaveLength(expected.length));
  });

  // A week cell of the People tab opens the work of a person: the tasks to review count in the first week (owner, 2026-10-06).
  it("shows a person's work for the first week, with the tasks the person reviews", async () => {
    const { api } = await renderApp('/tasks?work=usr_002&from=2026-09-30&to=2026-10-03');
    expect(await screen.findByRole('heading', { level: 1, name: 'To-dos of Faisal Al-Harbi' })).toBeInTheDocument();
    expect(screen.getByText(/With the to-dos to review/)).toBeInTheDocument();
    const expected = await api.call('tasks.list', { workOf: 'usr_002', dueFrom: '2026-09-30', dueTo: '2026-10-03', includeDone: false });
    expect(expected.some((row) => row.task.status === 'in_review')).toBe(true);
    await waitFor(() => expect(within(within(screen.getByRole('main')).getByRole('list')).getAllByRole('listitem')).toHaveLength(expected.length));
  });

  it('says nothing about reviews for a later week of a person', async () => {
    await renderApp('/tasks?work=usr_002&from=2026-10-11&to=2026-10-17');
    expect(await screen.findByRole('heading', { level: 1, name: 'To-dos of Faisal Al-Harbi' })).toBeInTheDocument();
    expect(screen.queryByText(/With the to-dos to review/)).toBeNull();
  });

  it('lists deadlines and links each one to its project schedule', async () => {
    await renderApp('/tasks?mode=deadlines&from=2026-09-30&to=2026-10-14');
    expect(await screen.findByRole('heading', { level: 1, name: 'Deadlines' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('link', { name: /Balady submission/ }));
    await waitFor(() => expect(window.location.hash).toContain('tab=schedule'));
  });

  it('ignores bad values in the link', async () => {
    await renderApp('/tasks?from=banana&filter=weird&owner=nobody');
    expect(await screen.findByRole('heading', { level: 1, name: 'To-do list' })).toBeInTheDocument();
    // With no filter left, the list holds every open task, and several projects have a task with this name.
    expect((await screen.findAllByText('Stair details')).length).toBeGreaterThan(1);
  });

  it('keeps the Team filter of the Dashboard and names the team (audit 2026-10-03, V-37a)', async () => {
    const { api } = await renderApp('/tasks?filter=overdue&team=tm_003');
    const { tiles } = await api.call('dashboard.get', { teamId: 'tm_003' });
    const office = await api.call('tasks.list', { filter: 'overdue', includeDone: false });
    expect(tiles.overdueTasks).toBeLessThan(office.length);
    expect(await screen.findByText('Team: Interiors')).toBeInTheDocument();
    await waitFor(() => expect(within(within(screen.getByRole('main')).getByRole('list')).getAllByRole('listitem')).toHaveLength(tiles.overdueTasks));
  });

  it('keeps the Team filter in the deadline list (audit 2026-10-03, V-37a)', async () => {
    const { api } = await renderApp('/tasks?mode=deadlines&from=2026-09-30&to=2026-10-14&team=tm_003');
    const team = await api.call('deadlines.list', { from: '2026-09-30', to: '2026-10-14', teamId: 'tm_003' });
    expect(await screen.findByText(/Team: Interiors/)).toBeInTheDocument();
    await waitFor(() => expect(within(within(screen.getByRole('main')).getByRole('list')).getAllByRole('listitem')).toHaveLength(team.length));
  });

  it('opens a task in place', async () => {
    await renderApp('/tasks?filter=overdue');
    await userEvent.click(await screen.findByRole('button', { name: /^Stair details/ }));
    expect(await screen.findByRole('dialog', { name: 'Stair details' })).toBeInTheDocument();
  });

  it('shows Retry when the list cannot load', async () => {
    await renderApp('/tasks?filter=overdue', undefined, { failFirst: 'tasks.list' });
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Stair details')).toBeInTheDocument();
  });

  it('lists as many tasks as the dashboard counts for a created week, done ones included', async () => {
    const { api } = await renderApp('/tasks?createdFrom=2026-09-20&createdTo=2026-09-26');
    const week = (await api.call('dashboard.get', {})).charts.throughput.find((w) => w.weekStart === '2026-09-20');
    expect(week?.created).toBeGreaterThan(0);
    // Count the rows, not the ticks: a done task shows a plain mark, not a tick (audit 2026-10-03, BRW-13).
    await waitFor(() => expect(within(within(screen.getByRole('main')).getByRole('list')).getAllByRole('listitem').length).toBe(week?.created));
  });

  // Every list says what to do next, and a failed list shows only the error (audit PER-18).
  it('offers the way back when the list is empty, and shows no empty panel under an error', async () => {
    const first = await renderApp('/tasks?owner=usr_005&from=2030-01-05&to=2030-01-11');
    expect(await screen.findByText('No to-dos match this list.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Dashboard' })).toHaveAttribute('href', '#/dashboard');
    first.unmount();
    await renderApp('/tasks?filter=overdue', undefined, { failFirst: 'tasks.list' });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows one back link on a phone, in the top row, and hides the one in the list', async () => {
    phoneMedia(true);
    await renderApp('/tasks?filter=overdue');
    const back = await within(screen.getByRole('main')).findAllByRole('link', { name: 'Dashboard' });
    expect(back).toHaveLength(1);
    expect(back[0]).toHaveAttribute('href', '#/dashboard');
  });
});
