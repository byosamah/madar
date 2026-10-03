import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

// The prototype build (the default flag of the tests) keeps every prototype control (plan U3).
describe('the prototype controls in the prototype build (plan U3)', () => {
  it('keeps the Prototype section with Preview as, Simulate errors and Reset, and has no Password section', async () => {
    await renderApp('/settings');
    expect(await screen.findByRole('heading', { level: 2, name: 'Prototype' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Preview as/ })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Simulate errors' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset sample data' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Password' })).toBeNull();
  });

  it('keeps Preview as in the person menu, with no Sign out', async () => {
    await renderApp('/dashboard');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]);
    const menu = screen.getByRole('dialog', { name: 'Hala Nasser' });
    expect(within(menu).getByRole('combobox', { name: /Preview as/ })).toBeInTheDocument();
    expect(within(menu).queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('keeps the agent fields of the person form, adds the Language choice and asks for no invitations', async () => {
    const { api } = await renderApp('/admin');
    const call = vi.spyOn(api, 'call');
    await userEvent.click(await screen.findByRole('button', { name: 'Add person' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add person' });
    expect(within(sheet).getByLabelText('Kind')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Language')).toHaveValue('en');
    await userEvent.selectOptions(within(sheet).getByLabelText('Kind'), 'agent');
    expect(within(sheet).getByLabelText('Acts for')).toBeInTheDocument();
    // An agent signs in with no invitation, so its form has no Language choice.
    expect(within(sheet).queryByLabelText('Language')).toBeNull();
    expect(call.mock.calls.some(([name]) => name === 'users.invites')).toBe(false);
    expect(screen.queryByText('Invited')).toBeNull();
  });

  it('keeps the line about browser storage when the office lives in memory only', async () => {
    await renderApp('/dashboard');
    expect(await screen.findByText('Changes will not be saved in this window.')).toBeInTheDocument();
    expect(screen.queryByText(/No connection/)).toBeNull();
  });
});
