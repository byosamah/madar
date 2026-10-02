import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

describe('the Task list', () => {
  it('shows overdue tasks', async () => {
    await renderApp('/tasks?filter=overdue');
    expect(await screen.findByRole('heading', { level: 1, name: 'Past-due tasks' })).toBeInTheDocument();
    expect(await screen.findByText('Stair details')).toBeInTheDocument();
  });

  it("shows a person's open tasks for a week", async () => {
    await renderApp('/tasks?owner=usr_005&from=2026-10-18&to=2026-10-24');
    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks of Sara Al-Qahtani' })).toBeInTheDocument();
    expect(await screen.findByText('Civil Defense drawings')).toBeInTheDocument();
    expect(screen.getByText('Due 18 Oct to 24 Oct')).toBeInTheDocument();
  });

  it('lists deadlines and links each one to its project schedule', async () => {
    await renderApp('/tasks?mode=deadlines&from=2026-09-30&to=2026-10-14');
    expect(await screen.findByRole('heading', { level: 1, name: 'Deadlines' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('link', { name: /Balady submission/ }));
    await waitFor(() => expect(window.location.hash).toContain('tab=schedule'));
  });

  it('ignores bad values in the link', async () => {
    await renderApp('/tasks?from=banana&filter=weird&owner=nobody');
    expect(await screen.findByRole('heading', { level: 1, name: 'Task list' })).toBeInTheDocument();
    // With no filter left, the list holds every open task, and several projects have a task with this name.
    expect((await screen.findAllByText('Stair details')).length).toBeGreaterThan(1);
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
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /^Complete / }).length).toBe(week?.created));
  });

  // Every list says what to do next, and a failed list shows only the error (audit PER-18).
  it('offers the way back when the list is empty, and shows no empty panel under an error', async () => {
    const first = await renderApp('/tasks?owner=usr_005&from=2030-01-05&to=2030-01-11');
    expect(await screen.findByText('No tasks match this list.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Dashboard' })).toHaveAttribute('href', '#/dashboard');
    first.unmount();
    await renderApp('/tasks?filter=overdue', undefined, { failFirst: 'tasks.list' });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
