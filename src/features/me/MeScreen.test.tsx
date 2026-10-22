import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeLive } from '../../test/fakeLive';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';

const hub = async (prepare?: Parameters<typeof renderApp>[1], options?: Parameters<typeof renderApp>[2]) => {
  phoneMedia(true);
  const view = await renderApp('/me', prepare, options);
  await screen.findByRole('link', { name: /Hala Nasser/ });
  return view;
};

describe('the Me hub (prototype, phone)', () => {
  it('draws the hub title on a phone', async () => {
    phoneMedia(true);
    await renderApp('/me');
    expect(await screen.findByRole('heading', { level: 1, name: 'Me' })).toBeInTheDocument();
  });

  it('draws the profile row with the name, the role and the picture line', async () => {
    await hub();
    const link = screen.getByRole('link', { name: /Hala Nasser/ });
    expect(link).toHaveAttribute('href', '#/me/profile');
    expect(link).toHaveTextContent('Admin');
    expect(link).toHaveTextContent('Picture, names, discipline');
  });

  it('has no Away row without a live port, and one with it', async () => {
    const first = await hub();
    expect(screen.queryByRole('switch', { name: 'Show me as Away' })).toBeNull();
    first.unmount();
    const live = fakeLive({ usr_001: 'online' }, ['usr_001']);
    const { store } = await hub(undefined, { live: live.port });
    const toggle = await screen.findByRole('switch', { name: 'Show me as Away' });
    expect(toggle).toHaveAccessibleDescription('Online');
    await userEvent.click(toggle);
    await waitFor(() => expect(store.state.users.usr_001.preferences.awayByHand).toBe(true));
  });

  it('puts Language and Theme under the group word Settings', async () => {
    await hub();
    const group = screen.getByRole('group', { name: 'Settings' });
    expect(within(group).getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument();
    expect(within(group).getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
  });

  it('switches the theme in place', async () => {
    await hub();
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });

  it('switches the language and turns the page', async () => {
    await hub();
    await userEvent.click(screen.getByRole('radio', { name: 'العربية' }));
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
  });

  it('draws only the title while the session has no answer', async () => {
    phoneMedia(true);
    await renderApp('/me', undefined, { latencyMs: 400 });
    expect(await screen.findByRole('heading', { level: 1, name: 'Me' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Hala Nasser/ })).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('has the Quiet hours, Notifications and Google Calendar rows and no real-build rows', async () => {
    await hub();
    expect(screen.getByRole('link', { name: /Quiet hours/ })).toHaveAttribute('href', '#/me/quiet-hours');
    expect(screen.getByRole('link', { name: /Notifications/ })).toHaveAttribute('href', '#/me/notices');
    expect(screen.getByRole('link', { name: /Google Calendar/ })).toHaveAttribute('href', '#/me/calendar');
    expect(screen.queryByRole('switch', { name: 'Morning summary' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Notify me on this device' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Password/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Agents/ })).toBeNull();
  });

  it('shows the quiet range and the notice line', async () => {
    await hub();
    expect(await screen.findByText('Sunday to Thursday, outside 9:00 AM to 5:00 PM')).toBeInTheDocument();
    expect(screen.getByText('In the app')).toBeInTheDocument();
  });

  it('shows What reaches me to the Admin only', async () => {
    const first = await hub();
    const link = await screen.findByRole('link', { name: /What reaches me/ });
    expect(link).toHaveAttribute('href', '#/me/reach');
    expect(link).toHaveTextContent('My work, and the rest in the list');
    first.unmount();
    phoneMedia(true);
    await renderApp('/me', (state) => {
      state.session.currentUserId = 'usr_005';
    });
    await screen.findByRole('link', { name: /Quiet hours/ });
    expect(screen.queryByRole('link', { name: /What reaches me/ })).toBeNull();
  });

  it('shows Dashboard, Admin, the What\'s new row and the feedback row to the Admin', async () => {
    await hub();
    const office = screen.getByRole('group', { name: 'Office' });
    expect(within(office).getByRole('link', { name: /Dashboard/ })).toHaveAttribute('href', '#/dashboard');
    expect(within(office).getByRole('link', { name: /Dashboard/ })).toHaveTextContent('The numbers and what needs attention');
    const admin = within(office).getByRole('link', { name: /^Admin/ });
    expect(admin).toHaveAttribute('href', '#/admin');
    expect(admin).toHaveTextContent('Best on a computer');
    expect(within(office).getByRole('link', { name: /What's new/ })).toHaveAttribute('href', '#/whats-new');
    expect(within(office).getByRole('button', { name: 'Request a feature or report a bug' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Password/ })).toBeNull();
  });

  it('draws the Prototype group with Preview as at the end', async () => {
    await hub();
    const office = screen.getByRole('group', { name: 'Office' });
    const prototype = screen.getByRole('group', { name: 'Prototype' });
    expect(office.compareDocumentPosition(prototype) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(prototype).getByRole('combobox', { name: /Preview as/ })).toBeInTheDocument();
    expect(within(prototype).getByRole('switch', { name: 'Simulate errors' })).toBeInTheDocument();
    expect(within(prototype).getByRole('button', { name: 'Reset sample data' })).toBeInTheDocument();
  });

  it('shows the word New on the What\'s new row until the page is seen', async () => {
    localStorage.setItem('madar.whatsNewSeen.usr_001', 'an-older-entry');
    const { router } = await hub();
    const row = () => screen.getByRole('link', { name: /What's new/ });
    expect(row()).toHaveTextContent('New');
    await userEvent.click(row());
    await waitFor(() => expect(router.state.location.pathname).toBe('/whats-new'));
    await act(async () => { await router.navigate('/me'); });
    expect(await screen.findByRole('link', { name: /What's new/ })).not.toHaveTextContent('New');
  });

  it('opens the feedback sheet from its row and gives the focus back', async () => {
    await hub();
    const row = screen.getByRole('button', { name: 'Request a feature or report a bug' });
    await userEvent.click(row);
    const sheet = await screen.findByRole('dialog', { name: 'Request a feature or report a bug' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Request a feature or report a bug' })).toBeNull());
    await waitFor(() => expect(row).toHaveFocus());
  });
});
