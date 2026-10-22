import { describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';

const asMember = (state: State) => {
  state.session.currentUserId = 'usr_005';
};

describe('the sub-pages of the Me tab (prototype, phone)', () => {
  it('shows one section with its title as h1 and the section h2 hidden', async () => {
    phoneMedia(true);
    await renderApp('/me/quiet-hours');
    expect(await screen.findByRole('heading', { level: 1, name: 'When Madar notifies you' })).toBeInTheDocument();
    expect(await screen.findByRole('switch', { name: 'Notify me only in my work hours' })).toHaveAttribute('id', 'quiet-hours');
    expect(screen.getByRole('heading', { level: 2, name: 'When Madar notifies you' })).toHaveClass('sr-only');
  });

  it('shows the profile form', async () => {
    phoneMedia(true);
    await renderApp('/me/profile');
    expect(await screen.findByRole('heading', { level: 1, name: 'Profile' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Name in English')).toBeInTheDocument();
  });

  it('shows the notice switches of the prototype with no Morning summary', async () => {
    phoneMedia(true);
    await renderApp('/me/notices');
    expect(await screen.findByRole('switch', { name: 'Someone mentions me' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Morning summary' })).toBeNull();
  });

  it('shows the Google Calendar page', async () => {
    phoneMedia(true);
    await renderApp('/me/calendar');
    expect(await screen.findByRole('heading', { level: 1, name: 'Google Calendar' })).toBeInTheDocument();
  });

  it('opens What reaches me for the Admin only', async () => {
    phoneMedia(true);
    const first = await renderApp('/me/reach');
    expect(await screen.findByRole('heading', { level: 1, name: 'What reaches me' })).toBeInTheDocument();
    expect(await screen.findAllByRole('radio')).toHaveLength(3);
    first.unmount();
    const second = await renderApp('/me/reach', asMember);
    await waitFor(() => expect(second.router.state.location.pathname).toBe('/me'));
  });

  it('sends a section of the real build to the hub in the prototype', async () => {
    phoneMedia(true);
    const first = await renderApp('/me/password');
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/me'));
    first.unmount();
    const second = await renderApp('/me/agents');
    await waitFor(() => expect(second.router.state.location.pathname).toBe('/me'));
  });

  it('sends an unknown section to the hub', async () => {
    phoneMedia(true);
    const { router } = await renderApp('/me/nonsense');
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'));
  });

  it('goes to the Settings page when the phone turns past 640 px, and the unsaved name is lost by design', async () => {
    const media = phoneMedia(true);
    const { router } = await renderApp('/me/profile');
    const name = await screen.findByLabelText('Name in English');
    await userEvent.clear(name);
    await userEvent.type(name, 'Typed but not saved');
    act(() => media.set(false));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Name in English')).not.toHaveValue('Typed but not saved');
  });
});
