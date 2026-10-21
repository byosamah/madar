import { useEffect, useRef, useState } from 'react';
import { usePageVisible } from '../usePageVisible';
import type { DeviceState } from './types';

/** A device is Online while the page is in view and the person used it (a key, a click, a touch, a scroll) in the last 10 minutes. */
export const ACTIVE_MS = 600_000;
/** A phone that stays out of view this long rests (leaves the status topics): the person then shows Offline sooner. */
export const REST_PHONE_MS = 60_000;
/** A computer tab that stays out of view this long rests. */
export const REST_COMPUTER_MS = 1_800_000;

/** The state of this device. A page out of view is Away at once, and Away by hand holds whatever the use. */
export function deviceStateOf(o: { visible: boolean; lastInputAt: number; now: number; awayByHand: boolean }): DeviceState {
  if (o.awayByHand || !o.visible) return 'away';
  return o.now - o.lastInputAt < ACTIVE_MS ? 'online' : 'away';
}

/** True when the page has been out of view for at least the rest time of its kind. A page in view never rests. */
export function restingOf(o: { hiddenSince: number | null; now: number; phone: boolean }): boolean {
  if (o.hiddenSince === null) return false;
  return o.now - o.hiddenSince >= (o.phone ? REST_PHONE_MS : REST_COMPUTER_MS);
}

/** The events that count as use. They are passive, on window, and scroll is in capture so a scroll of any pane counts. */
const INPUTS = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const;

/**
 * True while the page is in view and the person used it in the last ACTIVE_MS. The page load counts as use. A state changes only at the
 * edge (the first input after a pause, and the end of the 10 minutes), so a key never renders a screen.
 */
export function useActive(): boolean {
  const visible = usePageVisible();
  const lastInputAt = useRef(Date.now());
  const [recent, setRecent] = useState(true);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (delay: number) => {
      timer = setTimeout(() => {
        const left = lastInputAt.current + ACTIVE_MS - Date.now();
        if (left <= 0) {
          timer = undefined;
          setRecent(false);
        } else {
          arm(left);
        }
      }, delay);
    };
    const onInput = () => {
      lastInputAt.current = Date.now();
      setRecent(true);
      if (timer === undefined) arm(ACTIVE_MS);
    };
    onInput();
    for (const type of INPUTS) window.addEventListener(type, onInput, { passive: true });
    window.addEventListener('scroll', onInput, { passive: true, capture: true });
    return () => {
      for (const type of INPUTS) window.removeEventListener(type, onInput);
      window.removeEventListener('scroll', onInput, true);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);
  return visible && recent;
}

/**
 * The state of this device for the live port. Away by hand is the switch of the person (preferences.awayByHand). useActive has folded
 * the view and the last input already, so the rule gets them as one fact.
 */
export function useDeviceState(awayByHand: boolean): DeviceState {
  const active = useActive();
  return deviceStateOf({ visible: active, lastInputAt: 0, now: 0, awayByHand });
}

/**
 * True when this page has been out of view for the rest time of its kind (a phone 60 s, a computer 30 min; restingOf is the rule). A
 * page in view never rests, and it wakes at once when it shows again.
 */
export function useResting(phone: boolean): boolean {
  const visible = usePageVisible();
  const [resting, setResting] = useState(false);
  useEffect(() => {
    if (visible) {
      setResting(false);
      return undefined;
    }
    const since = Date.now();
    const timer = setTimeout(() => setResting(restingOf({ hiddenSince: since, now: Date.now(), phone })), phone ? REST_PHONE_MS : REST_COMPUTER_MS);
    return () => clearTimeout(timer);
  }, [visible, phone]);
  return resting;
}
