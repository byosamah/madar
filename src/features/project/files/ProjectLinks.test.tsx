import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { textFieldsOf } from '../../../test/browserMemory';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

describe('the link form: no browser memory (fbk_010)', () => {
  it('turns off the browser memory on every text field of the link form', async () => {
    await renderApp('/projects/prj_001?tab=files', as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Add a link' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add a link' });
    const fields = textFieldsOf(sheet);
    expect(fields.map((field) => field.id)).toEqual(expect.arrayContaining(['link-label', 'link-url']));
    for (const field of fields) {
      expect(field, field.id).toHaveAttribute('autocomplete', 'off');
    }
    expect(sheet.querySelector('form')).toHaveAttribute('autocomplete', 'off');
  });
});
