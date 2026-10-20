import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

// The maker of a project task holds the leader's rights on it, except the review (owner, 2026-10-07). In Corniche Office Tower
// (prj_001), Faisal (usr_002) leads the project and Sara (usr_005) is on the team. The tests make Sara the maker of tsk_013.
const TASK = '/projects/prj_001?tab=tasks&task=tsk_013';
const saraMadeIt = (state: State) => {
  state.session.currentUserId = 'usr_005';
  state.tasks.tsk_013.createdBy = 'usr_005';
  state.tasks.tsk_013.ownerId = null;
};
/** The people of the team of prj_001: its members and its leader. */
const teamOf = (state: State) => new Set([
  ...Object.values(state.members).filter((member) => member.projectId === 'prj_001').map((member) => member.userId),
  state.projects.prj_001.leaderId,
]);

describe('the maker of a project task in the task panel', () => {
  it('names a team mate as lead from a list of the team only', async () => {
    const { store } = await renderApp(TASK, saraMadeIt);
    const sheet = await screen.findByRole('dialog', { name: 'Coordination meeting notes' });
    const lead = within(sheet).getByLabelText('Lead') as HTMLSelectElement;
    const team = teamOf(store.state);
    const offered = [...lead.options].map((option) => option.value).filter(Boolean);
    expect(offered.length).toBeGreaterThan(1);
    expect(offered.every((id) => team.has(id))).toBe(true);
    const outsider = Object.values(store.state.users).find((user) => user.kind === 'human' && user.active && !team.has(user.id));
    expect(outsider).toBeDefined();
    // Nobody joins the team from the list of a maker, so the hint says nothing of it.
    expect(within(sheet).getByText('Helpers tick checklist items and comment. Only the lead finishes the to-do.')).toBeInTheDocument();
    expect(within(sheet).queryByText(/outside the team joins it/)).toBeNull();
    await userEvent.selectOptions(lead, 'usr_002');
    await waitFor(() => expect(store.state.tasks.tsk_013.ownerId).toBe('usr_002'));
  });

  it('shows Delete task and no review switch', async () => {
    const { store } = await renderApp(TASK, saraMadeIt);
    const sheet = await screen.findByRole('dialog', { name: 'Coordination meeting notes' });
    expect(within(sheet).getByRole('button', { name: 'Delete to-do' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('switch', { name: /Needs review/ })).toBeNull();
    expect(store.state.tasks.tsk_013.needsReview).toBe(true);
  });

  it('gives a team member who did not make the task no Lead list', async () => {
    await renderApp(TASK, (state) => {
      saraMadeIt(state);
      state.tasks.tsk_013.createdBy = 'usr_002';
    });
    const sheet = await screen.findByRole('dialog', { name: 'Coordination meeting notes' });
    expect(within(sheet).queryByLabelText('Lead')).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Take it' })).toBeInTheDocument();
  });

  it('keeps the review switch and every person for the leader', async () => {
    const { store } = await renderApp(TASK, (state) => {
      saraMadeIt(state);
      state.session.currentUserId = 'usr_002';
    });
    const sheet = await screen.findByRole('dialog', { name: 'Coordination meeting notes' });
    expect(within(sheet).getByRole('switch', { name: /Needs review/ })).toBeInTheDocument();
    const lead = within(sheet).getByLabelText('Lead') as HTMLSelectElement;
    const team = teamOf(store.state);
    expect([...lead.options].some((option) => option.value !== '' && !team.has(option.value))).toBe(true);
    expect(within(sheet).getByText(/outside the team joins it/)).toBeInTheDocument();
  });
});
