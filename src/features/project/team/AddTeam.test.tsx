import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
// The Corniche tower: Faisal leads, with Sara, Yousef and Khalid. Interiors is Reem and Lina; Design is Faisal, Reem, Sara and Lina.
const TEAM = '/projects/prj_001?tab=team';

describe('Add a team on the Team tab', () => {
  it('adds only the people who are not on the project, and says how many came in', async () => {
    const { store } = await renderApp(TEAM, as('usr_002'));
    const section = await screen.findByRole('region', { name: 'Add a team' });
    await userEvent.selectOptions(within(section).getByLabelText('Team'), 'Design');
    await userEvent.click(within(section).getByRole('button', { name: 'Add team' }));
    // Reem (usr_003) and Lina (usr_007) are new. Faisal and Sara are already there.
    expect(await screen.findByText('2 people added')).toBeInTheDocument();
    expect(store.state.members['prj_001:usr_003']).toBeDefined();
    expect(store.state.members['prj_001:usr_007']).toBeDefined();
    const members = screen.getByRole('region', { name: 'Members' });
    expect(await within(members).findByText('Lina Mansour')).toBeInTheDocument();
    expect(within(members).getByText('Reem Al-Ghamdi')).toBeInTheDocument();
    const notified = Object.values(store.state.notifications).filter((n) => n.trigger === 'added_to_project' && n.targetId === 'prj_001');
    expect(notified.map((n) => n.userId).sort()).toEqual(['usr_003', 'usr_007']);
  });

  it('says one person in the singular, and says so when nobody is new', async () => {
    const { store } = await renderApp(TEAM, as('usr_002'));
    store.state.members['prj_001:usr_003'] = { projectId: 'prj_001', userId: 'usr_003', discipline: 'Architect' };
    const section = await screen.findByRole('region', { name: 'Add a team' });
    await userEvent.selectOptions(within(section).getByLabelText('Team'), 'Interiors');
    await userEvent.click(within(section).getByRole('button', { name: 'Add team' }));
    expect(await screen.findByText('1 person added')).toBeInTheDocument();
    await userEvent.selectOptions(within(section).getByLabelText('Team'), 'Interiors');
    await userEvent.click(within(section).getByRole('button', { name: 'Add team' }));
    expect(await screen.findByText('Everyone in Interiors is already on this project.')).toBeInTheDocument();
  });

  it('keeps the button off until a team is chosen', async () => {
    await renderApp(TEAM, as('usr_002'));
    const section = await screen.findByRole('region', { name: 'Add a team' });
    expect(within(section).getByRole('button', { name: 'Add team' })).toBeDisabled();
  });

  it('is offered only to a person who may add members: the leader and the Admin', async () => {
    const first = await renderApp(TEAM, as('usr_005'));
    await screen.findByRole('region', { name: 'Members' });
    expect(screen.queryByRole('region', { name: 'Add a team' })).toBeNull();
    first.unmount();
    const second = await renderApp(TEAM, as('usr_001'));
    expect(await screen.findByRole('region', { name: 'Add a team' })).toBeInTheDocument();
    second.unmount();
    await renderApp(TEAM, as('usr_010'));
    await screen.findByRole('region', { name: 'Members' });
    expect(screen.queryByRole('region', { name: 'Add a team' })).toBeNull();
  });

  it('shows no section when the office has no team with people', async () => {
    await renderApp(TEAM, (state) => {
      state.session.currentUserId = 'usr_002';
      state.teams = {};
    });
    await screen.findByRole('region', { name: 'Members' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Add a team' })).toBeNull());
  });
});
