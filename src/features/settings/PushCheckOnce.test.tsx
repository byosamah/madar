import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { PushSync } from '../../app/remote/PushSync';
import { setPushOptOut, turnOff } from '../../app/remote/push';
import { PUSH_TEST_KEY, pushBrowser, stopPushBrowser } from '../../test/pushBrowser';
import { renderWithRuntime } from '../../test/render';
import { PushAskCard } from '../home/PushAskCard';

/**
 * The check of the device (push.mine) runs once for each page and person (performance audit 2026-10-21, DF-11). Before, each
 * visit to Home ran it again, and a cold start ran it twice (the card on Home and PushSync at 3 s). Each run is one Edge call.
 */
const mode = vi.hoisted(() => ({ REMOTE: false, PROTOTYPE: true }));
vi.mock('../../app/mode', () => mode);

beforeEach(() => {
  mode.REMOTE = true;
  mode.PROTOTYPE = false;
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', PUSH_TEST_KEY);
});

afterEach(() => {
  cleanup();
  mode.REMOTE = false;
  mode.PROTOTYPE = true;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  stopPushBrowser();
  localStorage.clear();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const mineCalls = (call: { mock: { calls: unknown[][] } }) => call.mock.calls.filter(([name]) => name === 'push.mine').length;

describe('the device check of push runs once for each page and person (DF-11)', () => {
  it('asks push.mine once at a cold start, when the card on Home and PushSync both run', async () => {
    pushBrowser({ permission: 'granted', subscribed: true });
    const { api } = await renderWithRuntime(<><PushAskCard /><PushSync delayMs={0} /></>);
    const call = vi.spyOn(api, 'call');
    await waitFor(() => expect(mineCalls(call)).toBeGreaterThan(0), { timeout: 5000 });
    await settle();
    expect(mineCalls(call)).toBe(1);
  });

  it('asks push.mine once for two visits to Home on the same page', async () => {
    pushBrowser({ permission: 'granted', subscribed: true });
    const first = await renderWithRuntime(<PushAskCard />);
    const call = vi.spyOn(first.api, 'call');
    await waitFor(() => expect(mineCalls(call)).toBe(1), { timeout: 5000 });
    await settle();
    first.unmount();
    const second = await renderWithRuntime(<PushAskCard />);
    const again = vi.spyOn(second.api, 'call');
    await settle();
    expect(mineCalls(again)).toBe(0);
  });

  it('checks again for another person on the same browser', async () => {
    pushBrowser({ permission: 'granted', subscribed: true });
    const first = await renderWithRuntime(<PushAskCard />);
    const call = vi.spyOn(first.api, 'call');
    await waitFor(() => expect(mineCalls(call)).toBe(1), { timeout: 5000 });
    first.unmount();
    const second = await renderWithRuntime(<PushAskCard />, (state) => {
      state.session.currentUserId = 'usr_002';
    });
    const other = vi.spyOn(second.api, 'call');
    await waitFor(() => expect(mineCalls(other)).toBe(1), { timeout: 5000 });
  });

  it('checks again after a turn off, because the state of the device changed', async () => {
    pushBrowser({ permission: 'granted', subscribed: true });
    const first = await renderWithRuntime(<PushAskCard />);
    const call = vi.spyOn(first.api, 'call');
    await waitFor(() => expect(mineCalls(call)).toBe(1), { timeout: 5000 });
    await turnOff(first.api as never);
    setPushOptOut('usr_001', false);
    first.unmount();
    const second = await renderWithRuntime(<PushAskCard />);
    const again = vi.spyOn(second.api, 'call');
    await settle();
    // The browser holds no subscription after the turn off, so the check turns push on again and saves the device.
    await waitFor(() => expect(again.mock.calls.some(([name]) => name === 'push.register')).toBe(true), { timeout: 5000 });
  });
});
