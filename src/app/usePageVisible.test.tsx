import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePageVisible } from './usePageVisible';

const show = (visible: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
  document.dispatchEvent(new Event('visibilitychange'));
};

afterEach(() => {
  Reflect.deleteProperty(document, 'hidden');
  vi.restoreAllMocks();
});

describe('usePageVisible (chat design item 5)', () => {
  it('follows the visibility of the tab', () => {
    const { result } = renderHook(() => usePageVisible());
    expect(result.current).toBe(true);
    act(() => show(false));
    expect(result.current).toBe(false);
    act(() => show(true));
    expect(result.current).toBe(true);
  });
});
