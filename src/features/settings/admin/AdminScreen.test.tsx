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

describe('the Admin page', () => {
  it('shows the Admin sections only to the Admin, and Settings no longer holds them', async () => {
    const first = await renderApp('/admin');
    for (const name of ['People', 'Office settings']) expect(await region(name)).toBeInTheDocument();
    first.unmount();
    await renderApp('/admin', (state: State) => {
      state.session.currentUserId = 'usr_005';
    });
    expect(await screen.findByText('Only the Admin and Management can open this page.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'People' })).toBeNull();
  });

  it('adds a person', async () => {
    const { store } = await renderApp('/admin');
    await userEvent.click(within(await region('People')).getByRole('button', { name: 'Add person' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add person' });
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Nora Salem');
    await userEvent.type(within(sheet).getByLabelText('Email'), 'nora.salem@madar.test');
    await userEvent.type(within(sheet).getByLabelText('Discipline'), 'Landscape');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(Object.values(store.state.users).some((u) => u.name === 'Nora Salem' && u.discipline === 'Landscape')).toBe(true));
  });

  it('deactivates a person, then brings them back with Undo', async () => {
    const { store } = await renderApp('/admin');
    await userEvent.click(within(await openMenu('Omar Haddad')).getByRole('menuitem', { name: 'Deactivate' }));
    await waitFor(() => expect(store.state.users.usr_004.active).toBe(false));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.users.usr_004.active).toBe(true));
  });

  it('offers no Deactivate on my own row, and refuses to drop the last Admin', async () => {
    const { store } = await renderApp('/admin');
    const menu = await openMenu('Hala Nasser');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edit']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit person' });
    await userEvent.selectOptions(within(sheet).getByLabelText('Role'), 'member');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('The office needs at least one Admin.')).toBeInTheDocument();
    expect(store.state.users.usr_001.systemRole).toBe('admin');
  });

  it('lists the stage templates and lets the Admin delete one, with Undo', async () => {
    const { store } = await renderApp('/admin');
    const section = await region('Stage templates');
    expect(await within(section).findByText('Interior fit-out')).toBeInTheDocument();
    expect(within(section).getByText('Brief · Concept · Presentation')).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'Actions for template Competition entry' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(Object.values(store.state.stageTemplates ?? {}).map((tpl) => tpl.name)).toEqual(['Interior fit-out']));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(Object.keys(store.state.stageTemplates ?? {})).toHaveLength(2));
  });

  it('lists the task templates by stage, and lets the Admin rename and delete one, with Undo', async () => {
    const { store } = await renderApp('/admin');
    const section = await region('Task templates');
    const stage = await within(section).findByRole('group', { name: 'Construction Documents' });
    expect(within(stage).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Construction Documents']);
    expect(within(stage).getByText('Floor plans set')).toBeInTheDocument();
    expect(within(stage).getByText('Ground floor · Typical floor · Roof plan')).toBeInTheDocument();
    expect(within(await within(section).findByRole('group', { name: 'Permits' })).getByText('Balady submission pack')).toBeInTheDocument();
    expect(within(stage).queryByText('Balady submission pack')).toBeNull();
    await userEvent.click(within(section).getByRole('button', { name: 'Actions for template Floor plans set' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Rename' }));
    const name = within(section).getByLabelText('Template name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Plans set{Enter}');
    await waitFor(() => expect(Object.values(store.state.taskTemplates ?? {}).some((tpl) => tpl.name === 'Plans set')).toBe(true));
    await userEvent.click(await within(section).findByRole('button', { name: 'Actions for template Plans set' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(Object.values(store.state.taskTemplates ?? {}).some((tpl) => tpl.name === 'Plans set')).toBe(false));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(Object.values(store.state.taskTemplates ?? {}).some((tpl) => tpl.name === 'Plans set')).toBe(true));
  });

  it('saves the office settings', async () => {
    const { store } = await renderApp('/admin');
    const office = await region('Office settings');
    const limit = await within(office).findByLabelText('Workload limit');
    await userEvent.clear(limit);
    await userEvent.type(limit, '12');
    await userEvent.click(within(office).getByRole('button', { name: 'Save office settings' }));
    await waitFor(() => expect(store.state.settings.workloadLimit).toBe(12));
  });

  it('keeps what the Admin typed in the office form when other data changes', async () => {
    const { store, api } = await renderApp('/admin');
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
    await renderApp('/admin');
    await userEvent.click(within(await openMenu('Sara Al-Qahtani')).getByRole('menuitem', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit person' });
    const email = within(sheet).getByLabelText('Email');
    await userEvent.clear(email);
    await userEvent.type(email, 'faisal.al.harbi@madar.test');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('This email is already in use.')).toBeInTheDocument();
  });

  it('offers no Admin role for an agent', async () => {
    await renderApp('/admin');
    await userEvent.click(within(await region('People')).getByRole('button', { name: 'Add person' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add person' });
    expect(within(sheet).getByLabelText('Role')).toBeInTheDocument();
    await userEvent.selectOptions(within(sheet).getByLabelText('Kind'), 'agent');
    expect(within(sheet).queryByLabelText('Role')).toBeNull();
  });

  it('shows Retry when the office settings cannot load, and no empty form', async () => {
    await renderApp('/admin', undefined, { failFirst: 'settings.get' });
    const office = await region('Office settings');
    expect(within(office).queryByLabelText('Workload limit')).toBeNull();
    await userEvent.click(await within(office).findByRole('button', { name: 'Retry' }));
    expect(await within(office).findByLabelText('Workload limit')).toHaveValue('10');
  });

  it('shows Retry when the people list cannot load', async () => {
    await renderApp('/admin', undefined, { failFirst: (name, input) => name === 'users.list' && (input as { includeInactive?: boolean }).includeInactive === true });
    const people = await region('People');
    await userEvent.click(await within(people).findByRole('button', { name: 'Retry' }));
    expect(await within(people).findByText('Sara Al-Qahtani')).toBeInTheDocument();
  });

  it('says what is wrong with the office settings under the fields', async () => {
    const { store } = await renderApp('/admin');
    const office = await region('Office settings');
    const limit = await within(office).findByLabelText('Workload limit');
    await userEvent.clear(limit);
    await userEvent.type(limit, '0');
    await userEvent.click(within(office).getByRole('button', { name: 'Save office settings' }));
    expect(await within(office).findByText('Use a whole number from 1 to 100.')).toBeInTheDocument();
    expect(store.state.settings.workloadLimit).toBe(10);
  });

  it('keeps the Arabic form of address of a new person', async () => {
    const { store } = await renderApp('/admin');
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

describe('the person menu', () => {
  it('links the Admin to the Admin page, and nobody else', async () => {
    const first = await renderApp('/');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]);
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '#/admin');
    first.unmount();
    await renderApp('/', (state: State) => {
      state.session.currentUserId = 'usr_005';
    });
    await userEvent.click((await screen.findAllByRole('button', { name: 'Sara Al-Qahtani' }))[0]);
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });
});

// Management and Accounting (colleague comments 6 and 13). Turki (usr_010) is Management, Noura (usr_011) is Accounting.
describe('the Admin page for Management and Accounting', () => {
  const as = (userId: string) => (state: State) => {
    state.session.currentUserId = userId;
  };

  it('shows the role of each person in the people list', async () => {
    await renderApp('/admin');
    const people = await region('People');
    const turki = (await within(people).findByText('Turki Al-Otaibi')).closest('li') as HTMLElement;
    expect(turki).toHaveTextContent('· Management ·');
    const noura = within(people).getByText('Noura Al-Shammari').closest('li') as HTMLElement;
    expect(noura).toHaveTextContent('· Accounting ·');
    const hala = within(people).getByText('Hala Nasser').closest('li') as HTMLElement;
    expect(hala).toHaveTextContent('· Admin ·');
  });

  it('gives the Admin four roles in the form, and saves the Accounting role', async () => {
    const { store } = await renderApp('/admin');
    await userEvent.click(within(await region('People')).getByRole('button', { name: 'Add person' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add person' });
    const role = within(sheet).getByLabelText('Role');
    expect(within(role).getAllByRole('option').map((option) => option.textContent)).toEqual(['Member', 'Management', 'Accounting', 'Admin']);
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Nora Salem');
    await userEvent.type(within(sheet).getByLabelText('Email'), 'nora.salem@madar.test');
    await userEvent.type(within(sheet).getByLabelText('Discipline'), 'Finance');
    await userEvent.selectOptions(role, 'accounting');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(Object.values(store.state.users).find((u) => u.name === 'Nora Salem')?.systemRole).toBe('accounting'));
  });

  it('shows Management the People section only, with no Admin role to give', async () => {
    const { store } = await renderApp('/admin', as('usr_010'));
    const people = await region('People');
    expect(screen.queryByRole('region', { name: 'Office settings' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Stage templates' })).toBeNull();
    expect(screen.queryByText('Only the Admin and Management can open this page.')).toBeNull();
    await userEvent.click(within(people).getByRole('button', { name: 'Add person' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add person' });
    expect(within(within(sheet).getByLabelText('Role')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Member', 'Management', 'Accounting']);
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Nora Salem');
    await userEvent.type(within(sheet).getByLabelText('Email'), 'nora.salem@madar.test');
    await userEvent.type(within(sheet).getByLabelText('Discipline'), 'Landscape');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(Object.values(store.state.users).some((u) => u.name === 'Nora Salem' && u.systemRole === 'member')).toBe(true));
  });

  it('lets Management change a role, and offers no actions on an Admin', async () => {
    const { store } = await renderApp('/admin', as('usr_010'));
    const people = await region('People');
    expect(within(people).queryByRole('button', { name: 'Actions for Hala Nasser' })).toBeNull();
    await userEvent.click(await within(people).findByRole('button', { name: 'Actions for Omar Haddad' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit person' });
    await userEvent.selectOptions(within(sheet).getByLabelText('Role'), 'accounting');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.state.users.usr_004.systemRole).toBe('accounting'));
  });

  it('tells Accounting and a member the page is not theirs', async () => {
    for (const user of ['usr_011', 'usr_005']) {
      const view = await renderApp('/admin', as(user));
      expect(await screen.findByText('Only the Admin and Management can open this page.')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'People' })).toBeNull();
      view.unmount();
    }
  });

  it('links Management to the Admin page, and Accounting not', async () => {
    const first = await renderApp('/', as('usr_010'));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Turki Al-Otaibi' }))[0]);
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '#/admin');
    first.unmount();
    await renderApp('/', as('usr_011'));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Noura Al-Shammari' }))[0]);
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });

  it('lets the owner preview as a Management person and an Accounting person', async () => {
    const { store } = await renderApp('/');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]);
    const select = within(screen.getByRole('dialog', { name: 'Hala Nasser' })).getByRole('combobox', { name: /Preview as/ });
    expect(within(select).getByRole('option', { name: 'Turki Al-Otaibi · Management' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Noura Al-Shammari · Accounting' })).toBeInTheDocument();
    await userEvent.selectOptions(select, 'usr_011');
    await waitFor(() => expect(store.state.session.currentUserId).toBe('usr_011'));
  });
});
