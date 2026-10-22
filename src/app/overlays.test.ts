import { describe, expect, it, vi } from 'vitest';

/** The first address decides which chunk starts next to the first screens (performance audit 2026-10-21, FL-1). */
describe('warmForAddress', () => {
  it('starts the task panel for Home with ?task= (a push link) and for no other address', async () => {
    const warm = vi.fn();
    vi.doMock('../features/home/HomeTaskSheet', () => ({ warmTaskSheet: warm, HomeTaskSheet: () => null, taskSheetLoaded: () => false }));
    vi.resetModules();
    const { warmForAddress } = await import('./overlays');
    warmForAddress('/', '');
    warmForAddress('/', '?project=prj_001');
    warmForAddress('/projects', '?task=tsk_001');
    expect(warm).not.toHaveBeenCalled();
    warmForAddress('/', '?task=tsk_001&project=prj_001');
    expect(warm).toHaveBeenCalledTimes(1);
    vi.doUnmock('../features/home/HomeTaskSheet');
  });
});
