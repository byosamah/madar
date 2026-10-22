import { useViewportState } from './useVisualViewport';

/** The keyboard hides more than this many pixels of the window. */
const KEYBOARD_MIN = 150;

/**
 * True while the on-screen keyboard is open. The visible viewport is then more than 150 px shorter than the window. A pinch
 * zoom also makes the viewport shorter, so a zoomed page never counts. False where `visualViewport` is absent.
 */
export function useKeyboardOpen(): boolean {
  // The state only makes the hook render again. The numbers come live from the viewport: a render that another hook starts between a
  // window resize and the viewport event would pair the new window height with the old viewport height, and the bar would hide and
  // fade back (found with a full-page screenshot, which sets the window to 1 px and back).
  const state = useViewportState();
  const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
  if (!state || !viewport) return false;
  return window.innerHeight - viewport.height > KEYBOARD_MIN && (viewport.scale ?? 1) <= 1.01;
}
