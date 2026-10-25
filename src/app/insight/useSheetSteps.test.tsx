import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const noteSheet = vi.hoisted(() => vi.fn());
vi.mock('./notes', () => ({ noteSheet }));

import { useSheetSteps } from './useSheetSteps';

describe('useSheetSteps', () => {
  beforeEach(() => noteSheet.mockReset());

  it('open then close gives open and close_unsaved', () => {
    const { rerender } = renderHook(({ open }) => useSheetSteps('newTask', open), { initialProps: { open: false } });
    expect(noteSheet).not.toHaveBeenCalled();
    rerender({ open: true });
    rerender({ open: false });
    expect(noteSheet.mock.calls).toEqual([['newTask', 'open'], ['newTask', 'close_unsaved']]);
  });

  it('open, saved and close gives open and save, and no close_unsaved', () => {
    const { result, rerender } = renderHook(({ open }) => useSheetSteps('payment', open), { initialProps: { open: true } });
    result.current();
    rerender({ open: false });
    expect(noteSheet.mock.calls).toEqual([['payment', 'open'], ['payment', 'save']]);
  });

  it('a sheet that is mounted only while open counts its unmount as a close', () => {
    const { unmount } = renderHook(() => useSheetSteps('meeting', true));
    unmount();
    expect(noteSheet.mock.calls).toEqual([['meeting', 'open'], ['meeting', 'close_unsaved']]);
  });

  it('a save step on a closed sheet counts nothing', () => {
    const { result } = renderHook(() => useSheetSteps('trackerLog', false));
    result.current();
    expect(noteSheet).not.toHaveBeenCalled();
  });

  it('a new open starts clean: the next close is unsaved again', () => {
    const { result, rerender } = renderHook(({ open }) => useSheetSteps('feedback', open), { initialProps: { open: true } });
    result.current();
    rerender({ open: false });
    rerender({ open: true });
    rerender({ open: false });
    expect(noteSheet.mock.calls).toEqual([['feedback', 'open'], ['feedback', 'save'], ['feedback', 'open'], ['feedback', 'close_unsaved']]);
  });
});
