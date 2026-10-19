import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_RIGHTS } from '../../../api/permissions';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

/**
 * Two custom roles: Cashier (rol_001, held by Omar Haddad, a Member) and Planner (rol_002, held by nobody). Turki Al-Otaibi (usr_010) is
 * the Management person of the sample office. The page is one row for each role; the switches are in the sheet of a role (ADM-12, ADM-13).
 */
function withRoles(state: State) {
  state.settings.roles = {
    custom: [
      { id: 'rol_001', name: 'Cashier', nameAr: 'أمين الصندوق', rights: ['payment.manage'] },
      { id: 'rol_002', name: 'Planner', nameAr: 'المخطط', rights: ['people.manage'] },
    ],
  };
  state.counters.rol = 2;
  for (const user of Object.values(state.users)) delete user.roleId;
  state.users.usr_004.roleId = 'rol_001';
}

const roles = () => screen.findByRole('region', { name: 'Roles' });
/** The row button of a role: its name is the first line of the button. */
const row = async (name: string) => within(await roles()).findByRole('button', { name: new RegExp(`^${name}`) });

describe('the Admin Roles section (owner, 2026-10-18, fbk_014)', () => {
  it('shows the Admin as locked and one row for each role, with its people and its rights', async () => {
    await renderApp('/admin/roles', withRoles);
    const section = within(await roles());
    expect(section.getByText('Everything')).toBeInTheDocument();
    expect(section.queryByRole('switch')).toBeNull();
    expect(await row('Management')).toHaveTextContent(`1 person · ${DEFAULT_RIGHTS.management.length} of 7 rights`);
    expect(await row('Cashier')).toHaveTextContent('1 person · 1 of 7 rights');
    expect(await row('Planner')).toHaveTextContent('No one yet · 1 of 7 rights');
    // One row for each role, not a wall of switches (28 switches before).
    expect(section.getAllByRole('button').length).toBeLessThan(10);
  });

  it('opens the sheet of a role with the people who hold it, and a switch saves only with Save role', async () => {
    const { store } = await renderApp('/admin/roles', withRoles);
    await userEvent.click(await row('Cashier'));
    const sheet = await screen.findByRole('dialog', { name: 'Cashier' });
    expect(within(sheet).getByText('Omar Haddad')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Manage clients' }));
    expect(store.state.settings.roles?.custom?.[0].rights).toEqual(['payment.manage']);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save role' }));
    await waitFor(() => expect(store.state.settings.roles?.custom?.[0].rights).toEqual(['payment.manage', 'clients.manage']));
  });

  it('has Cancel, which leaves the rights as they were', async () => {
    const { store } = await renderApp('/admin/roles', withRoles);
    await userEvent.click(await row('Cashier'));
    const sheet = await screen.findByRole('dialog', { name: 'Cashier' });
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Manage clients' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cashier' })).toBeNull());
    expect(store.state.settings.roles?.custom?.[0].rights).toEqual(['payment.manage']);
  });

  it('changes one right of a built-in role, which has no name to change, and keeps the other rights', async () => {
    const { store } = await renderApp('/admin/roles', withRoles);
    await userEvent.click(await row('Accounting'));
    const sheet = await screen.findByRole('dialog', { name: 'Accounting' });
    expect(within(sheet).queryByLabelText('Name in English')).toBeNull();
    await userEvent.click(within(sheet).getByRole('switch', { name: 'See and change payments' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save role' }));
    await waitFor(() => expect(store.state.settings.roles?.rights?.accounting).toEqual([]));
    expect(store.state.settings.roles?.rights?.management).toBeUndefined();
  });

  it('makes a custom role from the New role sheet, with the rights that its switches hold', async () => {
    const { store } = await renderApp('/admin/roles', withRoles);
    await userEvent.click(within(await roles()).getByRole('button', { name: 'New role' }));
    const sheet = await screen.findByRole('dialog', { name: 'New role' });
    await userEvent.type(within(sheet).getByLabelText(/Name in English/), 'Site lead');
    await userEvent.type(within(sheet).getByLabelText(/Name in Arabic/), 'مسؤول الموقع');
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Manage clients' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save role' }));
    await waitFor(() => expect(store.state.settings.roles?.custom).toHaveLength(3));
    expect(store.state.settings.roles?.custom?.[2]).toMatchObject({ id: 'rol_003', name: 'Site lead', nameAr: 'مسؤول الموقع', rights: ['clients.manage'] });
  });

  it('shows the name of another role under the name field, and saves nothing', async () => {
    const { store } = await renderApp('/admin/roles', withRoles);
    await userEvent.click(within(await roles()).getByRole('button', { name: 'New role' }));
    const sheet = await screen.findByRole('dialog', { name: 'New role' });
    await userEvent.type(within(sheet).getByLabelText(/Name in English/), 'cashier');
    await userEvent.type(within(sheet).getByLabelText(/Name in Arabic/), 'دور جديد');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save role' }));
    expect(await within(sheet).findByText('Another role has this name. Use another name.')).toBeInTheDocument();
    expect(store.state.settings.roles?.custom).toHaveLength(2);
  });

  it('deletes a role that nobody holds at once, with Undo', async () => {
    const { store } = await renderApp('/admin/roles', withRoles);
    await userEvent.click(await row('Planner'));
    const sheet = await screen.findByRole('dialog', { name: 'Planner' });
    expect(within(sheet).getByText('No one has this role yet.')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete role' }));
    await waitFor(() => expect(store.state.settings.roles?.custom?.map((role) => role.id)).toEqual(['rol_001']));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.settings.roles?.custom?.map((role) => role.id)).toEqual(['rol_001', 'rol_002']));
  });

  it('names the person of a role in use, moves the person to the role that the Admin picks, and one Undo brings both back (ADM-14)', async () => {
    const { store } = await renderApp('/admin/roles', withRoles);
    await userEvent.click(await row('Cashier'));
    const sheet = await screen.findByRole('dialog', { name: 'Cashier' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete role' }));
    const question = await screen.findByRole('dialog', { name: 'Delete Cashier?' });
    expect(within(question).getByText('Omar Haddad')).toBeInTheDocument();
    expect(within(question).getByText(/This person holds this role/)).toBeInTheDocument();
    expect(within(question).getByLabelText('New role of these people')).toHaveValue('member');
    expect(store.state.settings.roles?.custom).toHaveLength(2);
    await userEvent.click(within(question).getByRole('button', { name: 'Delete and move' }));
    await waitFor(() => expect(store.state.settings.roles?.custom?.map((role) => role.id)).toEqual(['rol_002']));
    expect(store.state.users.usr_004).toMatchObject({ systemRole: 'member', roleId: null });
    expect(await screen.findByText('Role deleted. 1 person moved.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.users.usr_004.roleId).toBe('rol_001'));
    expect(store.state.settings.roles?.custom?.map((role) => role.id)).toContain('rol_001');
  });

  it('stays closed to Management: the Roles section does not open, and the People section does', async () => {
    await renderApp('/admin/roles', (state) => {
      withRoles(state);
      state.session.currentUserId = 'usr_010';
    });
    expect(await screen.findByRole('region', { name: 'People' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Roles' })).toBeNull();
  });
});
