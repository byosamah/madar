import { describe, expect, it } from 'vitest';
import { KeyboardSensor, MouseSensor, PointerSensor, TouchSensor } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { act, renderHook } from '@testing-library/react';
import { phoneMedia } from '../../../test/phoneMedia';
import { prefersReducedMotion } from '../../../lib/motion';
import { HOLD_MS, HOLD_TOLERANCE_PX, useDragSensors } from './dragSensors';
import { reduceMotion } from './testMotion';
import { useTouchPhone } from './useTouchPhone';

describe('the drag sensors', () => {
  it('gives a touch phone Mouse, Touch and Keyboard', () => {
    phoneMedia({ phone: true, coarse: true });
    const { result } = renderHook(() => useDragSensors(4, sortableKeyboardCoordinates));
    expect(result.current.map((s) => s.sensor)).toEqual([MouseSensor, TouchSensor, KeyboardSensor]);
    expect(result.current[0]!.options).toEqual({ activationConstraint: { distance: 4 } });
    expect(result.current[1]!.options).toEqual({ activationConstraint: { delay: 400, tolerance: 8 } });
    expect(result.current[2]!.options).toEqual({ coordinateGetter: sortableKeyboardCoordinates });
    expect([HOLD_MS, HOLD_TOLERANCE_PX]).toEqual([400, 8]);
  });

  it('gives a desk, and a narrow window with a mouse, Pointer and Keyboard', () => {
    phoneMedia({ phone: true, coarse: false });
    const narrow = renderHook(() => useDragSensors(4, sortableKeyboardCoordinates));
    expect(narrow.result.current.map((s) => s.sensor)).toEqual([PointerSensor, KeyboardSensor]);
    expect(narrow.result.current[0]!.options).toEqual({ activationConstraint: { distance: 4 } });
    narrow.unmount();
    phoneMedia({ phone: false, coarse: true });
    const wide = renderHook(() => useDragSensors(8, sortableKeyboardCoordinates));
    expect(wide.result.current.map((s) => s.sensor)).toEqual([PointerSensor, KeyboardSensor]);
    expect(wide.result.current[0]!.options).toEqual({ activationConstraint: { distance: 8 } });
  });

  it('keeps the same array and options between renders', () => {
    phoneMedia({ phone: true, coarse: true });
    const { result, rerender } = renderHook(() => useDragSensors(4, sortableKeyboardCoordinates));
    const first = result.current;
    const options = first.map((s) => s.options);
    rerender();
    expect(result.current).toBe(first);
    expect(result.current.map((s) => s.options)).toEqual(options);
    result.current.forEach((s, i) => expect(s.options).toBe(options[i]));
  });

  it('follows a change of the screen without a change in the order of the hooks', () => {
    const media = phoneMedia({ phone: false, coarse: true });
    const { result } = renderHook(() => useDragSensors(4, sortableKeyboardCoordinates));
    expect(result.current.map((s) => s.sensor)).toEqual([PointerSensor, KeyboardSensor]);
    act(() => media.set(true));
    expect(result.current.map((s) => s.sensor)).toEqual([MouseSensor, TouchSensor, KeyboardSensor]);
  });

  it('reads the reduced motion query at the call', () => {
    phoneMedia({ phone: true, coarse: true });
    expect(prefersReducedMotion()).toBe(false);
    reduceMotion();
    expect(prefersReducedMotion()).toBe(true);
  });

  it('knows a touch phone only when the width and the finger agree', () => {
    phoneMedia({ phone: true, coarse: true });
    expect(renderHook(() => useTouchPhone()).result.current).toBe(true);
    phoneMedia({ phone: true, coarse: false });
    expect(renderHook(() => useTouchPhone()).result.current).toBe(false);
  });
});
