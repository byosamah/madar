import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/** A failFirst rule that fails the first matching call after "arm", and records that it did. */
function trap(name: string) {
  const state = { armed: false, hit: false };
  const match = (call: string) => {
    if (!state.armed || state.hit || call !== name) return false;
    state.hit = true;
    return true;
  };
  return { state, match };
}

describe('a failed refresh keeps the screen (audit 2026-10-03, PRJ-1)', () => {
  it('keeps the task panel open with its typed text when tasks.get fails on a refresh', async () => {
    const fail = trap('tasks.get');
    const { api } = await renderApp('/projects/prj_001?tab=tasks&task=tsk_007', as('usr_002'), { failFirst: fail.match });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByLabelText('Description'), ' DRAFT TEXT');
    fail.state.armed = true;
    await api.call('tasks.update', { id: 'tsk_013', patch: { flagged: true } });
    await waitFor(() => expect(fail.state.hit).toBe(true));
    await settle();
    const still = screen.getByRole('dialog', { name: 'Stair details' });
    expect((within(still).getByLabelText('Description') as HTMLTextAreaElement).value).toContain('DRAFT TEXT');
  });

  it('closes the task panel when the task is gone', async () => {
    const { api } = await renderApp('/projects/prj_001?tab=tasks&task=tsk_007', as('usr_002'));
    await screen.findByRole('dialog', { name: 'Stair details' });
    await api.call('tasks.delete', { id: 'tsk_007' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stair details' })).toBeNull());
  });

  it('keeps the project when projects.get fails on a refresh', async () => {
    const fail = trap('projects.get');
    const { api } = await renderApp('/projects/prj_001?tab=tasks&task=tsk_007', as('usr_002'), { failFirst: fail.match });
    await screen.findByRole('dialog', { name: 'Stair details' });
    fail.state.armed = true;
    await api.call('tasks.update', { id: 'tsk_013', patch: { flagged: true } });
    await waitFor(() => expect(fail.state.hit).toBe(true));
    await settle();
    expect(screen.getByRole('dialog', { name: 'Stair details' })).toBeInTheDocument();
    expect(screen.queryByText('Project not found')).toBeNull();
  });

  it('says the project did not load, not that it is gone, when the first load fails', async () => {
    await renderApp('/projects/prj_001', as('usr_002'), { failFirst: 'projects.get' });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('Project not found')).toBeNull();
    expect(screen.getAllByText('The data did not load.').length).toBeGreaterThan(0);
  });

  it('still says "Project not found" for a project that does not exist', async () => {
    await renderApp('/projects/prj_999', as('usr_002'));
    expect((await screen.findAllByText('Project not found')).length).toBeGreaterThan(0);
  });

  it('shows Retry in the task panel when the task did not load', async () => {
    await renderApp('/projects/prj_001?tab=tasks&task=tsk_007', as('usr_002'), { failFirst: 'tasks.get' });
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('dialog', { name: 'Stair details' })).toBeInTheDocument();
  });
});


describe('a tab whose list did not load says so and offers Retry (audit 2026-10-03, PRJ-4)', () => {
  it.each([
    ['Tasks', 'tasks', 'tasks.list'],
    ['Activity', 'activity', 'updates.list'],
    ['Tracker', 'tracker', 'tracker.list'],
    ['Files', 'files', 'files.list'],
  ])('the %s tab', async (_name, tab, call) => {
    await renderApp(`/projects/prj_001?tab=${tab}`, as('usr_002'), { failFirst: call });
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText('The data did not load.')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(panel).queryByText('The data did not load.')).toBeNull());
  });

  it('the Payments panel', async () => {
    await renderApp('/projects/prj_001', as('usr_011'), { failFirst: 'payments.list' });
    const region = await screen.findByRole('region', { name: 'Payments' });
    expect(await within(region).findByText('The data did not load.')).toBeInTheDocument();
    await userEvent.click(within(region).getByRole('button', { name: 'Retry' }));
    expect(await within(region).findByText('Concept stage fee')).toBeInTheDocument();
  });
});

describe('closing a panel (audit 2026-10-03, PRJ-9 and PRJ-10)', () => {
  it('Back after Close does not open the task panel again', async () => {
    const { router } = await renderApp('/projects/prj_001?tab=tasks', as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: /^Stair details/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stair details' })).toBeNull());
    await router.navigate(-1);
    await settle();
    expect(router.state.location.search).not.toContain('task=');
    expect(screen.queryByRole('dialog', { name: 'Stair details' })).toBeNull();
  });

  it('Back after Close does not open the payment sheet again', async () => {
    const { router } = await renderApp('/projects/prj_001', as('usr_011'));
    const region = await screen.findByRole('region', { name: 'Payments' });
    await userEvent.click(await within(region).findByRole('button', { name: /Concept stage fee/ }));
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await router.navigate(-1);
    await settle();
    expect(router.state.location.search).not.toContain('payment=');
  });

  it('a task closed on the Overview forgets its Conversation, so the next task opens on Details', async () => {
    const { router } = await renderApp('/projects/prj_001', as('usr_002'));
    const people = await screen.findByRole('region', { name: 'Who is doing what' });
    const lines = await within(people).findAllByRole('button');
    await userEvent.click(lines[0]);
    const first = await screen.findByRole('dialog');
    await userEvent.click(within(first).getByRole('tab', { name: /Conversation/ }));
    await userEvent.click(within(first).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.search).not.toContain('thread');
    await userEvent.click((await within(screen.getByRole('region', { name: 'Who is doing what' })).findAllByRole('button'))[1]);
    const second = await screen.findByRole('dialog');
    expect(within(second).getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('a failed save rolls back (audit 2026-10-03, PRJ-7)', () => {
  it('unticks a checklist box whose save failed', async () => {
    let taskId = '';
    const fail = trap('tasks.update');
    const { store } = await renderApp('/projects/prj_001?tab=tasks', (state) => {
      state.session.currentUserId = 'usr_002';
      taskId = Object.values(state.tasks).find((task) => task.projectId === 'prj_001' && task.status !== 'done' && task.checklist.some((item) => !item.done))!.id;
    }, { failFirst: fail.match });
    const task = store.state.tasks[taskId];
    const item = task.checklist.find((entry) => !entry.done)!;
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${task.title}`) }));
    const sheet = await screen.findByRole('dialog', { name: task.title });
    fail.state.armed = true;
    await userEvent.click(within(sheet).getByRole('checkbox', { name: item.text }));
    await waitFor(() => expect(fail.state.hit).toBe(true));
    await waitFor(() => expect(within(sheet).getByRole('checkbox', { name: item.text })).not.toBeChecked());
  });

  it('puts back a task date whose save failed', async () => {
    const fail = trap('tasks.update');
    const { store } = await renderApp('/projects/prj_001?tab=tasks&task=tsk_013', (state) => {
      state.session.currentUserId = 'usr_002';
      Object.assign(state.tasks.tsk_013, { startDate: null, dueDate: null, schedule: 'static', durationDays: null });
    }, { failFirst: fail.match });
    const sheet = await screen.findByRole('dialog', { name: store.state.tasks.tsk_013.title });
    fail.state.armed = true;
    fireEvent.change(within(sheet).getByLabelText('Start date'), { target: { value: '2026-01-05' } });
    fireEvent.blur(within(sheet).getByLabelText('Start date'));
    await waitFor(() => expect(fail.state.hit).toBe(true));
    await waitFor(() => expect(within(sheet).getByLabelText('Start date')).toHaveValue(''));
  });

  it('puts back a stage date whose save failed', async () => {
    const fail = trap('stages.setDates');
    const { store } = await renderApp('/projects/prj_001?tab=schedule', as('usr_002'), { failFirst: fail.match });
    const stage = Object.values(store.state.stages).find((item) => item.projectId === 'prj_001' && item.startDate)!;
    const field = () => document.getElementById(`start-${stage.id}`) as HTMLInputElement;
    await waitFor(() => expect(field()).not.toBeNull());
    fail.state.armed = true;
    fireEvent.change(field(), { target: { value: '2025-01-05' } });
    fireEvent.blur(field());
    await waitFor(() => expect(fail.state.hit).toBe(true));
    await waitFor(() => expect(field()).toHaveValue(stage.startDate));
  });
});
