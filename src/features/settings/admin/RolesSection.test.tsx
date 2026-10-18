import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

/**
 * Two custom roles: Cashier (rol_001, held by Omar Haddad, a Member) and Planner (rol_002, held by nobody). Turki Al-Otaibi (usr_010) is
 * the Management person of the sample office.
 */
function withRoles(state: State) {
  state.settings.roles = {
    custom: [
      { id: 'rol_001', name: 'Cashier', nameAr: 'أمين الصندوق', rights: ['payment.manage'] },
      { id: 'rol_002', name: 'Planner', nameAr: 'المخطط', rights: ['people.manage'] },
    ],
  };
  state.counters.rol = 2;
  state.users.usr_004.roleId = 'rol_001';
}

const roles = () => screen.findByRole('region', { name: 'Roles' });

describe('the Admin Roles section (owner, 2026-10-18, fbk_014)', () => {
  it('shows the Admin as locked, and every built-in and custom role with its switches', async () => {
    await renderApp('/admin/roles', withRoles);
    const section = within(await roles());
    expect(within(section.getByRole('region', { name: 'Admin' })).getByText('Everything')).toBeInTheDocument();
    expect(within(section.getByRole('region', { name: 'Admin' })).queryByRole('switch')).toBeNull();
    const management = within(section.getByRole('region', { name: 'Management' }));
    expect(management.getByRole('switch', { name: 'Manage people' })).toHaveAttribute('aria-checked', 'true');
    expect(management.getByRole('switch', { name: 'Ask for the office report' })).toHaveAttribute('aria-checked', 'true');
    expect(management.getByRole('switch', { name: 'Payments' })).toHaveAttribute('aria-checked', 'true');
    const member = within(section.getByRole('region', { name: 'Member' }));
    expect(member.getByRole('switch', { name: 'Payments' })).toHaveAttribute('aria-checked', 'false');
    // The custom roles come with the answer of settings.get, a moment after the built-in roles.
    expect(within(await section.findByRole('region', { name: 'Planner' })).getByRole('switch', { name: 'Manage people' })).toHaveAttribute('aria-checked', 'true');
    expect(within(await section.findByRole('region', { name: 'Cashier' })).getByRole('switch', { name: 'Payments' })).toHaveAttribute('aria-checked', 'true');
  });

  it('a switch changes one right of its role, and the role keeps its other rights', async () => {
    const { store } = await renderApp('/admin/roles', withRoles);
    const accounting = within(await roles()).getByRole('region', { name: 'Accounting' });
    await userEvent.click(within(accounting).getByRole('switch', { name: 'Payments' }));
    await waitFor(() => expect(store.state.settings.roles?.rights?.accounting).toEqual([]));
    expect(within(accounting).getByRole('switch', { name: 'Payments' })).toHaveAttribute('aria-checked', 'false');
    expect(store.state.settings.roles?.rights?.management).toBeUndefined();
  });

  it('makes a custom role from the New role sheet, with the rights that its switches hold', async () => {
    const { store } = await renderApp('/admin/roles', withRoles);
    await userEvent.click(within(await roles()).getByRole('button', { name: 'New role' }));
    const sheet = await screen.findByRole('dialog', { name: 'New role' });
    await userEvent.type(within(sheet).getByLabelText('Name in English'), 'Site lead');
    await userEvent.type(within(sheet).getByLabelText('Name in Arabic'), 'مسؤول الموقع');
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Manage clients' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save role' }));
    await waitFor(() => expect(store.state.settings.roles?.custom).toHaveLength(3));
    expect(store.state.settings.roles?.custom?.[2]).toMatchObject({ id: 'rol_003', name: 'Site lead', nameAr: 'مسؤول الموقع', rights: ['clients.manage'] });
  });

  it('shows the name of another role under the name field, and saves nothing', async () => {
    const { store } = await renderApp('/admin/roles', withRoles);
    await userEvent.click(within(await roles()).getByRole('button', { name: 'New role' }));
    const sheet = await screen.findByRole('dialog', { name: 'New role' });
    await userEvent.type(within(sheet).getByLabelText('Name in English'), 'cashier');
    await userEvent.type(within(sheet).getByLabelText('Name in Arabic'), 'دور جديد');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save role' }));
    expect(await within(sheet).findByText('Another role has this name. Use another name.')).toBeInTheDocument();
    expect(store.state.settings.roles?.custom).toHaveLength(2);
  });

  it('deletes a role that nobody holds, and says how many people hold a role in use', async () => {
    const { store } = await renderApp('/admin/roles', withRoles);
    const section = within(await roles());
    await userEvent.click(within(await section.findByRole('region', { name: 'Cashier' })).getByRole('button', { name: 'Edit role' }));
    const cashier = await screen.findByRole('dialog', { name: 'Edit role' });
    await userEvent.click(within(cashier).getByRole('button', { name: 'Delete role' }));
    expect(await within(cashier).findByText('1 person holds this role. Move the person to another role first.')).toBeInTheDocument();
    expect(store.state.settings.roles?.custom).toHaveLength(2);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit role' })).toBeNull());
    await userEvent.click(within(await section.findByRole('region', { name: 'Planner' })).getByRole('button', { name: 'Edit role' }));
    const planner = await screen.findByRole('dialog', { name: 'Edit role' });
    await userEvent.click(within(planner).getByRole('button', { name: 'Delete role' }));
    await waitFor(() => expect(store.state.settings.roles?.custom?.map((role) => role.id)).toEqual(['rol_001']));
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
