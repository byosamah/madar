import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
});
