import {
  KeyboardSensor, MouseSensor, PointerSensor, TouchSensor, useSensor, useSensors,
  type KeyboardCoordinateGetter, type SensorDescriptor, type SensorOptions,
} from '@dnd-kit/core';
import { useMemo } from 'react';
import { prefersReducedMotion } from '../../../lib/motion';
import { useTouchPhone } from './useTouchPhone';

// DragLayer and TaskBoard take the reduced-motion test from here. The test itself sits in `lib/motion.ts`, which a screen file can import.
export { prefersReducedMotion };

/** The time a finger stays still on a row or a card before it lifts (phone design D, owner 2026-10-22). */
export const HOLD_MS = 400;
/** The finger may move this far during the hold. More than that is a scroll, and the hold ends. */
export const HOLD_TOLERANCE_PX = 8;

// The touch options are one object for the life of the page (RN-5): a new object gives dnd-kit new sensors and every row renders again.
const TOUCH_OPTIONS = { activationConstraint: { delay: HOLD_MS, tolerance: HOLD_TOLERANCE_PX } };

/**
 * The sensors of a drag. A touch phone gets the mouse (a distance), the finger (a 400 ms hold) and the keyboard. Every other screen gets
 * the pointer and the keyboard, as before. The hooks run in the same order at each render, and the array keeps its identity while the
 * kind of screen, the distance and the coordinate getter stay the same.
 * Only `DragLayer.tsx` and `TaskBoard.tsx` import this file: it holds dnd-kit values, and the first load must not.
 */
export function useDragSensors(distance: number, coordinateGetter: KeyboardCoordinateGetter): SensorDescriptor<SensorOptions>[] {
  const touch = useTouchPhone();
  const distanceOptions = useMemo(() => ({ activationConstraint: { distance } }), [distance]);
  const keyboardOptions = useMemo(() => ({ coordinateGetter }), [coordinateGetter]);
  const pointer = useSensor(PointerSensor, distanceOptions);
  const mouse = useSensor(MouseSensor, distanceOptions);
  const finger = useSensor(TouchSensor, TOUCH_OPTIONS);
  const keyboard = useSensor(KeyboardSensor, keyboardOptions);
  return useSensors(touch ? undefined : pointer, touch ? mouse : undefined, touch ? finger : undefined, keyboard);
}
