import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

/**
 * The block "Who sees this project" at the top of the Team tab (fbk_044, owner 2026-10-22). prj_001: leader usr_002 (Faisal), team
 * usr_005 and usr_006. Lina Mansour (usr_007) is on no team of it. 
 */
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const access = (viewerIds: string[]) => (state: State) => {
  state.session.currentUserId = 'usr_002';
  state.projects.prj_001.access = { hidden: true, viewerIds };
};
const TEAM = '/projects/prj_001?tab=team';
const block = async () => screen.findByRole('group', { name: 'Who sees this project' });

describe('who sees this project, as the leader', () => {
  it('shows two radio choices at the top, with Everyone in the office chosen', async () => {
    await renderApp(TEAM, as('usr_002'));
    const who = await block();
    expect(within(who).getByRole('radio', { name: 'Everyone in the office' })).toBeChecked();
    expect(within(who).getByRole('radio', { name: 'Only the team and chosen people' })).not.toBeChecked();
    expect(within(who).queryByText('Chosen people')).toBeNull();
    expect(who.compareDocumentPosition(screen.getByRole('region', { name: 'Leader' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('saves at once with a toast, and Undo brings the old choice back', async () => {
    const { store } = await renderApp(TEAM, as('usr_002'));
    const who = await block();
    await userEvent.click(within(who).getByRole('radio', { name: 'Only the team and chosen people' }));
    await waitFor(() => expect(store.state.projects.prj_001.access).toEqual({ hidden: true, viewerIds: [] }));
    expect(await screen.findByText('Only the team and chosen people see this project now.')).toBeInTheDocument();
    expect(within(who).getByRole('radio', { name: 'Only the team and chosen people' })).toBeChecked();
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.projects.prj_001.access?.hidden ?? false).toBe(false));
    await waitFor(() => expect(within(who).getByRole('radio', { name: 'Everyone in the office' })).toBeChecked());
  });

  it('opens the project again with the first choice, and keeps the chosen people for a later hide', async () => {
    const { store } = await renderApp(TEAM, access(['usr_007']));
    const who = await block();
    await waitFor(() => expect(within(who).getByRole('radio', { name: 'Only the team and chosen people' })).toBeChecked());
    await userEvent.click(within(who).getByRole('radio', { name: 'Everyone in the office' }));
    await waitFor(() => expect(store.state.projects.prj_001.access).toEqual({ hidden: false, viewerIds: ['usr_007'] }));
    expect(await screen.findByText('Everyone in the office sees this project now.')).toBeInTheDocument();
  });

  it('adds a chosen person from the picker and removes them again, each with a toast', async () => {
    const { store } = await renderApp(TEAM, access([]));
    const who = await block();
    expect(await within(who).findByText('No one is chosen yet.')).toBeInTheDocument();
    await userEvent.selectOptions(within(who).getByLabelText('Add people'), 'Lina Mansour');
    await userEvent.click(within(who).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(store.state.projects.prj_001.access).toEqual({ hidden: true, viewerIds: ['usr_007'] }));
    expect(await screen.findByText('Lina Mansour sees this project now.')).toBeInTheDocument();
    const list = within(who).getByRole('list', { name: 'Chosen people' });
    expect(within(list).getByText('Lina Mansour')).toBeInTheDocument();
    // The picker leaves out a person who is chosen or on the team.
    const picker = within(who).queryByLabelText('Add people');
    if (picker) {
      const names = within(picker).queryAllByRole('option').map((option) => option.textContent);
      expect(names).not.toContain('Lina Mansour');
      expect(names).not.toContain('Faisal Al-Harbi');
    }
    await userEvent.click(within(list).getByRole('button', { name: 'Remove Lina Mansour' }));
    await waitFor(() => expect(store.state.projects.prj_001.access).toEqual({ hidden: true, viewerIds: [] }));
    expect(await screen.findByText('Lina Mansour no longer sees this project.')).toBeInTheDocument();
  });
});

describe('who sees this project, for a person who may not change it', () => {
  it('shows one plain line and no control', async () => {
    const { store } = await renderApp(TEAM, as('usr_006'));
    expect(store.state.members['prj_001:usr_006']).toBeDefined();
    expect(await screen.findByText('Everyone in the office sees this project.')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Everyone in the office' })).toBeNull();
    expect(screen.queryByLabelText('Add people')).toBeNull();
  });

  it('says who sees a hidden project', async () => {
    await renderApp(TEAM, (state) => {
      as('usr_006')(state);
      state.projects.prj_001.access = { hidden: true, viewerIds: [] };
    });
    expect(await screen.findByText('Only the team and chosen people see this project.')).toBeInTheDocument();
  });
});
