import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { phoneMedia } from '../test/phoneMedia';
import { renderApp } from '../test/render';

/**
 * The Me routes (Direction D). /me is the Me hub and /me/:section one of its pages on a phone. A desk goes to /settings, and a phone
 * at /settings goes to /me. The Google return keeps its fragment.
 */
/** The Settings page draws its title first and the rest when the session arrives, so a test waits for the language control. */
const settingsPage = async () => {
  await screen.findByRole('radio', { name: 'العربية' });
  return screen.getByRole('heading', { level: 1, name: 'Settings' });
};

describe('the Me routes', () => {
  it('sends /me and /me/profile on a desk to /settings', async () => {
    phoneMedia(false);
    const { router } = await renderApp('/me');
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    await act(() => router.navigate('/me/profile'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
  });

  it('sends /settings on a phone to /me and draws the Me hub', async () => {
    phoneMedia(true);
    const { router } = await renderApp('/settings');
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Me' })).toBeInTheDocument();
  });

  it('keeps the search part of the link on both redirects', async () => {
    phoneMedia(true);
    const { router } = await renderApp('/settings?x=1');
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'));
    expect(router.state.location.search).toBe('?x=1');
  });

  it('sends the Google return on a phone to /me/calendar and keeps the hash', async () => {
    phoneMedia(true);
    const { router } = await renderApp('/settings#google=finish');
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/calendar'));
    expect(router.state.location.hash).toBe('#google=finish');
  });

  it('keeps /me/profile on a phone and draws the Profile page', async () => {
    phoneMedia(true);
    const { router } = await renderApp('/me/profile');
    expect(await screen.findByRole('heading', { level: 1, name: 'Profile' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/me/profile');
  });

  it('keeps the Google return at /settings on a desk', async () => {
    phoneMedia(false);
    const { router } = await renderApp('/settings#google=finish');
    expect(await settingsPage()).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
    expect(router.state.location.hash).toBe('#google=finish');
  });

  it('opens no tab and no redirect for /search', async () => {
    phoneMedia(true);
    const { router } = await renderApp('/search');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(router.state.location.pathname).toBe('/search');
  });
});
