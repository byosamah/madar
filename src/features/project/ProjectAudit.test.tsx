import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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

