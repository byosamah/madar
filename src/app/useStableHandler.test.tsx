import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStableHandler } from './useStableHandler';

describe('useStableHandler', () => {
  it('keeps one function for the life of the component', () => {
    const { result, rerender } = renderHook(({ n }) => useStableHandler(() => n), { initialProps: { n: 1 } });
    const first = result.current;
    rerender({ n: 2 });
    expect(result.current).toBe(first);
  });

  it('runs the handler of the last render, with its arguments', () => {
    const { result, rerender } = renderHook(({ n }) => useStableHandler((a: number, b: number) => a + b + n), { initialProps: { n: 1 } });
    expect(result.current(1, 2)).toBe(4);
    rerender({ n: 10 });
    expect(result.current(1, 2)).toBe(13);
  });
});
