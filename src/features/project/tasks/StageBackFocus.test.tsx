import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const ASK = 'This moves the project back to Design Development. Why?';

/** A screen narrower than 640 px, where a sheet comes up from the bottom. */
function phoneWidth() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === '(max-width: 639px)', media: query, onchange: null,
    addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  }) as MediaQueryList);
}

/** A task added in Design Development moves the project back from Construction Documents, so the server asks why. */
async function askWhy() {
  await renderApp('/projects/prj_001?tab=tasks', as('usr_002'));
  await userEvent.click(await screen.findByRole('button', { name: 'From a template in Design Development' }));
  await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Material board' }));
  return screen.findByRole('dialog', { name: ASK });
}

// The stage-back sheet follows the Sheet rule: on a phone the title takes the focus, so the keyboard does not open over
// the sheet; on a computer the reason box takes it (audit 2026-10-03, S-2).
describe('the focus in the stage-back sheet (audit 2026-10-03, S-2)', () => {
  it('goes to the reason box on a computer', async () => {
    const ask = await askWhy();
    await waitFor(() => expect(within(ask).getByRole('textbox', { name: 'Reason' })).toHaveFocus());
  });

  it('goes to the title on a phone, so the keyboard stays closed', async () => {
    phoneWidth();
    const ask = await askWhy();
    await waitFor(() => expect(within(ask).getByRole('heading', { name: ASK })).toHaveFocus());
    expect(within(ask).getByRole('textbox', { name: 'Reason' })).not.toHaveFocus();
  });
});
