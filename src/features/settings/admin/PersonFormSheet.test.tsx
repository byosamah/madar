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

  // Role rights version 2: the line under the Role field counts the switches beyond and below the standard list of 66.
  describe('the line under the Role field', () => {
    /** Opens the Add person sheet. One render for each test. */
    const open = async (prepare: (state: State) => void, words = { people: 'People', add: 'Add person', role: 'Role' }) => {
      await renderApp('/admin', prepare);
      await userEvent.click(within(await screen.findByRole('region', { name: words.people })).getByRole('button', { name: words.add }));
      const sheet = within(await screen.findByRole('dialog', { name: words.add }));
      const pick = (role: string) => userEvent.selectOptions(sheet.getByLabelText(words.role), role);
      return { sheet, pick };
    };
    const cashier = (extra: { rights: string[]; off?: string[] }) => (state: State) => {
      withRoles(state);
      state.settings.roles = { ...state.settings.roles, custom: [{ id: 'rol_001', name: 'Cashier', nameAr: 'أمين الصندوق', ...extra }] } as never;
    };

    it('says the standard rights for Member, and everything for the Admin', async () => {
      const { sheet, pick } = await open(withRoles);
      expect(sheet.getByText('Member: the standard rights.')).toBeInTheDocument();
      await pick('admin');
      expect(sheet.getByText('Admin: everything.')).toBeInTheDocument();
    });

    it('says the standard rights for a role that holds exactly the standard list', async () => {
      const { sheet, pick } = await open(cashier({ rights: [], off: [] }));
      await pick('rol_001');
      expect(sheet.getByText('Cashier: the standard rights.')).toBeInTheDocument();
    });

    it('counts the switches beyond the standard list for Management and for a role saved before version 2', async () => {
      const { sheet, pick } = await open(withRoles);
      await pick('management');
      expect(sheet.getByText('Management: standard rights, plus 10.')).toBeInTheDocument();
      await pick('rol_001');
      expect(sheet.getByText('Cashier: standard rights, plus 4.')).toBeInTheDocument();
    });

    it('counts the switches below the standard list too', async () => {
      const { sheet, pick } = await open(cashier({ rights: ['people.invite'], off: ['task.work', 'file.share', 'search.use'] }));
      await pick('rol_001');
      expect(sheet.getByText('Cashier: standard rights, plus 1, without 3.')).toBeInTheDocument();
    });

    it('says only "without" for a role that holds less and nothing more', async () => {
      const { sheet, pick } = await open(cashier({ rights: [], off: ['task.work'] }));
      await pick('rol_001');
      expect(sheet.getByText('Cashier: standard rights, without 1.')).toBeInTheDocument();
    });

    it('follows a Member list that the Admin changed', async () => {
      const { sheet } = await open((state) => {
        withRoles(state);
        state.settings.roles = { ...state.settings.roles, off: { member: ['search.use'] } };
      });
      expect(sheet.getByText('Member: standard rights, without 1.')).toBeInTheDocument();
    });

    it('shows the line in Arabic', async () => {
      const { sheet, pick } = await open((state) => {
        withRoles(state);
        state.users.usr_001.preferences.language = 'ar';
      }, { people: 'الأشخاص', add: 'أضف شخصًا', role: 'الدور' });
      await pick('management');
      expect(sheet.getByText('الإدارة العليا: الصلاحيات المعتادة، وزيادة 10.')).toBeInTheDocument();
    });
  });
});
