import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const region = (name: string) => screen.findByRole('region', { name });
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const names = (store: { state: State }) => Object.values(store.state.teams ?? {}).map((team) => team.name).sort();

describe('the Teams section', () => {
  it('lists the four sample teams with their people, and shows each person their teams quietly', async () => {
    const teamsPage = await renderApp('/admin/teams');
    const teams = await region('Teams');
    for (const [name, count] of [['Design', '4 people'], ['Technical', '3 people'], ['Interiors', '2 people'], ['Site', '3 people']]) {
      const row = (await within(teams).findByText(name)).closest('li') as HTMLElement;
      expect(within(row).getByText(count)).toBeInTheDocument();
    }
    teamsPage.unmount();
    // People and Teams are two sections of the side list now (owner, 2026-10-05).
    await renderApp('/admin/people');
    const people = await region('People');
    const reem = (await within(people).findByText('Reem Al-Ghamdi')).closest('li') as HTMLElement;
    expect(within(reem).getByText(/Design, Interiors/)).toBeInTheDocument();
  });

  it('makes a team with a name and people', async () => {
    const { store } = await renderApp('/admin/teams');
    await userEvent.click(within(await region('Teams')).getByRole('button', { name: 'Add team' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add team' });
    await userEvent.type(within(sheet).getByLabelText('Team name'), 'Landscape');
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /Lina Mansour/ }));
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /Omar Haddad/ }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(names(store)).toContain('Landscape'));
    expect(Object.values(store.state.teams ?? {}).find((team) => team.name === 'Landscape')?.memberIds).toEqual(['usr_007', 'usr_004']);
    expect(await within(await region('Teams')).findByText('Landscape')).toBeInTheDocument();
  });

  it('shows a refused name under the field, and keeps the sheet open', async () => {
    const { store } = await renderApp('/admin/teams');
    await userEvent.click(within(await region('Teams')).getByRole('button', { name: 'Add team' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add team' });
    await userEvent.type(within(sheet).getByLabelText('Team name'), 'design');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('A team with this name exists. Use another name.')).toBeInTheDocument();
    expect(names(store)).toHaveLength(4);
  });

  it('renames a team and changes its people', async () => {
    const { store } = await renderApp('/admin/teams');
    await userEvent.click(await within(await region('Teams')).findByRole('button', { name: 'Actions for Interiors' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit team' });
    const name = within(sheet).getByLabelText('Team name');
    expect(name).toHaveValue('Interiors');
    expect(within(sheet).getByRole('checkbox', { name: /Lina Mansour/ })).toBeChecked();
    await userEvent.clear(name);
    await userEvent.type(name, 'Interior design');
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /Lina Mansour/ }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(names(store)).toContain('Interior design'));
    expect(Object.values(store.state.teams ?? {}).find((team) => team.name === 'Interior design')?.memberIds).toEqual(['usr_003']);
  });

  it('deletes a team, then brings it back with Undo', async () => {
    const { store } = await renderApp('/admin/teams');
    await userEvent.click(await within(await region('Teams')).findByRole('button', { name: 'Actions for Site' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete team' }));
    await waitFor(() => expect(names(store)).not.toContain('Site'));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(names(store)).toContain('Site'));
  });

  it('is open to Management, and closed to a member', async () => {
    const first = await renderApp('/admin/teams', as('usr_010'));
    const teams = await region('Teams');
    expect(within(teams).getByRole('button', { name: 'Add team' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Office settings' })).toBeNull();
    first.unmount();
    await renderApp('/admin/teams', as('usr_005'));
    expect(await screen.findByText('Only the Admin and Management can open this page.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Teams' })).toBeNull();
  });
});

describe('the stale limit in the Office section', () => {
  it('saves the number of days after which a paused project turns stale', async () => {
    const { store } = await renderApp('/admin/office');
    const office = await region('Office settings');
    const field = await within(office).findByLabelText('Days until a paused project is stale');
    expect(field).toHaveValue('30');
    await userEvent.clear(field);
    await userEvent.type(field, '45');
    await userEvent.click(within(office).getByRole('button', { name: 'Save office settings' }));
    await waitFor(() => expect(store.state.settings.staleAfterDays).toBe(45));
  });

  it('refuses a number outside 7 to 365 under the field, and saves nothing', async () => {
    const { store } = await renderApp('/admin/office');
    const office = await region('Office settings');
    const field = await within(office).findByLabelText('Days until a paused project is stale');
    await userEvent.clear(field);
    await userEvent.type(field, '5');
    await userEvent.click(within(office).getByRole('button', { name: 'Save office settings' }));
    expect(await within(office).findByText('Use a whole number from 7 to 365.')).toBeInTheDocument();
    expect(store.state.settings.staleAfterDays).toBe(30);
  });
});
