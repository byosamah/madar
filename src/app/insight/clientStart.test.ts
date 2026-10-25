import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ph = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  captureException: vi.fn(),
  stopSessionRecording: vi.fn(),
  startSessionRecording: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('posthog-js/dist/module.full.no-external', () => {
  ph.init.mockImplementation(() => ph);
  return { default: ph, posthog: ph };
});

function fakeRouter(path: string) {
  const listeners = new Set<(state: unknown) => void>();
  const router = { state: { location: { pathname: path, search: '' } }, subscribe: (listener: (state: unknown) => void) => { listeners.add(listener); return () => listeners.delete(listener); } };
  return { router: router as never, listeners };
}

describe('createInsightClient', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(ph).forEach((fn) => fn.mockClear());
    ph.init.mockImplementation(() => ph);
  });

  it('starts PostHog once, starts the watchers, and stops them with the recorder and the ids', async () => {
    const { createInsightClient } = await import('./client');
    const r = fakeRouter('/inbox');
    const client = createInsightClient({ key: 'phc_abcdefghijklmnopqrstuvwx', env: 'test', build: '1', person: () => null, queryClient: new QueryClient(), router: r.router });
    expect(ph.init).toHaveBeenCalledTimes(1);
    expect(ph.init.mock.calls[0]![0]).toBe('phc_abcdefghijklmnopqrstuvwx');
    // The first page view goes at the start.
    expect(ph.capture).toHaveBeenCalledWith('$pageview', expect.objectContaining({ screen: 'inbox' }));
    expect(r.listeners.size).toBe(1);
    client.track('madar_sheet', { sheet: 'payment', step: 'open' });
    expect(ph.capture).toHaveBeenCalledWith('madar_sheet', { sheet: 'payment', step: 'open' });
    client.exception(new Error('x'), { where: 'route' });
    expect(ph.captureException).toHaveBeenCalled();

    client.stop();
    expect(r.listeners.size).toBe(0);
    expect(ph.stopSessionRecording).toHaveBeenCalledTimes(1);
    expect(ph.reset).toHaveBeenCalledTimes(1);

    // A second sign-in on the same page reuses the one instance.
    createInsightClient({ key: 'phc_abcdefghijklmnopqrstuvwx', env: 'test', build: '1', person: () => null, queryClient: new QueryClient(), router: r.router });
    expect(ph.init).toHaveBeenCalledTimes(1);
    expect(ph.startSessionRecording).toHaveBeenCalledTimes(1);
  });

  it('never throws when PostHog throws', async () => {
    const { createInsightClient } = await import('./client');
    ph.capture.mockImplementation(() => { throw new Error('blocked'); });
    ph.captureException.mockImplementation(() => { throw new Error('blocked'); });
    ph.stopSessionRecording.mockImplementation(() => { throw new Error('blocked'); });
    const client = createInsightClient({ key: 'phc_abcdefghijklmnopqrstuvwx', env: 'test', build: '1', person: () => null, queryClient: new QueryClient(), router: fakeRouter('/').router });
    expect(() => { client.track('x'); client.exception(new Error('y')); client.stop(); }).not.toThrow();
    ph.capture.mockReset(); ph.captureException.mockReset(); ph.stopSessionRecording.mockReset();
  });
});
