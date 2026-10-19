import type { State } from '../../api/store';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { textFieldsOf } from '../../test/browserMemory';
import { renderApp } from '../../test/render';

const LOAD = { timeout: 10_000 };

describe('the edit project form: no browser memory (fbk_010)', () => {
  it('turns off the browser memory on every text field of the edit form and of the New client part', async () => {
    await renderApp('/projects/prj_001');
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, LOAD));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit project' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'New client' }));
    await within(sheet).findByRole('button', { name: 'Add client' });
    await waitFor(() => expect(sheet.querySelector('input[aria-label="Stage 1"]')).not.toBeNull());
    const fields = textFieldsOf(sheet);
    expect(fields.map((field) => field.id || field.getAttribute('aria-label'))).toEqual(expect.arrayContaining([
      'project-area', 'Stage 1', 'project-folder', 'project-description', 'client-contact', 'client-phone', 'client-email',
    ]));
    for (const field of fields) {
      expect(field, field.id || field.getAttribute('aria-label') || 'a field').toHaveAttribute('autocomplete', 'off');
    }
    expect(sheet.querySelector('form')).toHaveAttribute('autocomplete', 'off');
  });
});

describe('the sub-company in the edit form (fbk_007, PRJ-17)', () => {
  const office = (named: boolean) => (state: State) => {
    const created = '2026-10-18T09:00:00.000+03:00';
    state.subCompanies = {
      sub_001: { id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: null, createdBy: 'usr_001', createdAt: created },
      sub_002: { id: 'sub_002', name: 'Bunah', nameAr: 'بناة', logo: null, createdBy: 'usr_001', createdAt: created },
    };
    for (const project of Object.values(state.projects)) delete project.subCompanyId;
    if (named) state.projects.prj_001.subCompanyId = 'sub_002';
  };
  const openEdit = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, LOAD));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }));
    return screen.findByRole('dialog', { name: 'Edit project' });
  };

  it('saves the sub-company that the person taps on a project that has none', async () => {
    const { store } = await renderApp('/projects/prj_001', office(false));
    const sheet = await openEdit();
    const group = await within(sheet).findByRole('radiogroup', { name: 'Sub-company' });
    expect(within(group).getAllByRole('radio').every((radio) => radio.getAttribute('aria-checked') === 'false')).toBe(true);
    await userEvent.click(within(group).getByRole('radio', { name: 'Vado' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.state.projects.prj_001.subCompanyId).toBe('sub_001'));
  });

  it('keeps the sub-company of a project that has one: the project can change it, never clear it', async () => {
    await renderApp('/projects/prj_001', office(true));
    const sheet = await openEdit();
    const group = await within(sheet).findByRole('radiogroup', { name: 'Sub-company' });
    expect(within(group).getByRole('radio', { name: 'Bunah' })).toHaveAttribute('aria-checked', 'true');
    expect(within(sheet).queryByRole('option', { name: 'No sub-company' })).toBeNull();
  });
});

// chats-19 (UX audit 2026-10-19): the end date of a project cannot come before its start date.
describe('the edit project form: the paired dates', () => {
  it('gives the start date to the end date as its first day', async () => {
    await renderApp('/projects/prj_001');
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, LOAD));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit project' });
    const start = (await within(sheet).findByLabelText('Start date')) as HTMLInputElement;
    expect(start.value).not.toBe('');
    const end = within(sheet).getByLabelText('Target end date');
    expect(end).toHaveAttribute('min', start.value);
  });
});

describe('the pin in the edit form (audit 2026-10-19, PRJ-13, PRJ-21)', () => {
  async function openEdit() {
    const app = await renderApp('/projects/prj_001');
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, LOAD));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit project' });
    return { ...app, sheet };
  }

  it('shows the address of the pin with a link to check the place, and no raw numbers', async () => {
    const { sheet } = await openEdit();
    expect(within(sheet).getByText('Location')).toBeInTheDocument();
    expect(within(sheet).getByText('Al Khobar, Corniche')).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps?q=26.2928,50.2172');
    expect(within(sheet).queryByText(/26\.2928/)).toBeNull();
    expect(within(sheet).queryByText('Not saved yet')).toBeNull();
  });

  it('keeps a new place in the form until Save changes, and says so', async () => {
    const { sheet, store } = await openEdit();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Change' }));
    const pinSheet = await screen.findByRole('dialog', { name: 'Pin on the map' });
    fireEvent.change(within(pinSheet).getByLabelText(/^Paste a Google Maps link/), { target: { value: '26.3, 50.1' } });
    await userEvent.click(within(pinSheet).getByRole('button', { name: 'Use this place' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pin on the map' })).toBeNull());
    expect(within(sheet).getByText('Not saved yet')).toBeInTheDocument();
    expect(store.state.projects.prj_001.geo).toEqual({ lat: 26.2928, lng: 50.2172 });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.state.projects.prj_001.geo).toEqual({ lat: 26.3, lng: 50.1 }));
  });

  it('drops the draft when the person presses Cancel in the pin sheet', async () => {
    const { sheet, store } = await openEdit();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Change' }));
    const pinSheet = await screen.findByRole('dialog', { name: 'Pin on the map' });
    fireEvent.change(within(pinSheet).getByLabelText(/^Paste a Google Maps link/), { target: { value: '26.3, 50.1' } });
    await userEvent.click(within(pinSheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pin on the map' })).toBeNull());
    expect(within(sheet).queryByText('Not saved yet')).toBeNull();
    expect(store.state.projects.prj_001.geo).toEqual({ lat: 26.2928, lng: 50.2172 });
  });
});
