import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';
import { projectKey } from '../../lib/projectCode';

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

describe('Waiting for review (owner, 2026-10-06, item 9)', () => {
  it('sits above the workload and lists each reviewer with the tasks that wait, the longest wait first', async () => {
    const { api } = await renderApp('/dashboard?view=people');
    const { inReview } = await api.call('dashboard.get', {});
    expect(inReview.length).toBeGreaterThan(1);
    const region = await card(/^Waiting for review/);
    const workload = screen.getByRole('region', { name: 'Workload' });
    expect(region.compareDocumentPosition(workload) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const groups = within(region).getAllByRole('list', { name: /^Waiting for the review of / });
    expect(groups).toHaveLength(inReview.length);
    const links = within(region).getAllByRole('link');
    expect(links).toHaveLength(inReview.reduce((sum, row) => sum + row.count, 0));
    const first = inReview[0].tasks[0];
    expect(links[0]).toHaveAttribute('href', `#/projects/${first.projectId}?tab=tasks&task=${first.id}`);
    expect(links[0]).toHaveTextContent(first.title);
    expect(links[0]).toHaveTextContent(projectKey(first.projectCode));
    expect(links[0]).toHaveTextContent(first.days === 1 ? '1 day in review' : first.days === 0 ? 'In review since today' : `${first.days} days in review`);
    await userEvent.click(links[0]);
    await waitFor(() => expect(window.location.hash).toContain(`task=${first.id}`));
  });

  it('shows no card when no task waits for review', async () => {
    await renderApp('/dashboard?view=people', (state) => {
      for (const task of Object.values(state.tasks)) if (task.status === 'in_review') task.status = 'in_progress';
    });
    await screen.findByRole('region', { name: 'Workload' });
    expect(screen.queryByRole('region', { name: /^Waiting for review/ })).toBeNull();
  });
});

/** Hala is the Admin of the sample office. Sara (usr_005) is a Member. */
const withGaps = (state: State) => {
  state.projects.prj_001.areaM2 = null;
  const open = Object.values(state.tasks).filter((task) => task.projectId === 'prj_002' && task.status !== 'done');
  open[0].dueDate = null;
  open[1].dueDate = null;
};
const listRows = () => within(within(screen.getByRole('main')).getByRole('list')).getAllByRole('listitem');

describe('Data gaps, for the Admin only (owner, 2026-10-06, item 10)', () => {
  it('shows the gaps above 0, each opening its list', async () => {
    const { api } = await renderApp('/dashboard', withGaps);
    const { gaps } = await api.call('dashboard.get', {});
    expect(gaps).toMatchObject({ noDueDate: 2, noArea: 1 });
    const region = await card(/^Data gaps/);
    const links = within(region).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      ...(gaps!.noDueDate > 0 ? [`Open tasks with no due date${gaps!.noDueDate}`] : []),
      ...(gaps!.noLead > 0 ? [`Open tasks with no lead${gaps!.noLead}`] : []),
      ...(gaps!.stagesNoEnd > 0 ? [`Stages with no end date${gaps!.stagesNoEnd}`] : []),
      `Active projects with no area${gaps!.noArea}`,
    ]);
    await userEvent.click(within(region).getByRole('link', { name: /Open tasks with no due date/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks with no due date' })).toBeInTheDocument();
    await waitFor(() => expect(listRows()).toHaveLength(2));
  });

  it('opens the projects with no area, and offers the way back to all projects', async () => {
    await renderApp('/dashboard', withGaps);
    await userEvent.click(within(await card(/^Data gaps/)).getByRole('link', { name: /Active projects with no area/ }));
    expect(await screen.findByText('Projects with no area')).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Projects' })).getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Filter, 1 active' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all projects' }));
    await waitFor(() => expect(window.location.hash).not.toContain('filter='));
  });

  it('opens the tasks with no lead', async () => {
    const { api } = await renderApp('/tasks?filter=no_lead', (state) => {
      Object.values(state.tasks).find((task) => task.projectId === 'prj_003' && task.status === 'todo')!.ownerId = null;
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks with no lead' })).toBeInTheDocument();
    const expected = await api.call('tasks.list', { filter: 'no_lead', includeDone: false });
    expect(expected.length).toBeGreaterThan(0);
    await waitFor(() => expect(listRows()).toHaveLength(expected.length));
  });

  it('shows no card with no gap, and none to a Member', async () => {
    const first = await renderApp('/dashboard');
    await card('Projects per stage');
    expect(screen.queryByRole('region', { name: /^Data gaps/ })).toBeNull();
    first.unmount();
    await renderApp('/dashboard', (state) => {
      withGaps(state);
      state.session.currentUserId = 'usr_005';
    });
    await card('Projects per stage');
    expect(screen.queryByRole('region', { name: /^Data gaps/ })).toBeNull();
  });
});

describe('Payments to receive, for the people who handle payments (owner, 2026-10-06, item 11)', () => {
  it('shows the payments past due and due in 30 days, each opening its payment', async () => {
    const { api } = await renderApp('/dashboard');
    const { money } = await api.call('dashboard.get', {});
    expect(money!.pastDue.count).toBeGreaterThan(0);
    expect(money!.next30.count).toBeGreaterThan(0);
    const region = await card(/^Payments to receive/);
    const past = within(region).getByRole('list', { name: /^Past due/ });
    const soon = within(region).getByRole('list', { name: /^Due in the next 30 days/ });
    expect(within(past).getAllByRole('link')).toHaveLength(money!.pastDue.count);
    expect(within(soon).getAllByRole('link')).toHaveLength(money!.next30.count);
    expect(region).toHaveTextContent(`SAR ${money!.pastDue.total.toLocaleString('en-US')}`);
    const first = money!.pastDue.payments[0];
    const link = within(past).getAllByRole('link')[0];
    expect(link).toHaveAttribute('href', `#/projects/${first.projectId}?payment=${first.id}`);
    expect(link).toHaveTextContent(first.name);
    expect(link).toHaveTextContent(`SAR ${first.amount.toLocaleString('en-US')}`);
    await userEvent.click(link);
    expect(await screen.findByRole('dialog', { name: 'Edit payment' }, { timeout: 10_000 })).toBeInTheDocument();
  });

  it('shows the panel to Accounting too, and never to a Member', async () => {
    let accounting = '';
    const first = await renderApp('/dashboard', (state) => {
      accounting = Object.values(state.users).find((user) => user.systemRole === 'accounting')!.id;
      state.session.currentUserId = accounting;
    });
    expect(accounting).not.toBe('');
    expect(await card(/^Payments to receive/)).toBeInTheDocument();
    first.unmount();
    await renderApp('/dashboard', (state) => {
      state.session.currentUserId = 'usr_005';
    });
    await card('Projects per stage');
    expect(screen.queryByRole('region', { name: /^Payments to receive/ })).toBeNull();
  });
});

