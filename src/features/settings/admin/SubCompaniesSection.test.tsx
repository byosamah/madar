import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { pictureOf } from '../../../lib/picture';
import { renderApp } from '../../../test/render';

vi.mock('../../../lib/picture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/picture')>()),
  pictureOf: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
}));

const region = (name: string) => screen.findByRole('region', { name });
const names = (store: { state: State }) => Object.values(store.state.subCompanies ?? {}).map((item) => item.name).sort();

/** Opens the New sub-company sheet, fills the two names and saves it. */
async function addSubCompany(name: string, nameAr: string) {
  await userEvent.click(within(await region('Sub-companies')).getByRole('button', { name: 'New sub-company' }));
  const sheet = await screen.findByRole('dialog', { name: 'New sub-company' });
  await userEvent.type(within(sheet).getByLabelText('English name'), name);
  await userEvent.type(within(sheet).getByLabelText('Arabic name'), nameAr);
  await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New sub-company' })).toBeNull());
}

describe('the Sub-companies section', () => {
  it('shows the empty text while the office has no sub-company', async () => {
    await renderApp('/admin/sub-companies');
    expect(within(await region('Sub-companies')).getByText('No sub-companies yet. Add the first one.')).toBeInTheDocument();
  });

  it('makes a sub-company with an English name and an Arabic name, and no logo', async () => {
    const { store } = await renderApp('/admin/sub-companies');
    await addSubCompany('Vado', 'فادو');
    await waitFor(() => expect(names(store)).toEqual(['Vado']));
    expect(Object.values(store.state.subCompanies ?? {})[0]).toMatchObject({ name: 'Vado', nameAr: 'فادو', logo: null, createdBy: 'usr_001' });
    expect(await within(await region('Sub-companies')).findByText('Vado')).toBeInTheDocument();
  });

  it('shows a refused name under the English field, and keeps the sheet open', async () => {
    const { store } = await renderApp('/admin/sub-companies');
    await addSubCompany('Vado', 'فادو');
    await userEvent.click(within(await region('Sub-companies')).getByRole('button', { name: 'New sub-company' }));
    const sheet = await screen.findByRole('dialog', { name: 'New sub-company' });
    await userEvent.type(within(sheet).getByLabelText('English name'), 'vado');
    await userEvent.type(within(sheet).getByLabelText('Arabic name'), 'شركة');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('A sub-company with this name exists. Use another name.')).toBeInTheDocument();
    expect(names(store)).toEqual(['Vado']);
  });

  it('takes a logo that fits inside the circle, and saves it with the names', async () => {
    const { store } = await renderApp('/admin/sub-companies');
    await userEvent.click(within(await region('Sub-companies')).getByRole('button', { name: 'New sub-company' }));
    const sheet = await screen.findByRole('dialog', { name: 'New sub-company' });
    await userEvent.type(within(sheet).getByLabelText('English name'), 'Bunah');
    await userEvent.type(within(sheet).getByLabelText('Arabic name'), 'بناة');
    const file = new File(['logo'], 'bunah.png', { type: 'image/png' });
    await userEvent.upload(within(sheet).getByLabelText('Logo'), file);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(names(store)).toEqual(['Bunah']));
    expect(pictureOf).toHaveBeenCalledWith(file, { fit: 'contain' });
    expect(Object.values(store.state.subCompanies ?? {})[0].logo).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('edits the names of a sub-company', async () => {
    const { store } = await renderApp('/admin/sub-companies');
    await addSubCompany('Vado', 'فادو');
    await userEvent.click(await within(await region('Sub-companies')).findByRole('button', { name: 'Actions for Vado' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit sub-company' });
    const field = within(sheet).getByLabelText('English name');
    expect(field).toHaveValue('Vado');
    await userEvent.clear(field);
    await userEvent.type(field, 'Vado Group');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(names(store)).toEqual(['Vado Group']));
  });

  it('deletes a sub-company, then brings it back with Undo', async () => {
    const { store } = await renderApp('/admin/sub-companies');
    await addSubCompany('Vado', 'فادو');
    await userEvent.click(await within(await region('Sub-companies')).findByRole('button', { name: 'Actions for Vado' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete sub-company' }));
    await waitFor(() => expect(names(store)).toEqual([]));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(names(store)).toEqual(['Vado']));
  });

  it('refuses to delete a sub-company that a project names, and says so', async () => {
    const { store } = await renderApp('/admin/sub-companies');
    await addSubCompany('Vado', 'فادو');
    const [vado] = Object.values(store.state.subCompanies ?? {});
    Object.assign(store.state.projects.prj_001, { subCompanyId: vado.id });
    await userEvent.click(await within(await region('Sub-companies')).findByRole('button', { name: 'Actions for Vado' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete sub-company' }));
    expect(await screen.findByText('A project uses this sub-company. Change the project first.')).toBeInTheDocument();
    expect(names(store)).toEqual(['Vado']);
  });
});
