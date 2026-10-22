import { QueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREFETCH_AT_ONCE, PREFETCH_GAP_MS, PREFETCH_SAFETY_MS, prefetchOrder, startIdlePrefetch } from './idlePrefetch';
import { SCREEN_NAMES, screenCache } from './screens';

const Screen: ComponentType = () => null;

/** A read that the test finishes by hand. */
function hold(client: QueryClient, key: string) {
  let finish: (value: string) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const promise = client.fetchQuery({
    queryKey: ['api', key, {}],
    queryFn: () => new Promise<string>((resolve, reject) => { finish = resolve; fail = reject; }),
    retry: false,
  });
  promise.catch(() => undefined);
  return { finish: async (value = 'ok') => { finish(value); await promise; }, fail: async () => { fail(new Error('no')); await promise.catch(() => undefined); } };
}

/** The idle moments of the browser, run by hand. `pass` runs them, then lets the quiet gap go by. */
function idleSteps() {
  const steps: (() => void)[] = [];
  const runAll = () => { while (steps.length > 0) steps.shift()?.(); };
  return { idle: (run: () => void) => { steps.push(run); }, count: () => steps.length, runAll, pass: async () => { runAll(); await vi.advanceTimersByTimeAsync(PREFETCH_GAP_MS + 50); } };
}

describe('the start of the idle prefetch (follow-up of the speed release, 2026-10-22)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts nothing while the first reads are on their way, then one idle step and a quiet gap after the first fresh answer', async () => {
    const client = new QueryClient();
    const start = vi.fn();
    const steps = idleSteps();
    startIdlePrefetch({ queryClient: client, signedOut: false, start, idle: steps.idle });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(start).not.toHaveBeenCalled();
    const first = hold(client, 'session.get');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(start).not.toHaveBeenCalled();
    expect(steps.count()).toBe(0);
    await first.finish();
    // The answer is in. The start still waits for an idle step and the gap, so the rows and the text of Home draw before it.
    expect(start).not.toHaveBeenCalled();
    expect(steps.count()).toBe(1);
    steps.runAll();
    await vi.advanceTimersByTimeAsync(PREFETCH_GAP_MS - 100);
    expect(start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('waits until no read is on its way: the first request has more than one answer, and the rows draw after the last one', async () => {
    const client = new QueryClient();
    const start = vi.fn();
    const steps = idleSteps();
    startIdlePrefetch({ queryClient: client, signedOut: false, start, idle: steps.idle });
    const small = hold(client, 'session.get');
    const big = hold(client, 'tasks.list');
    await small.finish();
    // One answer is in and one is on its way: the line is still busy.
    expect(steps.count()).toBe(0);
    await steps.pass();
    expect(start).not.toHaveBeenCalled();
    await big.finish();
    expect(steps.count()).toBe(1);
    await steps.pass();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('asks again at the idle step: a read that began after the answer holds the start until it ends', async () => {
    const client = new QueryClient();
    const start = vi.fn();
    const steps = idleSteps();
    startIdlePrefetch({ queryClient: client, signedOut: false, start, idle: steps.idle });
    await hold(client, 'session.get').finish();
    expect(steps.count()).toBe(1);
    // The screen starts a second read before the idle step comes.
    const second = hold(client, 'meetings.list');
    await steps.pass();
    expect(start).not.toHaveBeenCalled();
    await second.finish();
    await steps.pass();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('asks again at the end of the gap: a read that began in the gap holds the start until it ends', async () => {
    const client = new QueryClient();
    const start = vi.fn();
    const steps = idleSteps();
    startIdlePrefetch({ queryClient: client, signedOut: false, start, idle: steps.idle });
    await hold(client, 'session.get').finish();
    steps.runAll();
    await vi.advanceTimersByTimeAsync(PREFETCH_GAP_MS / 2);
    const second = hold(client, 'meetings.list');
    await vi.advanceTimersByTimeAsync(PREFETCH_GAP_MS);
    expect(start).not.toHaveBeenCalled();
    await second.finish();
    await steps.pass();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('counts an error answer as the first answer', async () => {
    const client = new QueryClient();
    const start = vi.fn();
    const steps = idleSteps();
    startIdlePrefetch({ queryClient: client, signedOut: false, start, idle: steps.idle });
    await hold(client, 'session.get').fail();
    await steps.pass();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does not count an answer that the Home cache stored from an earlier visit', async () => {
    const client = new QueryClient();
    const start = vi.fn();
    const steps = idleSteps();
    startIdlePrefetch({ queryClient: client, signedOut: false, start, idle: steps.idle });
    // The stored answer comes with its old time (src/app/remote/homeCache.ts).
    client.setQueryData(['api', 'tasks.list', { filter: 'mine' }], [], { updatedAt: Date.now() - 3_600_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(steps.count()).toBe(0);
    expect(start).not.toHaveBeenCalled();
    await hold(client, 'tasks.list').finish();
    await steps.pass();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('starts by itself after the safety time when the answers never come', async () => {
    const client = new QueryClient();
    const start = vi.fn();
    const steps = idleSteps();
    startIdlePrefetch({ queryClient: client, signedOut: false, start, idle: steps.idle });
    hold(client, 'session.get');
    await vi.advanceTimersByTimeAsync(PREFETCH_SAFETY_MS - 100);
    expect(start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('keeps the safety time long enough for a phone on a slow line (10 s or more)', () => {
    expect(PREFETCH_SAFETY_MS).toBeGreaterThanOrEqual(10_000);
  });

  it('starts one idle step and a gap after the render on the sign-in screen, which has no reads', async () => {
    const client = new QueryClient();
    const start = vi.fn();
    const steps = idleSteps();
    startIdlePrefetch({ queryClient: client, signedOut: true, start, idle: steps.idle });
    expect(start).not.toHaveBeenCalled();
    expect(steps.count()).toBe(1);
    await steps.pass();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('starts only once, whichever of the answer, the safety time and a second answer comes first', async () => {
    const client = new QueryClient();
    const start = vi.fn();
    const steps = idleSteps();
    startIdlePrefetch({ queryClient: client, signedOut: false, start, idle: steps.idle });
    await hold(client, 'a').finish();
    await hold(client, 'b').finish();
    await steps.pass();
    await vi.advanceTimersByTimeAsync(PREFETCH_SAFETY_MS * 3);
    await steps.pass();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('starts nothing when the caller cancels before the start, also inside the gap', async () => {
    const client = new QueryClient();
    const start = vi.fn();
    const steps = idleSteps();
    const cancel = startIdlePrefetch({ queryClient: client, signedOut: false, start, idle: steps.idle });
    cancel();
    await hold(client, 'a').finish();
    await steps.pass();
    await vi.advanceTimersByTimeAsync(PREFETCH_SAFETY_MS * 2);
    expect(start).not.toHaveBeenCalled();
    const second = idleSteps();
    const cancelLate = startIdlePrefetch({ queryClient: new QueryClient(), signedOut: true, start, idle: second.idle });
    second.runAll();
    cancelLate();
    await vi.advanceTimersByTimeAsync(PREFETCH_GAP_MS * 2);
    expect(start).not.toHaveBeenCalled();
  });
});

describe('the order and the pace of the screen imports', () => {
  it('names every screen once, and the likely next screens first: Projects, the project page, Tasks, Inbox', () => {
    const order = prefetchOrder();
    expect([...order].sort()).toEqual([...SCREEN_NAMES].sort());
    expect(new Set(order).size).toBe(order.length);
    expect(order.slice(0, 4)).toEqual(['projects', 'project', 'work', 'inbox']);
  });

  it('holds the Me screens, and puts the Me tab after the other likely screens', () => {
    const order = prefetchOrder();
    expect(order).toEqual(expect.arrayContaining(['me', 'meSection']));
    expect(order.indexOf('me')).toBe(7);
  });

  it('runs 3 imports at most at once', () => {
    expect(PREFETCH_AT_ONCE).toBe(3);
  });

  it('imports no screen before the first rows, and then at most 3 at once, in order (held answers and held imports)', async () => {
    vi.useFakeTimers();
    try {
      const names = ['projects', 'project', 'work', 'inbox', 'dashboard'] as const;
      const started: string[] = [];
      const finish = new Map<string, () => void>();
      const loaders = Object.fromEntries(
        names.map((name) => [name, () => new Promise<ComponentType>((resolve) => { started.push(name); finish.set(name, () => resolve(Screen)); })]),
      ) as Record<(typeof names)[number], () => Promise<ComponentType>>;
      const cache = screenCache(loaders);
      const client = new QueryClient();
      const steps = idleSteps();
      startIdlePrefetch({
        queryClient: client,
        signedOut: false,
        idle: steps.idle,
        start: () => cache.prefetchScreens(names, (run) => run(), undefined, { limit: PREFETCH_AT_ONCE }),
      });
      const session = hold(client, 'session.get');
      await vi.advanceTimersByTimeAsync(4_000);
      steps.runAll();
      expect(started).toEqual([]);
      await session.finish();
      expect(started).toEqual([]);
      await steps.pass();
      expect(started).toEqual(['projects', 'project', 'work']);
      finish.get('projects')?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(started).toEqual(['projects', 'project', 'work', 'inbox']);
    } finally {
      vi.useRealTimers();
    }
  });
});
