import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

/** A custom role, Cashier (rol_001), held by Omar Haddad, a Member. Turki Al-Otaibi (usr_010) is Management. */
function withRoles(state: State) {
  state.settings.roles = { custom: [{ id: 'rol_001', name: 'Cashier', nameAr: 'أمين الصندوق', rights: ['payment.manage'] }] };
  // The sample office has one holder of its own sample role. This test names its own holder.
  for (const user of Object.values(state.users)) delete user.roleId;
  state.counters.rol = 1;
  state.users.usr_004.roleId = 'rol_001';
}

const asManagement = (state: State) => {
  withRoles(state);
  state.session.currentUserId = 'usr_010';
};

const people = () => screen.findByRole('region', { name: 'People' });

/** Opens the Edit sheet of one person from the People list. */
async function openEdit(name: string) {
  await userEvent.click(await within(await people()).findByRole('button', { name: `Actions for ${name}` }));
  await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit' }));
  return screen.findByRole('dialog', { name: 'Edit person' });
}

describe('the role of a person in the Admin sheet (owner, 2026-10-18, fbk_014)', () => {
  it('offers the custom roles to the Admin, and saves the role that the Admin picks', async () => {
    const { store } = await renderApp('/admin', withRoles);
    await userEvent.click(within(await people()).getByRole('button', { name: 'Add person' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add person' });
    const role = within(sheet).getByLabelText('Role');
    expect(within(role).getByRole('option', { name: 'Cashier' })).toBeInTheDocument();
    await userEvent.selectOptions(role, 'rol_001');
    await userEvent.type(within(sheet).getByLabelText('Name in English'), 'Nora Salem');
    await userEvent.type(within(sheet).getByLabelText('Name in Arabic'), 'نورة سالم');
    await userEvent.type(within(sheet).getByLabelText('Email'), 'nora.salem@madar.test');
    await userEvent.type(within(sheet).getByLabelText('Discipline'), 'Landscape');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(Object.values(store.state.users).find((user) => user.name === 'Nora Salem')).toMatchObject({ systemRole: 'member', roleId: 'rol_001' }));
  });

  it('shows the custom role of a person as its name in the People list and in the Admin sheet', async () => {
    await renderApp('/admin', withRoles);
    expect(await within(await people()).findByText(/Cashier/)).toBeInTheDocument();
    const sheet = await openEdit('Omar Haddad');
    expect(within(sheet).getByLabelText('Role')).toHaveValue('rol_001');
  });

  it('shows the role as text to Management, with no list of roles', async () => {
    await renderApp('/admin', asManagement);
    const sheet = await openEdit('Omar Haddad');
    expect(within(sheet).queryByLabelText('Role')).toBeNull();
    expect(await within(sheet).findByText('Cashier')).toBeInTheDocument();
  });

  it('gives a person added by Management the Member role as text, and no custom role', async () => {
    const { store } = await renderApp('/admin', asManagement);
    await userEvent.click(within(await people()).getByRole('button', { name: 'Add person' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add person' });
    expect(within(sheet).queryByLabelText('Role')).toBeNull();
    expect(within(sheet).getByText('Member')).toBeInTheDocument();
    await userEvent.type(within(sheet).getByLabelText('Name in English'), 'Nora Salem');
    await userEvent.type(within(sheet).getByLabelText('Name in Arabic'), 'نورة سالم');
    await userEvent.type(within(sheet).getByLabelText('Email'), 'nora.salem@madar.test');
    await userEvent.type(within(sheet).getByLabelText('Discipline'), 'Landscape');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(Object.values(store.state.users).find((user) => user.name === 'Nora Salem')).toMatchObject({ systemRole: 'member' }));
    expect(Object.values(store.state.users).find((user) => user.name === 'Nora Salem')?.roleId ?? null).toBeNull();
  });
});
