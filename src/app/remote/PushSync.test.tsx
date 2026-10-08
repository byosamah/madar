import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { PUSH_TEST_ENDPOINT, PUSH_TEST_KEY, pushBrowser, stopPushBrowser } from '../../test/pushBrowser';
import { renderWithRuntime } from '../../test/render';
import { PushSync } from './PushSync';

// The build flag, switched per test: the prototype build (the default) or the remote build.
const mode = vi.hoisted(() => ({ REMOTE: false, PROTOTYPE: true }));
vi.mock('../mode', () => mode);

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
});

const OWN_DEVICE = { id: 'pdv_001', userId: 'usr_001', endpoint: PUSH_TEST_ENDPOINT, label: 'Chrome on Mac', createdAt: '2026-10-03T09:00:00.000+03:00', lastPushAt: null };

describe('PushSync: the check at the start of the app (owner, 2026-10-08)', () => {
  it('saves the endpoint of this browser again when the server does not list it', async () => {
    pushBrowser({ permission: 'granted', subscribed: true });
    const { store } = await renderWithRuntime(<PushSync delayMs={0} />);
    await waitFor(() => expect(Object.values(store.state.pushDevices ?? {})).toEqual([expect.objectContaining({ userId: 'usr_001', endpoint: PUSH_TEST_ENDPOINT })]));
  });

  it('does not save the endpoint again when the server lists it', async () => {
    pushBrowser({ permission: 'granted', subscribed: true });
    const { api, store } = await renderWithRuntime(<PushSync delayMs={0} />, (state) => {
      state.pushDevices = { pdv_001: { ...OWN_DEVICE } };
      state.counters.pdv = 1;
    });
    const call = vi.spyOn(api, 'call');
    // The sync asks for the own devices, then stops. A second save would change the label.
    await waitFor(() => expect(Object.keys(store.state.pushDevices ?? {})).toEqual(['pdv_001']));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.state.pushDevices!.pdv_001.label).toBe('Chrome on Mac');
    expect(call.mock.calls.filter(([name]) => name === 'push.register')).toEqual([]);
  });

  it('does nothing without the permission, without a subscription, or without a public key', async () => {
    for (const setup of [
      () => pushBrowser({ permission: 'default', subscribed: true }),
      () => pushBrowser({ permission: 'granted', subscribed: false }),
      () => {
        vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
        pushBrowser({ permission: 'granted', subscribed: true });
      },
    ]) {
      cleanup();
      vi.unstubAllGlobals();
      setup();
      const { api, store } = await renderWithRuntime(<PushSync delayMs={0} />);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(Object.values(store.state.pushDevices ?? {})).toEqual([]);
      expect(await api.call('push.mine', {})).toEqual([]);
    }
  });

  it('does nothing in the prototype build', async () => {
    mode.REMOTE = false;
    mode.PROTOTYPE = true;
    pushBrowser({ permission: 'granted', subscribed: true });
    const { store } = await renderWithRuntime(<PushSync delayMs={0} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(Object.values(store.state.pushDevices ?? {})).toEqual([]);
  });

  it('does nothing in a browser without push, and never throws', async () => {
    pushBrowser({ none: true });
    const { store } = await renderWithRuntime(<PushSync delayMs={0} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(Object.values(store.state.pushDevices ?? {})).toEqual([]);
  });
});
