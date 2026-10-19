import type { State } from '../../api/store';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
      'project-location', 'project-area', 'Stage 1', 'project-folder', 'project-description', 'client-contact', 'client-phone', 'client-email',
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
