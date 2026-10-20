import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

// Render counters for the performance test (audit 2026-10-07, RND-4). The wrappers call the real helpers, so every other test of
// this file sees the same panel. historyText runs once for each history line that renders; ageOf once in each render of an Age.
const renders = vi.hoisted(() => ({ lines: [] as string[], ages: [] as string[] }));
vi.mock('./history', async (importOriginal) => {
  const real = await importOriginal<typeof import('./history')>();
  return { ...real, historyText: (...args: Parameters<typeof real.historyText>) => { renders.lines.push(args[0].id); return real.historyText(...args); } };
});
vi.mock('../../../lib/age', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/age')>();
  return { ...real, ageOf: (stamp: string, at: Date) => { renders.ages.push(stamp); return real.ageOf(stamp, at); } };
});

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TASK = (id: string) => `/projects/prj_001?tab=tasks&task=${id}`;

describe('the task sheet', () => {
  it('opens from the row', async () => {
    await renderApp('/projects/prj_001?tab=tasks');
    await userEvent.click(await screen.findByRole('button', { name: /^Stair details/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(within(sheet).getByLabelText('Lead')).toHaveDisplayValue('Yousef Saleh');
  });

  it('saves a new title when the person leaves the field, and lists the change', async () => {
    const { store } = await renderApp(TASK('tsk_007'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const title = within(sheet).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Stair and ramp details');
    await userEvent.tab();
    await waitFor(() => expect(store.state.tasks.tsk_007.title).toBe('Stair and ramp details'));
    expect(await within(await screen.findByRole('dialog')).findByText('changed the title')).toBeInTheDocument();
  });

  it('lets the leader approve a task in review', async () => {
    const { store } = await renderApp(TASK('tsk_010'), as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Toilet details' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('done'));
  });

  it('asks for a note before a task goes back', async () => {
    const { store } = await renderApp(TASK('tsk_010'), as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Toilet details' });
    const send = within(sheet).getByRole('button', { name: 'Send back' });
    expect(send).toBeDisabled();
    await userEvent.type(within(sheet).getByLabelText('What needs to change?'), 'Add the vanity detail.');
    await userEvent.click(send);
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('in_progress'));
  });

  it("shows another person's task as read only", async () => {
    await renderApp(TASK('tsk_011'), as('usr_005'));
    const sheet = await screen.findByRole('dialog', { name: 'Balady submission set' });
    expect(within(sheet).getByText('You can view this to-do. Only its lead and the project leader can change it.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(within(sheet).queryAllByRole('combobox')).toHaveLength(0);
    expect(within(sheet).getByText('Lead').parentElement).toHaveTextContent('Faisal Al-Harbi');
    expect(within(sheet).queryByRole('button', { name: 'Delete to-do' })).toBeNull();
  });

  it('deletes a task, then brings it back with Undo', async () => {
    const { store } = await renderApp(TASK('tsk_013'), as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Coordination meeting notes' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete to-do' }));
    expect(await screen.findByText('To-do deleted.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_013).toBeUndefined();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_013).toBeDefined());
  });

  it('adds and ticks a checklist item', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add an item' }), 'Handrail height{Enter}');
    await userEvent.click(await within(sheet).findByRole('checkbox', { name: 'Handrail height' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.checklist).toEqual([expect.objectContaining({ text: 'Handrail height', done: true })]));
  });

  it('keeps two quick checklist ticks', async () => {
    const { store } = await renderApp(TASK('tsk_007'), (state) => {
      state.session.currentUserId = 'usr_006';
      state.tasks.tsk_007.checklist = [{ id: 'chk_a', text: 'Handrail height', done: false }, { id: 'chk_b', text: 'Tread depth', done: false }];
    }, { latencyMs: 60 });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Handrail height' }));
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Tread depth' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.checklist.map((item) => item.done)).toEqual([true, true]), { timeout: 3000 });
  });

  it('saves the due date once, when the person leaves the field', async () => {
    const { store } = await renderApp(TASK('tsk_007'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const due = within(sheet).getByLabelText('Due date');
    fireEvent.change(due, { target: { value: '0002-10-05' } });
    fireEvent.change(due, { target: { value: '2026-10-05' } });
    expect(store.state.tasks.tsk_007.dueDate).toBe('2026-09-25');
    fireEvent.blur(due);
    const ask = await screen.findByRole('dialog', { name: 'Why do the dates change?' });
    await userEvent.type(within(ask).getByRole('textbox', { name: 'Reason' }), 'The structure drawings came late');
    await userEvent.click(within(ask).getByRole('button', { name: 'Save dates' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.dueDate).toBe('2026-10-05'));
    expect(Object.values(store.state.events).filter((e) => e.targetId === 'tsk_007' && e.verb === 'task.updated')).toHaveLength(1);
  });

  it('types in the description with no new render of the history, and each history age still reads the clock on each key (performance audit RND-4)', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `evt_${9100 + i}`);
    const { store } = await renderApp(TASK('tsk_007'), (state) => {
      ids.forEach((id, i) => {
        state.events[id] = {
          id, seq: 90_000 + i, projectId: 'prj_001', actorId: 'usr_002', actorKind: 'human', actingForId: 'usr_002', correlationId: `cor_h${i}`,
          verb: 'task.status_changed', targetType: 'task', targetId: 'tsk_007', before: { status: 'todo' }, after: { status: 'in_progress' },
          createdAt: `2026-09-2${i % 9}T09:0${i}:00.000+03:00`, undoneBy: null,
        };
      });
    });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' }, { timeout: 10_000 });
    await waitFor(() => expect(renders.lines.filter((id) => ids.includes(id)).length).toBeGreaterThanOrEqual(ids.length), { timeout: 5000 });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    const lines = () => renders.lines.filter((id) => ids.includes(id)).length;
    const stamps = ids.map((id) => store.state.events[id].createdAt);
    const ages = () => renders.ages.filter((stamp) => stamps.includes(stamp)).length;
    const before = { lines: lines(), ages: ages() };
    const description = within(sheet).getByLabelText('Description');
    await userEvent.type(description, 'abcde');
    expect(lines()).toBe(before.lines);
    expect(ages()).toBeGreaterThanOrEqual(before.ages + 5 * ids.length);
    await userEvent.tab();
    await waitFor(() => expect(store.state.tasks.tsk_007.description).toContain('abcde'));
    expect(await within(await screen.findByRole('dialog')).findByText('changed the description')).toBeInTheDocument();
  }, 30_000);
});
