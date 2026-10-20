import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/render';

const openActions = async (name: string) => {
  const people = await screen.findByRole('region', { name: 'People' });
  await userEvent.click(await within(people).findByRole('button', { name: `Actions for ${name}` }));
  return within(screen.getByRole('menu'));
};

// Owner, 2026-10-12: a person who is turned off and will not come back no longer has to stay in the people list. The Admin removes
// them from the list for good. The record stays, so the History keeps the name.
describe('Remove in the People list (owner, 2026-10-12)', () => {
  it('offers Remove for a turned-off person, and not for a person who is on', async () => {
    await renderApp('/admin', (state) => {
      state.users.usr_008.active = false;
    });
    const off = await openActions('Khalid Al-Mutairi');
    expect(off.getByRole('menuitem', { name: 'Remove from the list' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    const on = await openActions('Omar Haddad');
    expect(on.queryByRole('menuitem', { name: 'Remove from the list' })).toBeNull();
    expect(on.getByRole('menuitem', { name: 'Deactivate' })).toBeInTheDocument();
  });

  it('asks first, keeps the person when the Admin cancels, and takes them out of the list when the Admin confirms', async () => {
    const { store } = await renderApp('/admin', (state) => {
      state.users.usr_008.active = false;
    });
    await userEvent.click((await openActions('Khalid Al-Mutairi')).getByRole('menuitem', { name: 'Remove from the list' }));
    const sheet = await screen.findByRole('dialog', { name: 'Remove Khalid Al-Mutairi from the list?' });
    expect(within(sheet).getByText(/Their old to-dos, comments and History keep their name/)).toBeInTheDocument();
    // A double press must not remove: Cancel takes the focus, and the confirm sits on the start side, as in Deactivate.
    expect(within(sheet).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(within(sheet).getByRole('button', { name: 'Remove for good' })).toHaveClass('me-auto');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(store.state.users.usr_008.removed).toBeUndefined();

    await userEvent.click((await openActions('Khalid Al-Mutairi')).getByRole('menuitem', { name: 'Remove from the list' }));
    const again = await screen.findByRole('dialog', { name: 'Remove Khalid Al-Mutairi from the list?' });
    await userEvent.click(within(again).getByRole('button', { name: 'Remove for good' }));
    await waitFor(() => expect(store.state.users.usr_008.removed).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Khalid Al-Mutairi was removed from the list.')).toBeInTheDocument();
    const people = screen.getByRole('region', { name: 'People' });
    await waitFor(() => expect(within(people).queryByText('Khalid Al-Mutairi')).toBeNull());
    // The record stays for the History.
    expect(store.state.users.usr_008.name).toBe('Khalid Al-Mutairi');
  });

  it('removes a turned-off agent too, and the person that it acted for stays', async () => {
    const { store } = await renderApp('/admin', (state) => {
      state.users.usr_009.active = false;
    });
    const people = await screen.findByRole('region', { name: 'People' });
    await within(people).findByText('Madar Assistant');
    await userEvent.click((await openActions('Madar Assistant')).getByRole('menuitem', { name: 'Remove from the list' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Remove Madar Assistant from the list?' })).getByRole('button', { name: 'Remove for good' }));
    await waitFor(() => expect(store.state.users.usr_009.removed).toBe(true));
    await waitFor(() => expect(within(people).queryByText('Madar Assistant')).toBeNull());
    expect(within(people).getByText('Hala Nasser')).toBeInTheDocument();
  });
});
