import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Task } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

/**
 * Office tasks on the screens (owner, 2026-10-06). In the sample office usr_004 is Omar Haddad, usr_005 Sara Al-Qahtani and
 * usr_006 Yousef Saleh. An office task shows the word "Office" where a project shows.
 */
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

/** An office task that Omar made and Sara leads, past due. */
function withOfficeTask(state: State, o: Partial<Task> = {}): void {
  state.tasks.tsk_900 = {
    id: 'tsk_900', projectId: null, stageId: null, title: 'Renew the trade licence', description: '', ownerId: 'usr_005', status: 'todo',
    dueDate: '2026-09-28', flagged: false, needsReview: true, checklist: [], createdBy: 'usr_004', createdAt: '2026-09-29T09:00:00.000+03:00',
    completedAt: null, ...o,
  };
  state.counters.tsk = Math.max(state.counters.tsk ?? 0, 900);
}

describe('office tasks on the Tasks page', () => {
  it('adds an office task with me as its lead, and lists it with the word Office', async () => {
    const { store } = await renderApp('/work', as('usr_005'));
    await userEvent.click(await screen.findByRole('button', { name: 'New office task' }));
    const sheet = await screen.findByRole('dialog', { name: 'New office task' });
    expect(within(sheet).getByRole('combobox', { name: 'Lead' })).toHaveValue('usr_005');
    expect(within(sheet).getByText('Only you, its lead, its helpers and the Admin see this task.')).toBeInTheDocument();
    // One main button, and it waits for a title.
    const add = within(sheet).getByRole('button', { name: 'Add task' });
    expect(add).toBeDisabled();
    await userEvent.type(within(sheet).getByRole('textbox', { name: /Title/ }), 'Renew the trade licence');
    await userEvent.click(add);
    await waitFor(() => expect(Object.values(store.state.tasks).some((task) => task.title === 'Renew the trade licence')).toBe(true));
    const made = Object.values(store.state.tasks).find((task) => task.title === 'Renew the trade licence')!;
    expect(made).toMatchObject({ projectId: null, stageId: null, ownerId: 'usr_005', createdBy: 'usr_005', needsReview: false });
    const row = (await screen.findByText('Renew the trade licence')).closest('li')!;
    expect(within(row).getByText('Office')).toBeInTheDocument();
  });

  it('gives the task to another person, who gets it', async () => {
    const { store } = await renderApp('/work', as('usr_005'));
    await userEvent.click(await screen.findByRole('button', { name: 'New office task' }));
    const sheet = await screen.findByRole('dialog', { name: 'New office task' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: /Title/ }), 'Book the meeting room');
    await userEvent.selectOptions(within(sheet).getByRole('combobox', { name: 'Lead' }), 'usr_006');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add task' }));
    expect(await screen.findByText('Task created.')).toBeInTheDocument();
    const made = Object.values(store.state.tasks).find((task) => task.title === 'Book the meeting room')!;
    expect(made).toMatchObject({ projectId: null, ownerId: 'usr_006', createdBy: 'usr_005', needsReview: true });
    expect(Object.values(store.state.notifications).some((n) => n.userId === 'usr_006' && n.targetId === made.id)).toBe(true);
  });

  it('opens an office task in the panel: no stage, no prerequisites, and a note on who sees it', async () => {
    await renderApp('/work?task=tsk_900', (state) => {
      as('usr_005')(state);
      withOfficeTask(state);
    });
    const sheet = await screen.findByRole('dialog', { name: 'Renew the trade licence' }, { timeout: 10_000 });
    expect(within(sheet).getByText('Office task. Only its people and the Admin see it.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('combobox', { name: 'Stage' })).toBeNull();
    expect(within(sheet).queryByText('Needs first')).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Save as template' })).toBeNull();
  });

  it('gives the maker the hints of an office task: no team to join, and the maker reviews', async () => {
    await renderApp('/work?task=tsk_900', (state) => {
      as('usr_004')(state);
      withOfficeTask(state);
    });
    const sheet = await screen.findByRole('dialog', { name: 'Renew the trade licence' }, { timeout: 10_000 });
    expect(within(sheet).getByText('Helpers tick checklist items and comment. Only the lead finishes the task.')).toBeInTheDocument();
    expect(within(sheet).queryByText(/joins it/)).toBeNull();
    expect(within(sheet).getByText('The person who made the task checks it before it is done.')).toBeInTheDocument();
  });

  it('shows no review switch when the maker leads the task', async () => {
    await renderApp('/work?task=tsk_900', (state) => {
      as('usr_004')(state);
      withOfficeTask(state, { ownerId: 'usr_004', needsReview: false });
    });
    const sheet = await screen.findByRole('dialog', { name: 'Renew the trade licence' }, { timeout: 10_000 });
    await within(sheet).findByText('Helpers tick checklist items and comment. Only the lead finishes the task.');
    expect(within(sheet).queryByRole('switch', { name: /review/i })).toBeNull();
  });

  it('never shows an office task to a person who is not on it', async () => {
    await renderApp('/work', (state) => {
      as('usr_006')(state);
      withOfficeTask(state);
    });
    await screen.findByRole('heading', { level: 1, name: 'Tasks' });
    await waitFor(() => expect(screen.queryByText('Renew the trade licence')).toBeNull());
  });

  it('shows the word Office in the Task list', async () => {
    await renderApp('/tasks?filter=overdue', (state) => {
      as('usr_005')(state);
      withOfficeTask(state);
    });
    const row = (await screen.findByText('Renew the trade licence', {}, { timeout: 10_000 })).closest('li')!;
    expect(within(row).getByText('Office')).toBeInTheDocument();
  });

  it('shows the word Office in Search, and opens the task on the Tasks page', async () => {
    const { router } = await renderApp('/search?q=licence', (state) => {
      as('usr_005')(state);
      withOfficeTask(state);
    });
    const item = await screen.findByRole('option', { name: /Renew the trade licence/ }, { timeout: 10_000 });
    expect(within(item).getByText('Office')).toBeInTheDocument();
    await userEvent.click(item);
    await waitFor(() => expect(router.state.location.pathname).toBe('/work'));
    expect(router.state.location.search).toContain('task=tsk_900');
  });

  it('shows the word Office in the review waits of the Dashboard', async () => {
    await renderApp('/dashboard?view=people', (state) => {
      as('usr_004')(state);
      withOfficeTask(state, { status: 'in_review' });
    });
    const waits = await screen.findByRole('list', { name: /Omar Haddad/ }, { timeout: 10_000 });
    const link = within(waits).getByRole('link', { name: /Renew the trade licence/ });
    expect(within(link).getByText(/Office/)).toBeInTheDocument();
    expect(link).toHaveAttribute('href', expect.stringContaining('/work?task=tsk_900'));
  });
});
