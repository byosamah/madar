import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

  it('says what the stale refusal counts: how many projects name the sub-company (INT-24)', async () => {
    const { store } = await renderApp('/admin/sub-companies');
    await addSubCompany('Vado', 'فادو');
    const [vado] = Object.values(store.state.subCompanies ?? {});
    for (const id of ['prj_001', 'prj_002', 'prj_003']) Object.assign(store.state.projects[id], { subCompanyId: vado.id });
    await userEvent.click(await within(await region('Sub-companies')).findByRole('button', { name: 'Actions for Vado' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete sub-company' }));
    expect(await screen.findByText('3 projects use this sub-company. Change the projects first.')).toBeInTheDocument();
  });
});

/** An office with two sub-companies: Vado names the first two projects, Bunah names none. */
function twoCompanies(state: State) {
  const at = '2026-10-18T09:00:00.000+03:00';
  state.subCompanies = {
    sub_001: { id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: null, createdBy: 'usr_001', createdAt: at },
    sub_002: { id: 'sub_002', name: 'Bunah', nameAr: 'بناة', logo: null, createdBy: 'usr_001', createdAt: at },
  };
  for (const project of Object.values(state.projects)) delete project.subCompanyId;
  for (const id of ['prj_001', 'prj_002']) Object.assign(state.projects[id], { subCompanyId: 'sub_001' });
}

describe('the rows and the delete of a used sub-company (PRJ-12)', () => {
  it('shows the number of projects under each name, as a link to the filtered Projects list', async () => {
    await renderApp('/admin/sub-companies', twoCompanies);
    const section = await region('Sub-companies');
    const link = await within(section).findByRole('link', { name: '2 projects' });
    expect(link).toHaveAttribute('href', expect.stringContaining('/projects?subCompany=sub_001'));
    expect(within(section).getByText('No projects')).toBeInTheDocument();
  });

  it('asks where the projects go, moves them, deletes the sub-company, and one Undo brings everything back', async () => {
    const { store } = await renderApp('/admin/sub-companies', twoCompanies);
    await userEvent.click(await within(await region('Sub-companies')).findByRole('button', { name: 'Actions for Vado' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete sub-company' }));
    const sheet = await screen.findByRole('dialog', { name: 'Delete Vado' });
    expect(within(sheet).getByText('2 projects use this sub-company.')).toBeInTheDocument();
    expect(within(sheet).getByRole('combobox', { name: 'Move the projects to' })).toHaveValue('sub_002');
    expect(within(sheet).getByRole('link', { name: 'Show the projects' })).toHaveAttribute('href', expect.stringContaining('/projects?subCompany=sub_001'));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Move and delete' }));
    await waitFor(() => expect(names(store)).toEqual(['Bunah']));
    expect(store.state.projects.prj_001.subCompanyId).toBe('sub_002');
    expect(store.state.projects.prj_002.subCompanyId).toBe('sub_002');
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(names(store)).toEqual(['Bunah', 'Vado']));
    expect(store.state.projects.prj_001.subCompanyId).toBe('sub_001');
  });

  it('can move the projects to no sub-company', async () => {
    const { store } = await renderApp('/admin/sub-companies', twoCompanies);
    await userEvent.click(await within(await region('Sub-companies')).findByRole('button', { name: 'Actions for Vado' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete sub-company' }));
    const sheet = await screen.findByRole('dialog', { name: 'Delete Vado' });
    await userEvent.selectOptions(within(sheet).getByRole('combobox', { name: 'Move the projects to' }), 'none');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Move and delete' }));
    await waitFor(() => expect(names(store)).toEqual(['Bunah']));
    expect(store.state.projects.prj_001.subCompanyId ?? null).toBeNull();
  });

  it('deletes a sub-company with no project at once, as before', async () => {
    const { store } = await renderApp('/admin/sub-companies', twoCompanies);
    await userEvent.click(await within(await region('Sub-companies')).findByRole('button', { name: 'Actions for Bunah' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete sub-company' }));
    await waitFor(() => expect(names(store)).toEqual(['Vado']));
    expect(screen.queryByRole('dialog', { name: 'Delete Bunah' })).toBeNull();
  });
});

describe('the sheet of a sub-company (PRJ-16)', () => {
  it('marks both names as required, keeps Save on, and puts Cancel before it', async () => {
    await renderApp('/admin/sub-companies');
    await userEvent.click(within(await region('Sub-companies')).getByRole('button', { name: 'New sub-company' }));
    const sheet = await screen.findByRole('dialog', { name: 'New sub-company' });
    expect(within(sheet).getByLabelText('English name')).toHaveAccessibleDescription(/required/i);
    expect(within(sheet).getByLabelText('Arabic name')).toHaveAccessibleDescription(/required/i);
    const buttons = within(sheet).getAllByRole('button').map((button) => button.textContent);
    expect(buttons.indexOf('Cancel')).toBeGreaterThanOrEqual(0);
    expect(buttons.indexOf('Cancel')).toBeLessThan(buttons.indexOf('Save'));
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('says which name is missing on Save, and moves the focus there', async () => {
    const { store } = await renderApp('/admin/sub-companies');
    await userEvent.click(within(await region('Sub-companies')).getByRole('button', { name: 'New sub-company' }));
    const sheet = await screen.findByRole('dialog', { name: 'New sub-company' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('Write the English name.')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('English name')).toHaveFocus();
    await userEvent.type(within(sheet).getByLabelText('English name'), 'Vado');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('Write the Arabic name.')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Arabic name')).toHaveFocus();
    expect(names(store)).toEqual([]);
  });

  it('closes with Cancel and saves nothing', async () => {
    const { store } = await renderApp('/admin/sub-companies');
    await userEvent.click(within(await region('Sub-companies')).getByRole('button', { name: 'New sub-company' }));
    const sheet = await screen.findByRole('dialog', { name: 'New sub-company' });
    await userEvent.type(within(sheet).getByLabelText('English name'), 'Vado');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New sub-company' })).toBeNull());
    expect(names(store)).toEqual([]);
  });
});

describe('the frame of a logo (PRJ-11)', () => {
  it('shows a frame step after a picture is chosen, and saves the logo again when the zoom changes', async () => {
    const created = vi.fn(() => 'blob:logo');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    vi.mocked(pictureOf).mockClear();
    await renderApp('/admin/sub-companies');
    await userEvent.click(within(await region('Sub-companies')).getByRole('button', { name: 'New sub-company' }));
    const sheet = await screen.findByRole('dialog', { name: 'New sub-company' });
    const file = new File(['logo'], 'wide.png', { type: 'image/png' });
    await userEvent.upload(within(sheet).getByLabelText('Logo'), file);
    const frame = await within(sheet).findByRole('group', { name: 'Frame the logo' });
    const image = frame.querySelector('img')!;
    Object.defineProperty(image, 'naturalWidth', { value: 400 });
    Object.defineProperty(image, 'naturalHeight', { value: 200 });
    fireEvent.load(image);
    fireEvent.change(within(frame).getByRole('slider', { name: 'Zoom' }), { target: { value: '2' } });
    await waitFor(() => expect(pictureOf).toHaveBeenLastCalledWith(file, { fit: 'contain', crop: { zoom: 2, cx: 0.5, cy: 0.5 } }));
    // The preview shows the logo at the sizes of the lists.
    expect(within(sheet).getByText('How it looks in the lists')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

