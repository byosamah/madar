import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthPort, AuthStatus } from '../auth';

const KEY = 'phc_abcdefghijklmnopqrstuvwx';

/** An auth port that only holds a status and tells its listeners. */
function fakeAuth(first: AuthStatus) {
  let status = first;
  const listeners = new Set<(status: AuthStatus) => void>();
  const auth = { status: () => status, subscribe: (listener: (next: AuthStatus) => void) => { listeners.add(listener); return () => listeners.delete(listener); } } as unknown as AuthPort;
  return { auth, set: (next: AuthStatus) => { status = next; listeners.forEach((listener) => listener(next)); } };
}

/** A router that only holds a path and tells its listeners. */
function fakeRouter(path: string) {
  const listeners = new Set<(state: unknown) => void>();
  const router = {
    state: { location: { pathname: path } },
    subscribe: (listener: (state: unknown) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { router: router as never, go: (next: string) => { router.state = { location: { pathname: next } }; listeners.forEach((listener) => listener(router.state)); } };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const stopMock = vi.fn();
const trackMock = vi.fn();
const exceptionMock = vi.fn();
const factory = vi.fn();

async function load(o: { importFails?: boolean } = {}) {
  vi.resetModules();
  stopMock.mockReset(); trackMock.mockReset(); exceptionMock.mockReset(); factory.mockReset();
  factory.mockImplementation(() => ({ track: trackMock, exception: exceptionMock, stop: stopMock }));
  if (o.importFails) vi.doMock('./client', () => { throw new Error('Failed to fetch dynamically imported module'); });
  else vi.doMock('./client', () => ({ createInsightClient: factory }));
  return import('./index');
}

beforeEach(() => {
  vi.stubEnv('VITE_MADAR_API', 'remote');
  vi.stubEnv('VITE_POSTHOG_KEY', KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('./client');
});

describe('startInsight', () => {
  it('does nothing in the fake build', async () => {
    vi.stubEnv('VITE_MADAR_API', 'fake');
    const insight = await load();
    const { auth } = fakeAuth('signed_in');
    insight.startInsight({ queryClient: new QueryClient(), auth, router: fakeRouter('/').router });
    await flush();
    expect(factory).not.toHaveBeenCalled();
    expect(() => { insight.reportError(new Error('x'), 'test'); insight.noteSlow(['a'], 3000); insight.noteSheet('newTask', 'open'); }).not.toThrow();
    expect(exceptionMock).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('does nothing with no key', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', '');
    const insight = await load();
    insight.startInsight({ queryClient: new QueryClient(), auth: fakeAuth('signed_in').auth, router: fakeRouter('/').router });
    await flush();
    expect(factory).not.toHaveBeenCalled();
  });

  it('does nothing without an auth port', async () => {
    const insight = await load();
    insight.startInsight({ queryClient: new QueryClient(), auth: undefined, router: fakeRouter('/').router });
    await flush();
    expect(factory).not.toHaveBeenCalled();
  });

  it('starts only after sign-in, on an address behind the gate', async () => {
    const insight = await load();
    const a = fakeAuth('signed_out');
    const r = fakeRouter('/sign-in');
    insight.startInsight({ queryClient: new QueryClient(), auth: a.auth, router: r.router });
    await flush();
    expect(factory).not.toHaveBeenCalled();
    a.set('signed_in');
    await flush();
    // Signed in, but the address is still a sign-in screen: nothing loads.
    expect(factory).not.toHaveBeenCalled();
    r.go('/');
    await flush();
    expect(factory).toHaveBeenCalledTimes(1);
    const options = factory.mock.calls[0]![0];
    expect(options.key).toBe(KEY);
    expect(options.env).toBe('test');
    expect(typeof options.build).toBe('string');
    r.go('/projects');
    await flush();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('forwards errors, slow steps and sheet steps to the client, and nothing before it runs', async () => {
    const insight = await load();
    insight.reportError(new Error('early'), 'route');
    expect(exceptionMock).not.toHaveBeenCalled();
    insight.startInsight({ queryClient: new QueryClient(), auth: fakeAuth('signed_in').auth, router: fakeRouter('/').router });
    await flush();
    const boom = new Error('boom');
    insight.reportError(boom, 'route');
    insight.noteSlow(['tasks.list', 'projects.list'], 2500);
    insight.noteSheet('payment', 'close_unsaved');
    expect(exceptionMock).toHaveBeenCalledWith(boom, { where: 'route' });
    expect(trackMock).toHaveBeenCalledWith('madar_slow_request', { calls: ['tasks.list', 'projects.list'], ms: 2500 });
    expect(trackMock).toHaveBeenCalledWith('madar_sheet', { sheet: 'payment', step: 'close_unsaved' });
  });

  it('resets on sign-out and names the new person', async () => {
    const insight = await load();
    const queryClient = new QueryClient();
    queryClient.setQueryData(['api', 'session.get', {}], { user: { id: 'usr_a', name: 'Alice', systemRole: 'member' } });
    const a = fakeAuth('signed_in');
    insight.startInsight({ queryClient, auth: a.auth, router: fakeRouter('/').router });
    await flush();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0]![0].person()).toEqual({ id: 'usr_a', name: 'Alice' });

    a.set('signed_out');
    expect(stopMock).toHaveBeenCalledTimes(1);
    insight.reportError(new Error('after stop'), 'route');
    expect(exceptionMock).not.toHaveBeenCalled();

    queryClient.setQueryData(['api', 'session.get', {}], { user: { id: 'usr_b', name: 'Bob', systemRole: 'member' } });
    a.set('signed_in');
    await flush();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory.mock.calls[1]![0].person()).toEqual({ id: 'usr_b', name: 'Bob' });
  });

  it('gives no person while the session has not come, or has no name', async () => {
    const insight = await load();
    const queryClient = new QueryClient();
    insight.startInsight({ queryClient, auth: fakeAuth('signed_in').auth, router: fakeRouter('/').router });
    await flush();
    const person = factory.mock.calls[0]![0].person as () => unknown;
    expect(person()).toBeNull();
    queryClient.setQueryData(['api', 'session.get', {}], { user: { id: 'usr_a' } });
    expect(person()).toBeNull();
  });

  it('a failed import stays quiet', async () => {
    const insight = await load({ importFails: true });
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, pathname: '/', reload, replace: reload } });
    try {
      expect(() => insight.startInsight({ queryClient: new QueryClient(), auth: fakeAuth('signed_in').auth, router: fakeRouter('/').router })).not.toThrow();
      await flush();
      await flush();
      expect(() => insight.reportError(new Error('x'), 'route')).not.toThrow();
      expect(reload).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('a factory that throws stays quiet', async () => {
    const insight = await load();
    factory.mockImplementation(() => { throw new Error('init failed'); });
    expect(() => insight.startInsight({ queryClient: new QueryClient(), auth: fakeAuth('signed_in').auth, router: fakeRouter('/').router })).not.toThrow();
    await flush();
    expect(() => insight.noteSheet('newTask', 'open')).not.toThrow();
  });
});
