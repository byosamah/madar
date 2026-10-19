import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gated, GATE_GAP_MS, resetGate } from './nominatimGate';

beforeEach(() => {
  vi.useFakeTimers();
  resetGate();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A request that the test ends by hand. */
function manual() {
  let finish: (value: string) => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;
  const started = vi.fn();
  const run = () => {
    started();
    return new Promise<string>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
  };
  return { run, started, finish: (value = 'ok') => finish(value), fail: (error: unknown) => fail(error) };
}

describe('the request gate of OpenStreetMap (one request at a time, one second apart)', () => {
  it('starts the first request at once, in the same turn', () => {
    const first = manual();
    void gated(first.run);
    expect(first.started).toHaveBeenCalledTimes(1);
  });

  it('holds the second request until the first ends, and until one second after the first start', async () => {
    const first = manual();
    const second = manual();
    const one = gated(first.run);
    const two = gated(second.run);
    expect(second.started).not.toHaveBeenCalled();
    // The first request ends at once. The second still waits for the gap.
    first.finish('one');
    await expect(one).resolves.toBe('one');
    await vi.advanceTimersByTimeAsync(GATE_GAP_MS - 1);
    expect(second.started).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(second.started).toHaveBeenCalledTimes(1);
    second.finish('two');
    await expect(two).resolves.toBe('two');
  });

  it('holds the second request while the first runs, even after the gap', async () => {
    const first = manual();
    const second = manual();
    void gated(first.run);
    void gated(second.run);
    await vi.advanceTimersByTimeAsync(GATE_GAP_MS * 3);
    expect(second.started).not.toHaveBeenCalled();
    first.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(second.started).toHaveBeenCalledTimes(1);
  });

  it('counts the gap from the start of the first request, not from its end', async () => {
    const first = manual();
    const second = manual();
    void gated(first.run);
    void gated(second.run);
    await vi.advanceTimersByTimeAsync(GATE_GAP_MS * 2);
    first.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(second.started).toHaveBeenCalledTimes(1);
  });

  it('starts the next request at once when the last start is more than one second old', async () => {
    const first = manual();
    void gated(first.run);
    first.finish();
    await vi.advanceTimersByTimeAsync(GATE_GAP_MS + 1);
    const second = manual();
    void gated(second.run);
    expect(second.started).toHaveBeenCalledTimes(1);
  });

  it('runs a request that waited after a failed request, and passes the failure on', async () => {
    const first = manual();
    const second = manual();
    const one = gated(first.run);
    const two = gated(second.run);
    first.fail(new TypeError('Failed to fetch'));
    await expect(one).rejects.toThrow('Failed to fetch');
    await vi.advanceTimersByTimeAsync(GATE_GAP_MS);
    expect(second.started).toHaveBeenCalledTimes(1);
    second.finish('two');
    await expect(two).resolves.toBe('two');
  });

  it('treats a request that throws at once as a failed request', async () => {
    const one = gated(() => {
      throw new Error('broken');
    });
    await expect(one).rejects.toThrow('broken');
    const second = manual();
    void gated(second.run);
    await vi.advanceTimersByTimeAsync(GATE_GAP_MS);
    expect(second.started).toHaveBeenCalledTimes(1);
  });

  it('serves three waiting requests in the order that they came', async () => {
    const order: number[] = [];
    const runs = [1, 2, 3].map((n) => () => {
      order.push(n);
      return Promise.resolve(n);
    });
    const all = runs.map((run) => gated(run));
    await vi.advanceTimersByTimeAsync(GATE_GAP_MS * 3);
    await expect(Promise.all(all)).resolves.toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
  });
});
