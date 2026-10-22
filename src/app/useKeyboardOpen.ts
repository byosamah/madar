import { useViewportState } from './useVisualViewport';

/** The keyboard hides more than this many pixels of the window. */
const KEYBOARD_MIN = 150;

/**
 * True while the on-screen keyboard is open. The visible viewport is then more than 150 px shorter than the window. A pinch
 * zoom also makes the viewport shorter, so a zoomed page never counts. False where `visualViewport` is absent.
 */
export function useKeyboardOpen(): boolean {
  const state = useViewportState();
  if (!state) return false;
  return window.innerHeight - state.height > KEYBOARD_MIN && state.scale <= 1.01;
}
