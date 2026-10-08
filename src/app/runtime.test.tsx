import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { CallName, MadarApi } from '../api/calls';
import type { ChangeSignal } from '../api/remote/wire';
import { RuntimeProvider, createQueryClient, useCall } from './runtime';
import type { ChangeListener, ChangeSource } from './signals';

const MINUTE = 60_000;

type Read = [name: string, input: Record<string, unknown>];

function ReadOne({ name, input }: { name: string; input: Record<string, unknown> }) {
  useCall(name as CallName, input as never);
  return null;
}

/** The reads that a screen shows. A new list mounts and unmounts reads, and the provider stays. */
function Screen({ reads }: { reads: Read[] }) {
  return <>{reads.map(([name, input]) => <ReadOne key={JSON.stringify([name, input])} name={name} input={input} />)}</>;
}

/** A runtime with a fake api, a fake change source and the screen above. */
function setup(mode: 'remote' | 'prototype' = 'remote') {
  const calls: string[] = [];
  const api = {
    call: vi.fn(async (name: string, input: unknown) => {
      calls.push(name);
      return { name, input, n: calls.length };
    }),
    run: vi.fn(),
  } as unknown as MadarApi;
  let listener: ChangeListener | undefined;
  const changes: ChangeSource = {
    subscribe(l) {
      listener = l;
      return () => {
        listener = undefined;
      };
    },
    status: () => 'open',
  };
  const client = createQueryClient({ remote: mode === 'remote' });
  // One runtime object for the whole test, as in main.tsx.
  const runtime = { api, changes, mode };
  const ui = (reads: Read[]) => (
    <RuntimeProvider runtime={runtime} queryClient={client}>
      <Screen reads={reads} />
    </RuntimeProvider>
  );
  const view = render(ui([]));
  return {
    client,
    calls,
    show: async (...reads: Read[]) => {
      view.rerender(ui(reads));
      await act(() => vi.advanceTimersByTimeAsync(0));
    },
    send: (signals: ChangeSignal[]) => listener?.(signals, 'channel'),
    has: (read: Read) => client.getQueryCache().find({ queryKey: ['api', ...read], exact: true }) !== undefined,
    data: (read: Read) => client.getQueryData(['api', ...read]),
    count: (name: string) => calls.filter((call) => call === name).length,
    unmount: () => view.unmount(),
  };
}

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

let seq = 0;
function signal(o: Partial<ChangeSignal> & { kinds: ChangeSignal['kinds'] }): ChangeSignal {
  seq += 1;
  return { v: 1, id: `sig-rt-${seq}`, channel: 'office', seq, projects: [], office: false, people: [], ...o };
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}

const PROJECT: Read = ['projects.get', { id: 'prj_001' }];
const TASKS: Read = ['tasks.list', { projectId: 'prj_001', activeProjectsOnly: false }];

beforeEach(() => {
  vi.useFakeTimers();
  // 10:00 in Riyadh, far from midnight.
  vi.setSystemTime(new Date('2026-10-08T07:00:00Z'));
});

afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
});

describe('the cache life of the real build (performance audit FET-5)', () => {
  it('keeps an answer that no change marked for an hour after its screen closed, so the screen opens again with no call', async () => {
    const app = setup();
    await app.show(PROJECT);
    expect(app.count('projects.get')).toBe(1);
    await app.show();
    await wait(6 * MINUTE);
    expect(app.data(PROJECT)).toMatchObject({ name: 'projects.get' });
    await app.show(PROJECT);
    expect(app.count('projects.get')).toBe(1);
    await app.show();
    await wait(59 * MINUTE);
    expect(app.has(PROJECT)).toBe(true);
    await wait(2 * MINUTE);
    expect(app.has(PROJECT)).toBe(false);
    app.unmount();
  });

  it('drops an answer that a change marked 5 minutes after its screen closed, as before', async () => {
    const app = setup();
    await app.show(TASKS);
    await app.show();
    await wait(MINUTE);
    app.send([signal({ kinds: ['tasks'], projects: ['prj_001'] })]);
    await wait(1000);
    expect(app.client.getQueryState(['api', ...TASKS])?.isInvalidated).toBe(true);
    await wait(4 * MINUTE - 2000);
    expect(app.has(TASKS)).toBe(true);
    await wait(2000);
    expect(app.has(TASKS)).toBe(false);
    // The screen opens again on a new answer.
    await app.show(TASKS);
    expect(app.count('tasks.list')).toBe(2);
    app.unmount();
  });

  it('drops a marked answer at once when its screen closed more than 5 minutes before the change', async () => {
    const app = setup();
    await app.show(TASKS);
    await app.show();
    await wait(20 * MINUTE);
    expect(app.has(TASKS)).toBe(true);
    app.send([signal({ kinds: ['tasks'], projects: ['prj_001'] })]);
    // The merge window, then the removal on the next timer (a fake timer of 0 ms made in a tick runs 1 ms later).
    await wait(1000 + 1);
    expect(app.has(TASKS)).toBe(false);
    app.unmount();
  });

  it('keeps an answer that a change for another project did not mark', async () => {
    const app = setup();
    await app.show(TASKS);
    await app.show();
    app.send([signal({ kinds: ['tasks'], projects: ['prj_002'] })]);
    await wait(10 * MINUTE);
    expect(app.has(TASKS)).toBe(true);
    app.unmount();
  });

  it('drops an answer that was marked on screen 5 minutes after its screen closed (a hidden tab marks only)', async () => {
    const app = setup();
    await app.show(TASKS);
    setHidden(true);
    app.send([signal({ kinds: ['tasks'], projects: ['prj_001'] })]);
    await wait(1000);
    expect(app.client.getQueryState(['api', ...TASKS])?.isInvalidated).toBe(true);
    await app.show();
    await wait(5 * MINUTE - 1000);
    expect(app.has(TASKS)).toBe(true);
    await wait(1000);
    expect(app.has(TASKS)).toBe(false);
    app.unmount();
  });

  it('keeps a marked answer while a screen shows it', async () => {
    const app = setup();
    await app.show(TASKS);
    setHidden(true);
    app.send([signal({ kinds: ['tasks'], projects: ['prj_001'] })]);
    await wait(20 * MINUTE);
    expect(app.has(TASKS)).toBe(true);
    app.unmount();
  });

  it('drops every answer that no screen shows when the office day changes, and keeps the answers on screen', async () => {
    vi.setSystemTime(new Date('2026-10-08T20:50:00Z'));
    const app = setup();
    await app.show(PROJECT, TASKS);
    await app.show(TASKS);
    await wait(9 * MINUTE);
    expect(app.has(PROJECT)).toBe(true);
    // 00:00 in Riyadh is 21:00 UTC.
    await wait(2 * MINUTE);
    expect(app.has(PROJECT)).toBe(false);
    expect(app.has(TASKS)).toBe(true);
    app.unmount();
  });

  it('drops the answers of yesterday when the tab shows again, also when the timer slept', async () => {
    vi.setSystemTime(new Date('2026-10-08T20:00:00Z'));
    const app = setup();
    await app.show(PROJECT);
    await app.show();
    setHidden(true);
    // A sleeping computer runs no timer: the clock moves on alone.
    vi.setSystemTime(new Date('2026-10-09T05:00:00Z'));
    expect(app.has(PROJECT)).toBe(true);
    setHidden(false);
    expect(app.has(PROJECT)).toBe(false);
    app.unmount();
  });

  it('keeps 5 minutes for a signed link, a search and the other reads that never reload', async () => {
    const app = setup();
    const link: Read = ['files.link', { id: 'fil_001', variant: 'thumb', disposition: 'inline' }];
    const search: Read = ['search.query', { q: 'villa' }];
    const usage: Read = ['usage.get', {}];
    await app.show(link, search, usage);
    await app.show();
    await wait(5 * MINUTE - 1000);
    expect([app.has(link), app.has(search), app.has(usage)]).toEqual([true, true, true]);
    await wait(2000);
    expect([app.has(link), app.has(search), app.has(usage)]).toEqual([false, false, false]);
    app.unmount();
  });

  it('leaves the prototype client as before: an answer goes 5 minutes after its screen closed', async () => {
    const prototype = createQueryClient();
    expect(prototype.getQueryDefaults(['api', 'projects.get', { id: 'prj_001' }]).gcTime).toBeUndefined();
    const app = setup('prototype');
    await app.show(PROJECT);
    await app.show();
    await wait(5 * MINUTE + 1000);
    expect(app.has(PROJECT)).toBe(false);
    app.unmount();
  });

  it('a sign-out reset leaves no answer in the cache, also of a closed screen', async () => {
    const app = setup();
    await app.show(PROJECT, TASKS);
    await app.show(TASKS);
    await act(() => app.client.resetQueries());
    expect(app.data(PROJECT)).toBeUndefined();
    app.unmount();
  });

  it('stops its timers and its listener when the provider goes', async () => {
    const app = setup();
    await app.show(TASKS);
    await app.show();
    app.unmount();
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
  });
});
