import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setPushOptOut } from '../../app/remote/push';
import { initI18n } from '../../i18n';
import { iphoneBrowser, PUSH_TEST_ENDPOINT, PUSH_TEST_KEY, pushBrowser, pushWords, stopPushBrowser } from '../../test/pushBrowser';
import { renderWithRuntime } from '../../test/render';
import { HomeScreen } from './HomeScreen';
import { PushAskCard } from './PushAskCard';

// The build flag, switched per test: the prototype build (the default) or the remote build.
const mode = vi.hoisted(() => ({ REMOTE: false, PROTOTYPE: true }));
vi.mock('../../app/mode', () => mode);

function remote(on: boolean) {
  mode.REMOTE = on;
  mode.PROTOTYPE = !on;
}

beforeEach(() => {
  remote(true);
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', PUSH_TEST_KEY);
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

const button = () => screen.findByRole('button', { name: pushWords.en.askButton });
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('the one ask for browser push on Home (owner, 2026-10-09)', () => {
  it('is not in the prototype build', async () => {
    remote(false);
    pushBrowser();
    const { container } = await renderWithRuntime(<PushAskCard />);
    await settle();
    expect(container.textContent).toBe('');
  });

  it('shows one short line and one button when the browser can push and the person was never asked', async () => {
    pushBrowser();
    await renderWithRuntime(<PushAskCard />);
    expect(await button()).toBeEnabled();
    expect(screen.getByText(pushWords.en.ask)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('switch')).toBeNull();
    // It is not the main button of the screen: Home keeps one.
    expect((await button()).classList.contains('signature')).toBe(false);
  });

  it('asks the permission inside the tap, saves the device, and is gone', async () => {
    const b = pushBrowser();
    const { api } = await renderWithRuntime(<PushAskCard />);
    const tap = await button();
    // fireEvent runs the handler at once: the question must start before any wait.
    fireEvent.click(tap);
    expect(b.requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: pushWords.en.askButton })).toBeNull());
    expect(await api.call('push.mine', {})).toEqual([expect.objectContaining({ endpoint: PUSH_TEST_ENDPOINT })]);
  });

  it('is gone, and saves nothing, when the person denies the question', async () => {
    pushBrowser({ asked: 'denied' });
    const { api } = await renderWithRuntime(<PushAskCard />);
    await userEvent.click(await button());
    await waitFor(() => expect(screen.queryByRole('button', { name: pushWords.en.askButton })).toBeNull());
    expect(await api.call('push.mine', {})).toEqual([]);
  });

  it('stays, with no message, when the person closes the question with no answer', async () => {
    pushBrowser({ asked: 'default' });
    const { api } = await renderWithRuntime(<PushAskCard />);
    await userEvent.click(await button());
    await settle();
    expect(await button()).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await api.call('push.mine', {})).toEqual([]);
  });

  it('says so, and stays, when the browser cannot subscribe', async () => {
    pushBrowser({ subscribeFails: true });
    await renderWithRuntime(<PushAskCard />);
    await userEvent.click(await button());
    expect(await screen.findByRole('alert')).toHaveTextContent(pushWords.en.error);
    expect(await button()).toBeEnabled();
  });

  it('shows nothing after any answer, where the switch has only a note, or after the person turned push off', async () => {
    for (const setup of [
      () => pushBrowser({ permission: 'granted', subscribed: true }),
      () => pushBrowser({ permission: 'granted', subscribed: false }),
      () => pushBrowser({ permission: 'denied' }),
      () => pushBrowser({ none: true }),
      () => {
        pushBrowser({ none: true });
        iphoneBrowser();
      },
      () => {
        vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
        pushBrowser();
      },
      () => {
        pushBrowser();
        setPushOptOut('usr_001', true);
      },
    ]) {
      cleanup();
      vi.unstubAllGlobals();
      stopPushBrowser();
      setup();
      const { container } = await renderWithRuntime(<PushAskCard />);
      await settle();
      expect(container.textContent).toBe('');
    }
  });

  it('reads in Arabic', async () => {
    pushBrowser();
    await renderWithRuntime(<div dir="rtl"><PushAskCard /></div>);
    initI18n('ar');
    expect(await screen.findByRole('button', { name: pushWords.ar.askButton })).toBeInTheDocument();
    expect(screen.getByText(pushWords.ar.ask)).toBeInTheDocument();
    await act(async () => undefined);
  });
});

describe('Home with the ask', () => {
  it('shows the ask after Next for you, so the next step of the day stays first', async () => {
    pushBrowser();
    await renderWithRuntime(<HomeScreen />, undefined, { path: '/' });
    const next = await screen.findByRole('region', { name: 'Next for you' });
    const ask = await button();
    expect(next.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelectorAll('button.signature').length).toBeLessThanOrEqual(1);
  });

  it('shows no ask in the prototype build', async () => {
    remote(false);
    pushBrowser();
    await renderWithRuntime(<HomeScreen />, undefined, { path: '/' });
    await screen.findByRole('region', { name: 'Next for you' });
    await settle();
    expect(screen.queryByRole('button', { name: pushWords.en.askButton })).toBeNull();
  });
});
