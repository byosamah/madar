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

const KEY = 'phc_abcdefghijklmnopqrstuvwx';
const SESSION = ['api', 'session.get', {}];

/** The options of a sign-in on a query client. With an enterprise, the session answer is already in the cache. */
function signedIn(ent: string | null, router: { router: never }, queryClient = new QueryClient(), user = { id: 'usr_a', name: 'Alice' }) {
  if (ent) queryClient.setQueryData(SESSION, { user, enterprise: { id: ent } });
  const person = () => {
    const session = queryClient.getQueryData<{ user: { id: string; name: string }; enterprise?: { id: string } }>(SESSION);
    return session ? { ...session.user, ent: session.enterprise?.id ?? null } : null;
  };
  return { key: KEY, env: 'test' as const, build: '1', person, queryClient, router: router.router };
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
    const client = createInsightClient(signedIn('ent_001', r));
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
    createInsightClient(signedIn('ent_001', r));
    expect(ph.init).toHaveBeenCalledTimes(1);
    expect(ph.startSessionRecording).toHaveBeenCalledTimes(1);
  });

  it('starts no recorder and no screen watcher for an enterprise without usage data, and keeps the call watcher for errors', async () => {
    const { createInsightClient } = await import('./client');
    const r = fakeRouter('/inbox');
    const client = createInsightClient(signedIn('ent_002', r));
    expect(ph.stopSessionRecording).toHaveBeenCalledTimes(1);
    // No page view and no router listener.
    expect(ph.capture).not.toHaveBeenCalled();
    expect(r.listeners.size).toBe(0);
    client.exception(new Error('x'), { where: 'route' });
    expect(ph.captureException).toHaveBeenCalled();
    client.stop();

    // A second sign-in with usage data on the same page starts the recorder again, and one without it does not.
    createInsightClient(signedIn('ent_001', r));
    expect(ph.startSessionRecording).toHaveBeenCalledTimes(1);
    createInsightClient(signedIn('ent_002', r));
    expect(ph.startSessionRecording).toHaveBeenCalledTimes(1);
    expect(ph.init).toHaveBeenCalledTimes(1);
  });

  it('starts nothing, not even PostHog, until the session answer is in the cache, and starts once when it comes', async () => {
    const { createInsightClient } = await import('./client');
    const r = fakeRouter('/inbox');
    const waiting = signedIn(null, r);
    const client = createInsightClient(waiting);
    expect(ph.init).not.toHaveBeenCalled();
    // A call before the start sends nothing.
    client.track('madar_sheet', { sheet: 'payment', step: 'open' });
    client.exception(new Error('early'), { where: 'route' });
    expect(ph.capture).not.toHaveBeenCalled();
    expect(ph.captureException).not.toHaveBeenCalled();
    waiting.queryClient.setQueryData(SESSION, { user: { id: 'usr_a', name: 'Alice' }, enterprise: { id: 'ent_001' } });
    expect(ph.init).toHaveBeenCalledTimes(1);
    // The cache changes again: still one start.
    waiting.queryClient.setQueryData(SESSION, { user: { id: 'usr_a', name: 'Alice' }, enterprise: { id: 'ent_001' } });
    expect(ph.init).toHaveBeenCalledTimes(1);
    client.track('madar_sheet', { sheet: 'payment', step: 'open' });
    expect(ph.capture).toHaveBeenCalledWith('madar_sheet', { sheet: 'payment', step: 'open' });
    client.stop();
  });

  it('a stop while it waits ends the wait: a later answer starts nothing', async () => {
    const { createInsightClient } = await import('./client');
    const queryClient = new QueryClient();
    const client = createInsightClient(signedIn(null, fakeRouter('/'), queryClient));
    client.stop();
    queryClient.setQueryData(SESSION, { user: { id: 'usr_a', name: 'Alice' }, enterprise: { id: 'ent_001' } });
    expect(ph.init).not.toHaveBeenCalled();
  });

  it('does not take the answer of the person who left for the next person', async () => {
    const { createInsightClient } = await import('./client');
    const first = createInsightClient(signedIn('ent_001', fakeRouter('/')));
    expect(ph.init).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    first.stop();
    // The cache of the next sign-in still holds the answer of the first person (it is older than the stop).
    const stale = signedIn(null, fakeRouter('/'));
    stale.queryClient.setQueryData(SESSION, { user: { id: 'usr_a', name: 'Alice' }, enterprise: { id: 'ent_001' } }, { updatedAt: Date.now() - 1000 });
    const second = createInsightClient(stale);
    expect(ph.startSessionRecording).not.toHaveBeenCalled();
    // The answer of the next person (a customer) comes: usage is off for it.
    stale.queryClient.setQueryData(SESSION, { user: { id: 'usr_c', name: 'Cora' }, enterprise: { id: 'ent_002' } });
    expect(ph.startSessionRecording).not.toHaveBeenCalled();
    expect(ph.stopSessionRecording).toHaveBeenCalled();
    second.stop();
  });

  it('a start that throws inside the wait stays quiet and ends the wait', async () => {
    const { createInsightClient } = await import('./client');
    ph.init.mockImplementationOnce(() => { throw new Error('init failed'); });
    const queryClient = new QueryClient();
    createInsightClient(signedIn(null, fakeRouter('/'), queryClient));
    expect(() => queryClient.setQueryData(SESSION, { user: { id: 'usr_a', name: 'Alice' }, enterprise: { id: 'ent_001' } })).not.toThrow();
    ph.init.mockImplementation(() => ph);
  });

  it('never throws when PostHog throws', async () => {
    const { createInsightClient } = await import('./client');
    ph.capture.mockImplementation(() => { throw new Error('blocked'); });
    ph.captureException.mockImplementation(() => { throw new Error('blocked'); });
    ph.stopSessionRecording.mockImplementation(() => { throw new Error('blocked'); });
    const client = createInsightClient(signedIn('ent_001', fakeRouter('/')));
    expect(() => { client.track('x'); client.exception(new Error('y')); client.stop(); }).not.toThrow();
    ph.capture.mockReset(); ph.captureException.mockReset(); ph.stopSessionRecording.mockReset();
  });
});
