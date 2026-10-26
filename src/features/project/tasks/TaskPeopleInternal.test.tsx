import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addSampleInternalProject } from '../../../data/sampleInternalProject';
import type { State } from '../../../api/store';
import { TODAY } from '../../../test/factories';
import { phoneMedia } from '../../../test/phoneMedia';
import { renderApp } from '../../../test/render';
import { renderRemoteApp } from '../../../test/renderRemote';
import { renderWireApp } from '../../../test/wireApp';

// Feedback fbk_064 (2026-10-26, Faisal): a team member who is not the leader of an internal project made a to-do, pressed the
// lead button of its row in the To-dos tab, and the page showed "Something went wrong on this page". In the sample office,
// "Portfolio 2026" (prj_013) is internal and hidden. Reem Al-Ghamdi leads it and Lina Mansour is on its team.
const TAB = '/projects/prj_013?tab=tasks';
const TITLE = 'Photograph the finished villa';
const asLina = (state: State) => {
  addSampleInternalProject(state, TODAY);
  const lina = Object.values(state.users).find((user) => user.name === 'Lina Mansour')!;
  state.session.currentUserId = lina.id;
  // Lina is the maker of the to-do, not the leader of the project.
  const task = Object.values(state.tasks).find((item) => item.title === TITLE)!;
  task.createdBy = lina.id;
  task.ownerId = null;
};
const asLeader = (state: State) => {
  addSampleInternalProject(state, TODAY);
  const reem = Object.values(state.users).find((user) => user.name === 'Reem Al-Ghamdi')!;
  state.session.currentUserId = reem.id;
};
const press = async () => userEvent.click(await screen.findByRole('button', { name: `Lead and helpers of ${TITLE}` }));
const noErrorPage = () => expect(screen.queryByText(/Something went wrong on this page/)).toBeNull();

describe('the lead button of a to-do row on an internal project (fbk_064)', () => {
  it('opens the people list for the maker who is a team member and not the leader, on a desk', async () => {
    await renderApp(TAB, asLina);
    await press();
    const popover = await screen.findByRole('dialog', { name: 'Change the lead' });
    noErrorPage();
    expect(within(popover).getByRole('button', { name: /Reem Al-Ghamdi/ })).toBeInTheDocument();
    expect(within(popover).getByRole('button', { name: /Lina Mansour/ })).toBeInTheDocument();
  });

  it('opens the people list for the same person as a bottom sheet on a phone', async () => {
    phoneMedia({ phone: true, coarse: true });
    await renderApp(TAB, asLina);
    await press();
    const sheet = await screen.findByRole('dialog', { name: 'Change the lead' });
    noErrorPage();
    expect(within(sheet).getByRole('button', { name: /Reem Al-Ghamdi/ })).toBeInTheDocument();
  });

  it('lets the maker pick a new lead from the team', async () => {
    const { store } = await renderApp(TAB, asLina);
    await press();
    const popover = await screen.findByRole('dialog', { name: 'Change the lead' });
    await userEvent.click(within(popover).getByRole('button', { name: /Reem Al-Ghamdi/ }));
    await waitFor(() => {
      const task = Object.values(store.state.tasks).find((item) => item.title === TITLE)!;
      expect(task.ownerId).not.toBeNull();
    });
  });

  it('opens the people list for the leader of the internal project', async () => {
    await renderApp(TAB, asLeader);
    await press();
    await screen.findByRole('dialog', { name: 'Change the lead' });
    noErrorPage();
  });
});

describe('the same press in the real build (remote runtime)', () => {
  it('opens the people list for the maker who is a team member and not the leader', async () => {
    await renderRemoteApp(TAB, asLina);
    await press();
    await screen.findByRole('dialog', { name: 'Change the lead' });
    noErrorPage();
  });
});

describe('the same press over the real wire (JSON round trip)', () => {
  it('opens the people list for the maker who is a team member and not the leader', async () => {
    await renderWireApp(TAB, asLina);
    await press();
    await screen.findByRole('dialog', { name: 'Change the lead' });
    noErrorPage();
  });
});
