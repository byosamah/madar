import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const region = (name: string) => screen.findByRole('region', { name });
const openMenu = async (name: string) => {
  await userEvent.click(await within(await region('People')).findByRole('button', { name: `Actions for ${name}` }));
  return screen.getByRole('menu');
};

describe('Admin settings', () => {
  it('shows the Admin sections only to the Admin', async () => {
    const first = await renderApp('/settings');
    for (const name of ['People', 'Office settings']) expect(await region(name)).toBeInTheDocument();
    first.unmount();
    await renderApp('/settings', (state: State) => {
      state.session.currentUserId = 'usr_005';
    });
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    expect(screen.queryByRole('region', { name: 'People' })).toBeNull();
  });

  it('adds a person', async () => {
    const { store } = await renderApp('/settings');
    await userEvent.click(within(await region('People')).getByRole('button', { name: 'Add person' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add person' });
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Nora Salem');
    await userEvent.type(within(sheet).getByLabelText('Email'), 'nora.salem@madar.test');
    await userEvent.type(within(sheet).getByLabelText('Discipline'), 'Landscape');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(Object.values(store.state.users).some((u) => u.name === 'Nora Salem' && u.discipline === 'Landscape')).toBe(true));
  });

  it('deactivates a person, then brings them back with Undo', async () => {
    const { store } = await renderApp('/settings');
    await userEvent.click(within(await openMenu('Omar Haddad')).getByRole('menuitem', { name: 'Deactivate' }));
    await waitFor(() => expect(store.state.users.usr_004.active).toBe(false));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.users.usr_004.active).toBe(true));
  });

  it('offers no Deactivate on my own row, and refuses to drop the last Admin', async () => {
    const { store } = await renderApp('/settings');
    const menu = await openMenu('Hala Nasser');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edit']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit person' });
    await userEvent.selectOptions(within(sheet).getByLabelText('Role'), 'member');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('The office needs at least one Admin.')).toBeInTheDocument();
    expect(store.state.users.usr_001.systemRole).toBe('admin');
  });

  it('saves the office settings', async () => {
    const { store } = await renderApp('/settings');
    const office = await region('Office settings');
    const limit = await within(office).findByLabelText('Workload limit');
    await userEvent.clear(limit);
    await userEvent.type(limit, '12');
    await userEvent.click(within(office).getByRole('button', { name: 'Save office settings' }));
    await waitFor(() => expect(store.state.settings.workloadLimit).toBe(12));
  });

  it('keeps what the Admin typed in the office form when other data changes', async () => {
    const { store, api } = await renderApp('/settings');
    const office = await region('Office settings');
    const limit = await within(office).findByLabelText('Workload limit');
    await userEvent.clear(limit);
    await userEvent.type(limit, '12');
    await api.call('notifications.markAllRead', {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(limit).toHaveValue('12');
    await userEvent.click(within(office).getByRole('button', { name: 'Save office settings' }));
    await waitFor(() => expect(store.state.settings.workloadLimit).toBe(12));
  });

  it('shows why an email cannot be used, under the Email field', async () => {
    await renderApp('/settings');
    await userEvent.click(within(await openMenu('Sara Al-Qahtani')).getByRole('menuitem', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit person' });
    const email = within(sheet).getByLabelText('Email');
    await userEvent.clear(email);
    await userEvent.type(email, 'faisal.al.harbi@madar.test');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('This email is already in use.')).toBeInTheDocument();
  });

  it('offers no Admin role for an agent', async () => {
    await renderApp('/settings');
    await userEvent.click(within(await region('People')).getByRole('button', { name: 'Add person' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add person' });
    expect(within(sheet).getByLabelText('Role')).toBeInTheDocument();
    await userEvent.selectOptions(within(sheet).getByLabelText('Kind'), 'agent');
    expect(within(sheet).queryByLabelText('Role')).toBeNull();
  });

  it('shows Retry when the office settings cannot load, and no empty form', async () => {
    await renderApp('/settings', undefined, { failFirst: 'settings.get' });
    const office = await region('Office settings');
    expect(within(office).queryByLabelText('Workload limit')).toBeNull();
    await userEvent.click(await within(office).findByRole('button', { name: 'Retry' }));
    expect(await within(office).findByLabelText('Workload limit')).toHaveValue('10');
  });

  it('shows Retry when the people list cannot load', async () => {
    await renderApp('/settings', undefined, { failFirst: (name, input) => name === 'users.list' && (input as { includeInactive?: boolean }).includeInactive === true });
    const people = await region('People');
    await userEvent.click(await within(people).findByRole('button', { name: 'Retry' }));
    expect(await within(people).findByText('Sara Al-Qahtani')).toBeInTheDocument();
  });

  it('says what is wrong with the office settings under the fields', async () => {
    const { store } = await renderApp('/settings');
    const office = await region('Office settings');
    const limit = await within(office).findByLabelText('Workload limit');
    await userEvent.clear(limit);
    await userEvent.type(limit, '0');
    await userEvent.click(within(office).getByRole('button', { name: 'Save office settings' }));
    expect(await within(office).findByText('Use a whole number from 1 to 100.')).toBeInTheDocument();
    expect(store.state.settings.workloadLimit).toBe(10);
  });

  it('keeps the Arabic form of address of a new person', async () => {
    const { store } = await renderApp('/settings');
    await userEvent.click(within(await region('People')).getByRole('button', { name: 'Add person' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add person' });
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Nora Salem');
    await userEvent.type(within(sheet).getByLabelText('Email'), 'nora.salem@madar.test');
    await userEvent.type(within(sheet).getByLabelText('Discipline'), 'Landscape');
    await userEvent.selectOptions(within(sheet).getByLabelText('Form of address in Arabic'), 'female');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(Object.values(store.state.users).find((u) => u.name === 'Nora Salem')?.gender).toBe('female'));
  });
});
