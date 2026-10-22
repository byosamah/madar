import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { watchInstall } from '../../app/remote/install';
import { initI18n } from '../../i18n';
import {
  androidBrowser, installEvent, iphoneBrowser, PUSH_TEST_KEY, pushBrowser, pushWords, stopPushBrowser,
} from '../../test/pushBrowser';
import { fakeAuth } from '../auth/fakeAuth';
import { renderAuth, SAMPLE_ACCOUNTS } from '../auth/renderAuth';
import { MeScreen } from './MeScreen';

// The remote build: push, the Morning summary, Password, Agents and Sign out exist here, and the prototype tools do not.
vi.mock('../../app/mode', () => ({ REMOTE: true, PROTOTYPE: false }));

const signedIn = () => fakeAuth({ accounts: [{ ...SAMPLE_ACCOUNTS.hala }], signedInAs: SAMPLE_ACCOUNTS.hala.email });
const only = (element: ReactElement) => [{ path: '*', element }];
type Options = { prepare?: Parameters<typeof renderAuth>[1]['prepare']; answer?: Parameters<typeof renderAuth>[1]['answer'] };
const hub = async (o: Options = {}) => {
  const view = await renderAuth('/me', { auth: signedIn(), routes: only(<MeScreen />), ...o });
  await screen.findByRole('link', { name: /Hala Nasser/ });
  return view;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

let stopInstall: () => void = () => undefined;

beforeEach(() => {
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', PUSH_TEST_KEY);
});

afterEach(() => {
  stopInstall();
  stopInstall = () => undefined;
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  stopPushBrowser();
  localStorage.clear();
  initI18n('en');
});

describe('the settings rows of the Me hub in the real build', () => {
  it('shows the push switch, off, with no status line', async () => {
    pushBrowser();
    await hub();
    const toggle = await screen.findByRole('switch', { name: 'Notify me on this device' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows no switch and no line while the first check runs, then the switch in the same row', async () => {
    pushBrowser();
    // The first check waits for the worker; the test holds it open.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const worker = navigator.serviceWorker as unknown as { getRegistration: () => Promise<unknown> };
    const getRegistration = worker.getRegistration;
    worker.getRegistration = async () => {
      await held;
      return getRegistration();
    };
    await hub();
    // The row and its title are there from the start, so the rows around it do not move when the switch arrives.
    expect(screen.getByText('Notify me on this device')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Notify me on this device' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    release();
    expect(await screen.findByRole('switch', { name: 'Notify me on this device' })).toBeInTheDocument();
    expect(screen.getByText('Notify me on this device').closest('li')).toContainElement(screen.getByRole('switch', { name: 'Notify me on this device' }));
  });

  it('shows the blocked reason and no switch', async () => {
    pushBrowser({ permission: 'denied' });
    await hub();
    expect(await screen.findByRole('status')).toHaveTextContent(pushWords.en.blocked);
    expect(screen.queryByRole('switch', { name: 'Notify me on this device' })).toBeNull();
  });

  it('on an iPhone tab shows the Home Screen row and no push line', async () => {
    pushBrowser({ none: true });
    iphoneBrowser();
    await hub();
    expect(await screen.findByRole('button', { name: 'Add Madar to the Home Screen' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Notify me on this device' })).toBeNull();
  });

  it('opens the three steps from that row', async () => {
    pushBrowser({ none: true });
    iphoneBrowser();
    await hub();
    await userEvent.click(await screen.findByRole('button', { name: 'Add Madar to the Home Screen' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add Madar to the Home Screen' });
    const steps = within(sheet).getAllByRole('listitem').map((item) => item.textContent);
    expect(steps).toEqual([pushWords.en.homeScreenStep1, pushWords.en.homeScreenStep2, pushWords.en.homeScreenStep3]);
    expect(within(sheet).getByText(pushWords.en.homeScreenLine)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('on Android calls the install box from the same row, and the row leaves', async () => {
    androidBrowser();
    pushBrowser({ permission: 'granted', subscribed: true });
    stopInstall = watchInstall();
    const event = installEvent();
    window.dispatchEvent(event);
    await hub();
    const row = await screen.findByRole('button', { name: 'Add Madar to the Home Screen' });
    // The box of Chrome must open inside the tap, so the click runs the handler at once.
    fireEvent.click(row);
    expect(event.prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add Madar to the Home Screen' })).toBeNull());
  });

  it('shows no Home Screen row on a computer', async () => {
    pushBrowser({ permission: 'granted', subscribed: true });
    stopInstall = watchInstall();
    await hub();
    await screen.findByRole('switch', { name: 'Notify me on this device' });
    await act(settle);
    expect(screen.queryByRole('button', { name: 'Add Madar to the Home Screen' })).toBeNull();
  });

  it('turns the Morning summary on and off and saves it', async () => {
    pushBrowser();
    const { api } = await hub();
    const call = vi.spyOn(api, 'call');
    const toggle = await screen.findByRole('switch', { name: 'Morning summary' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);
    await waitFor(() => expect(call).toHaveBeenCalledWith('notifications.updateSettings', expect.objectContaining({ morningSummary: false }), expect.anything()));
  });

  it('shows Password and Agents rows, also for a person without ai.connect', async () => {
    pushBrowser();
    await hub();
    expect(screen.getByRole('link', { name: /Password/ })).toHaveAttribute('href', '/me/password');
    expect(screen.getByRole('link', { name: /Agents/ })).toHaveAttribute('href', '/me/agents');
  });

  it('shows the Google value Connected', async () => {
    pushBrowser();
    await hub({ answer: (name) => (name === 'google.status' ? { ready: true, state: 'ok', connectedAt: '2026-10-20T09:00:00.000+03:00' } : undefined) });
    const row = await screen.findByRole('link', { name: /Google Calendar/ });
    await waitFor(() => expect(row).toHaveTextContent('Connected'));
  });

  it('shows Connect again when the Google link is broken', async () => {
    pushBrowser();
    await hub({ answer: (name) => (name === 'google.status' ? { ready: true, state: 'broken', connectedAt: '2026-10-20T09:00:00.000+03:00' } : undefined) });
    const row = await screen.findByRole('link', { name: /Google Calendar/ });
    await waitFor(() => expect(row).toHaveTextContent('Connect again'));
  });
});
