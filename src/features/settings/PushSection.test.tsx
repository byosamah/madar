import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../../i18n';
import { isPushOptedOut, setPushOptOut } from '../../app/remote/push';
import { iphoneBrowser, PUSH_TEST_ENDPOINT, PUSH_TEST_KEY, pushBrowser, pushWords, stopPushBrowser } from '../../test/pushBrowser';
import { renderWithRuntime } from '../../test/render';
import { expectCalm } from '../auth/calmChecks';
import { PushSection } from './PushSection';

// The build flag, switched per test: the prototype build (the default) or the remote build.
const mode = vi.hoisted(() => ({ REMOTE: false, PROTOTYPE: true }));
vi.mock('../../app/mode', () => mode);

const KEY = PUSH_TEST_KEY;
const ENDPOINT = PUSH_TEST_ENDPOINT;
const browser = pushBrowser;

function remote(on: boolean) {
  mode.REMOTE = on;
  mode.PROTOTYPE = !on;
}

beforeEach(() => {
  remote(true);
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', KEY);
});

afterEach(() => {
  cleanup();
  remote(false);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  stopPushBrowser();
  localStorage.clear();
  initI18n('en');
});

const sectionOf = async () => (await screen.findByRole('heading', { name: pushWords.en.title })).closest('section')!;

describe('the Notifications on this device section (owner, 2026-10-08)', () => {
  it('is not in the prototype build', async () => {
    remote(false);
    browser();
    const { container } = await renderWithRuntime(<PushSection />);
    expect(container.textContent).toBe('');
  });

  it('shows one switch, off, with the short hint, when the browser can push and the person has not turned it on', async () => {
    browser();
    await renderWithRuntime(<PushSection />);
    const section = await sectionOf();
    const toggle = await within(section).findByRole('switch', { name: pushWords.en.switch });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(within(section).getByText(pushWords.en.hint)).toBeInTheDocument();
    expect(within(section).getAllByRole('switch')).toHaveLength(1);
    expect(within(section).queryByRole('alert')).toBeNull();
    expectCalm(section, { titleLevel: 2 });
  });

  it('shows the switch on when this browser already holds a subscription and the permission', async () => {
    browser({ permission: 'granted', subscribed: true });
    await renderWithRuntime(<PushSection />);
    expect(await screen.findByRole('switch', { name: pushWords.en.switch })).toHaveAttribute('aria-checked', 'true');
  });

  it('turns on: asks the permission inside the click, registers the worker, subscribes, saves the device, and shows on', async () => {
    const b = browser();
    const { api } = await renderWithRuntime(<PushSection />);
    const call = vi.spyOn(api, 'call');
    const toggle = await screen.findByRole('switch', { name: pushWords.en.switch });
    // fireEvent runs the handler at once: the question must start before any wait.
    fireEvent.click(toggle);
    expect(b.requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('switch', { name: pushWords.en.switch })).toHaveAttribute('aria-checked', 'true'));
    expect(call).toHaveBeenCalledWith('push.register', expect.objectContaining({ endpoint: ENDPOINT, label: expect.any(String) }));
    expect(await api.call('push.mine', {})).toEqual([expect.objectContaining({ endpoint: ENDPOINT })]);
  });

  it('turns off: unsubscribes the browser, removes the device, and shows off', async () => {
    const b = browser({ permission: 'granted', subscribed: true });
    const { api } = await renderWithRuntime(<PushSection />);
    // The device is on the server from the earlier turn on.
    await api.call('push.register', { endpoint: ENDPOINT, label: 'Chrome on Mac' });
    const call = vi.spyOn(api, 'call');
    await userEvent.click(await screen.findByRole('switch', { name: pushWords.en.switch }));
    await waitFor(() => expect(screen.getByRole('switch', { name: pushWords.en.switch })).toHaveAttribute('aria-checked', 'false'));
    expect(b.unsubscribe).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('push.remove', { endpoint: ENDPOINT });
    expect(await api.call('push.mine', {})).toEqual([]);
  });

  it('shows how to allow notifications, and no switch, when the browser blocks them', async () => {
    browser({ permission: 'denied' });
    await renderWithRuntime(<PushSection />);
    const section = await sectionOf();
    expect(await within(section).findByText(pushWords.en.blocked)).toBeInTheDocument();
    expect(within(section).queryByRole('switch')).toBeNull();
  });

  it('moves to the blocked note when the person denies the question, and saves nothing', async () => {
    browser({ asked: 'denied' });
    const { api } = await renderWithRuntime(<PushSection />);
    await userEvent.click(await screen.findByRole('switch', { name: pushWords.en.switch }));
    expect(await screen.findByText(pushWords.en.blocked)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(await api.call('push.mine', {})).toEqual([]);
  });

  it('stays off with no message when the person closes the question', async () => {
    browser({ asked: 'default' });
    const { api } = await renderWithRuntime(<PushSection />);
    await userEvent.click(await screen.findByRole('switch', { name: pushWords.en.switch }));
    await waitFor(() => expect(screen.getByRole('switch', { name: pushWords.en.switch })).toBeEnabled());
    expect(screen.getByRole('switch', { name: pushWords.en.switch })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await api.call('push.mine', {})).toEqual([]);
  });

  it('says so, with the switch still off, when the browser cannot subscribe', async () => {
    browser({ subscribeFails: true });
    await renderWithRuntime(<PushSection />);
    await userEvent.click(await screen.findByRole('switch', { name: pushWords.en.switch }));
    expect(await screen.findByRole('alert')).toHaveTextContent(pushWords.en.error);
    expect(screen.getByRole('switch', { name: pushWords.en.switch })).toHaveAttribute('aria-checked', 'false');
  });

  it('says that the browser cannot show notifications, with no switch', async () => {
    browser({ none: true });
    await renderWithRuntime(<PushSection />);
    const section = await sectionOf();
    expect(await within(section).findByText(pushWords.en.unsupported)).toBeInTheDocument();
    expect(within(section).queryByRole('switch')).toBeNull();
  });

  it('asks an iPhone in the browser to add Madar to the Home Screen first', async () => {
    browser({ none: true });
    iphoneBrowser();
    await renderWithRuntime(<PushSection />);
    const section = await sectionOf();
    expect(await within(section).findByText(pushWords.en.needsInstall)).toBeInTheDocument();
    expect(within(section).queryByText(pushWords.en.unsupported)).toBeNull();
    expect(within(section).queryByRole('switch')).toBeNull();
  });

  it('says that push is not set up when the build has no public key', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
    browser();
    await renderWithRuntime(<PushSection />);
    const section = await sectionOf();
    expect(await within(section).findByText(pushWords.en.notSet)).toBeInTheDocument();
    expect(within(section).queryByRole('switch')).toBeNull();
  });

  it('saves the endpoint again at the visit when the browser renewed it and the server does not list it', async () => {
    browser({ permission: 'granted', subscribed: true });
    const { api } = await renderWithRuntime(<PushSection />);
    await screen.findByRole('switch', { name: pushWords.en.switch });
    await waitFor(async () => expect(await api.call('push.mine', {})).toEqual([expect.objectContaining({ endpoint: ENDPOINT })]));
  });

  // Push is on by default (owner, 2026-10-09). The permission lasts in the browser, so the switch is on again without a tap.
  it('shows the switch on by itself when the permission was granted before and the browser holds no subscription', async () => {
    browser({ permission: 'granted', subscribed: false });
    const { api } = await renderWithRuntime(<PushSection />);
    await waitFor(() => expect(screen.getByRole('switch', { name: pushWords.en.switch })).toHaveAttribute('aria-checked', 'true'));
    expect(await api.call('push.mine', {})).toEqual([expect.objectContaining({ endpoint: ENDPOINT })]);
  });

  it('keeps the switch off, after a reload, when the person turned it off', async () => {
    const b = browser({ permission: 'granted', subscribed: true });
    const { api } = await renderWithRuntime(<PushSection />);
    await api.call('push.register', { endpoint: ENDPOINT, label: 'Chrome on Mac' });
    await userEvent.click(await screen.findByRole('switch', { name: pushWords.en.switch }));
    await waitFor(() => expect(screen.getByRole('switch', { name: pushWords.en.switch })).toHaveAttribute('aria-checked', 'false'));
    expect(isPushOptedOut('usr_001')).toBe(true);
    cleanup();
    await renderWithRuntime(<PushSection />);
    expect(await screen.findByRole('switch', { name: pushWords.en.switch })).toHaveAttribute('aria-checked', 'false');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(b.subscribe).not.toHaveBeenCalled();
  });

  it('forgets the choice to stay off when the person turns the switch on again', async () => {
    browser({ permission: 'granted', subscribed: false });
    setPushOptOut('usr_001', true);
    await renderWithRuntime(<PushSection />);
    await userEvent.click(await screen.findByRole('switch', { name: pushWords.en.switch }));
    await waitFor(() => expect(screen.getByRole('switch', { name: pushWords.en.switch })).toHaveAttribute('aria-checked', 'true'));
    expect(isPushOptedOut('usr_001')).toBe(false);
  });

  it('keeps the choice to stay off, and shows the error, when the browser cannot turn push off', async () => {
    const b = browser({ permission: 'granted', subscribed: true });
    b.unsubscribe.mockRejectedValue(new Error('Browser failed.'));
    const { api } = await renderWithRuntime(<PushSection />);
    await api.call('push.register', { endpoint: ENDPOINT, label: 'Chrome on Mac' });
    await userEvent.click(await screen.findByRole('switch', { name: pushWords.en.switch }));
    expect(await screen.findByRole('alert')).toHaveTextContent(pushWords.en.offError);
    expect(screen.getByRole('switch', { name: pushWords.en.switch })).toHaveAttribute('aria-checked', 'true');
    expect(isPushOptedOut('usr_001')).toBe(false);
  });

  it('reads right to left in Arabic with the same single switch', async () => {
    browser();
    await renderWithRuntime(<div dir="rtl"><PushSection /></div>);
    initI18n('ar');
    const section = (await screen.findByRole('heading', { name: pushWords.ar.title })).closest('section')!;
    expect(within(section).getByRole('switch', { name: pushWords.ar.switch })).toBeInTheDocument();
    expect(within(section).getAllByRole('switch')).toHaveLength(1);
    expectCalm(section, { titleLevel: 2 });
    await act(async () => undefined);
  });
});

describe('the notes of the push section that show no switch', () => {
  // The blocked note and the iPhone note show no switch, so they must name it by its label and say where to find it.
  it('name the switch by its label, in English and Arabic, and never say "this switch"', () => {
    for (const lang of ['en', 'ar'] as const) {
      for (const key of ['blocked', 'needsInstall'] as const) {
        expect(pushWords[lang][key]).toContain(pushWords[lang].switch);
      }
    }
    expect(pushWords.en.blocked).not.toMatch(/this switch/);
    expect(pushWords.en.needsInstall).not.toMatch(/this switch/);
  });
});
