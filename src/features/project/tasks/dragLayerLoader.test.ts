import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetDragLayerForTests, loadedDragLayer, warmDragLayer } from './dragLayerLoader';

// Safari on iPhone has no requestIdleCallback (owner, 2026-10-21). The warm step goes through whenIdle, which waits 200 ms there.
describe('the warm step of the drag layer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    forgetDragLayerForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    forgetDragLayerForTests();
  });

  it('waits 200 ms where the browser has no requestIdleCallback, and loads the layer then', async () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    warmDragLayer();
    expect(loadedDragLayer()).toBeNull();
    await vi.advanceTimersByTimeAsync(199);
    expect(loadedDragLayer()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    await vi.waitFor(() => expect(loadedDragLayer()).not.toBeNull(), { timeout: 20_000 });
  });

  it('waits for the idle callback where the browser has one', async () => {
    const queue: Array<() => void> = [];
    vi.stubGlobal('requestIdleCallback', (run: () => void) => { queue.push(run); return 1; });
    warmDragLayer();
    await vi.advanceTimersByTimeAsync(1000);
    expect(queue).toHaveLength(1);
    expect(loadedDragLayer()).toBeNull();
    vi.useRealTimers();
    queue[0]!();
    await vi.waitFor(() => expect(loadedDragLayer()).not.toBeNull(), { timeout: 20_000 });
  });
});
