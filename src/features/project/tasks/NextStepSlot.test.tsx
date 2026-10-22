import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { addOfficeTask, renderPanel, setupTask } from '../../../test/renderPanel';
import { NextStep } from './NextStepSlot';
import type { TaskPanel } from './useTaskPanel';

const slot = (panel: TaskPanel) => <div data-testid="host"><NextStep panel={panel} /></div>;
const demoted = (panel: TaskPanel) => <div data-testid="host"><NextStep panel={panel} demote /></div>;
const open = (taskId: string, prepare: (state: State) => void, extra: { render?: typeof slot; noteFirst?: boolean } = {}) =>
  renderPanel(taskId, { phone: true, prepare, render: extra.render ?? slot, noteFirst: extra.noteFirst });
const mains = () => screen.getByTestId('host').querySelectorAll('.signature');

describe('NextStep', () => {
  it('draws the review block for the reviewer', async () => {
    await open('tsk_010', setupTask('tsk_010', 'usr_002'));
    const region = await screen.findByRole('region', { name: 'Review' });
    expect(within(region).getByRole('button', { name: 'Approve' })).toHaveClass('signature');
    expect(within(region).getByRole('textbox', { name: 'What needs to change?' })).toHaveAttribute('id', 'task-note');
    expect(within(region).getByRole('button', { name: 'Send back' })).toBeDisabled();
    expect(mains()).toHaveLength(1);
  });

  it('draws Take it for a to-do with no lead', async () => {
    await open('tsk_007', setupTask('tsk_007', 'usr_005', { ownerId: null, status: 'todo' }));
    const region = await screen.findByRole('region', { name: 'No lead' });
    expect(within(region).getByText('Nobody leads this to-do yet. Take it to work on it and finish it.')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Take it' })).toHaveClass('signature');
    expect(mains()).toHaveLength(1);
  });

  it('draws Mark done, or Send to review for a to-do that needs review', async () => {
    const view = await open('tsk_007', setupTask('tsk_007', 'usr_006', { needsReview: false }));
    const done = await screen.findByRole('button', { name: 'Mark done' });
    expect(done).toHaveClass('signature', 'min-h-[52px]');
    expect(mains()).toHaveLength(1);
    view.unmount();
    await open('tsk_007', setupTask('tsk_007', 'usr_006', { needsReview: true }));
    expect(await screen.findByRole('button', { name: 'Send to review' })).toHaveClass('signature');
  });

  it('draws a quiet line and no button for a to-do that waits', async () => {
    await open('tsk_007', (state) => {
      setupTask('tsk_007', 'usr_006')(state);
      state.tasks.tsk_007.prerequisiteIds = ['tsk_006'];
      state.tasks.tsk_006.status = 'in_progress';
    });
    expect(await screen.findByText(/^Waiting for /)).toBeInTheDocument();
    expect(within(screen.getByTestId('host')).queryByRole('button')).toBeNull();
  });

  it('asks for a lead first when the person cannot take the to-do', async () => {
    // The person may move the to-do but holds no take right (a role without task.take).
    const noTake = (panel: TaskPanel) => <div data-testid="host"><NextStep panel={{ ...panel, viewerCan: { ...panel.viewerCan, take: false } }} /></div>;
    await open('tsk_007', setupTask('tsk_007', 'usr_001', { ownerId: null, status: 'todo' }), { render: noTake });
    expect(await screen.findByText('Not yet. Give this to-do a lead first.')).toBeInTheDocument();
    expect(within(screen.getByTestId('host')).queryByRole('button')).toBeNull();
  });

  it('tells the lead that the leader approves a to-do in review', async () => {
    await open('tsk_010', setupTask('tsk_010', 'usr_005'));
    expect(await screen.findByText('This to-do waits for the leader to approve it.')).toBeInTheDocument();
    expect(within(screen.getByTestId('host')).queryByRole('button')).toBeNull();
  });

  it('offers New version for a done to-do and opens the form in place', async () => {
    await open('tsk_007', setupTask('tsk_007', 'usr_006', { status: 'done', completedAt: '2026-09-29T09:00:00.000+03:00' }));
    await userEvent.click(await screen.findByRole('button', { name: 'New version' }));
    expect(await screen.findByRole('button', { name: 'Start version 2' })).toBeInTheDocument();
    expect(mains()).toHaveLength(1);
  });

  it('offers Join as a helper to a team member who is not on the to-do', async () => {
    await open('tsk_011', setupTask('tsk_011', 'usr_005'));
    const region = await screen.findByRole('region', { name: 'Join as a helper' });
    expect(within(region).getByRole('button', { name: 'Join as a helper' })).not.toHaveClass('signature');
    expect(mains()).toHaveLength(0);
  });

  it('draws the read only line of a project and of an office to-do', async () => {
    const view = await open('tsk_011', (state) => {
      setupTask('tsk_011', 'usr_005')(state);
      state.tasks.tsk_011.helperIds = ['usr_005'];
    });
    expect(await screen.findByText(/^You can view this to-do\. Only its lead and the project leader/)).toBeInTheDocument();
    view.unmount();
    await open('tsk_900', (state) => {
      state.session.currentUserId = 'usr_006';
      addOfficeTask(state, { helperIds: ['usr_006'] });
    });
    expect(await screen.findByText(/^You can view this to-do\. Only its lead and the person who made it/)).toBeInTheDocument();
  });

  it('keeps the focus rule of Send back with a note', async () => {
    await open('tsk_010', setupTask('tsk_010', 'usr_002'), { noteFirst: true });
    const send = await screen.findByRole('button', { name: 'Send back' });
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'What needs to change?' })).toHaveFocus());
    expect(send).toHaveClass('signature');
    expect(screen.getByRole('button', { name: 'Approve' })).not.toHaveClass('signature');
    expect(mains()).toHaveLength(1);
  });

  it('calls tasks.complete and shows the toast of the server result', async () => {
    const { store } = await open('tsk_007', setupTask('tsk_007', 'usr_006', { needsReview: false }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.status).toBe('done'));
    expect(await screen.findByText('To-do done.')).toBeInTheDocument();
  });

  it('shows the toast of a to-do that lands in review', async () => {
    const { store } = await open('tsk_007', setupTask('tsk_007', 'usr_006', { needsReview: true }));
    await userEvent.click(await screen.findByRole('button', { name: 'Send to review' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.status).toBe('in_review'));
    expect(await screen.findByText(/^Sent to review/)).toBeInTheDocument();
  });

  it('ignores a second tap while the call runs', async () => {
    const { store, api } = await open('tsk_007', setupTask('tsk_007', 'usr_006', { needsReview: false }));
    const calls: string[] = [];
    const original = api.call.bind(api);
    api.call = ((name: string, input: unknown, meta?: unknown) => {
      if (name === 'tasks.complete') calls.push(name);
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call;
    const button = await screen.findByRole('button', { name: 'Mark done' });
    button.click();
    button.click();
    await waitFor(() => expect(store.state.tasks.tsk_007.status).toBe('done'));
    expect(calls).toHaveLength(1);
  });

  it('turns the main button secondary when demote is true', async () => {
    await open('tsk_007', setupTask('tsk_007', 'usr_006', { needsReview: false }), { render: demoted });
    const button = await screen.findByRole('button', { name: 'Mark done' });
    expect(button).not.toHaveClass('signature');
    expect(mains()).toHaveLength(0);
  });

  it('takes no space when no kind applies', async () => {
    await open('tsk_007', setupTask('tsk_007', 'usr_006', { status: 'done' }), { render: (panel) => <div data-testid="host"><NextStep panel={{ ...panel, viewerCan: { ...panel.viewerCan, newVersion: false, work: true } }} /></div> });
    await screen.findByTestId('host');
    expect(screen.getByTestId('host').querySelector('[data-next-step]')).toBeNull();
  });

  it('moves to New version after Mark done', async () => {
    await open('tsk_007', setupTask('tsk_007', 'usr_006', { needsReview: false }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark done' }));
    expect(await screen.findByRole('button', { name: 'New version' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull());
  });
});
