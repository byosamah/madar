import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/render';

const people = () => screen.findByRole('region', { name: 'People' });

/** The Admin person sheet asks for the name in English and in Arabic (owner item 12, 2026-10-05). */
describe('the names of a person in the Admin sheet', () => {
  it('needs both names for a new person, each marked as required, and saves both', async () => {
    const { store } = await renderApp('/admin');
    await userEvent.click(within(await people()).getByRole('button', { name: 'Add person' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add person' });
    const english = within(sheet).getByLabelText('Name in English');
    const arabic = within(sheet).getByLabelText('Name in Arabic');
    expect(english).toHaveAccessibleDescription(/required/i);
    expect(arabic).toHaveAccessibleDescription(/required/i);
    await userEvent.type(english, 'Nora Salem');
    await userEvent.type(within(sheet).getByLabelText('Email'), 'nora.salem@madar.test');
    await userEvent.type(within(sheet).getByLabelText('Discipline'), 'Landscape');
    const save = within(sheet).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await userEvent.type(arabic, 'نورة سالم');
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(Object.values(store.state.users).find((u) => u.name === 'Nora Salem')?.nameAr).toBe('نورة سالم'));
  });

  it('shows both names when the Admin edits a person; an Arabic name is not needed to save other changes', async () => {
    const { store } = await renderApp('/admin', (state) => {
      state.users.usr_004.nameAr = undefined;
    });
    await userEvent.click(await within(await people()).findByRole('button', { name: 'Actions for Omar Haddad' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit person' });
    expect(within(sheet).getByLabelText('Name in English')).toHaveValue('Omar Haddad');
    const arabic = within(sheet).getByLabelText('Name in Arabic');
    expect(arabic).toHaveValue('');
    const discipline = within(sheet).getByLabelText('Discipline');
    await userEvent.clear(discipline);
    await userEvent.type(discipline, 'Civil');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.state.users.usr_004.discipline).toBe('Civil'));
    expect(store.state.users.usr_004.nameAr).toBeUndefined();
  });

  it('saves a new Arabic name of a person', async () => {
    const { store } = await renderApp('/admin', (state) => {
      state.users.usr_004.nameAr = undefined;
    });
    await userEvent.click(await within(await people()).findByRole('button', { name: 'Actions for Omar Haddad' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit person' });
    await userEvent.type(within(sheet).getByLabelText('Name in Arabic'), 'عمر حداد');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.state.users.usr_004.nameAr).toBe('عمر حداد'));
  });
});
