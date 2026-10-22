import { useSyncExternalStore } from 'react';

const COARSE = '(pointer: coarse)';

// One media list and one listener for the whole app, however many bubbles and rows ask (performance audit 2026-10-21, RN-3).
const listeners = new Set<() => void>();
let query: MediaQueryList | null = null;
const onChange = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    query = window.matchMedia(COARSE);
    query.addEventListener('change', onChange);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && query) {
      query.removeEventListener('change', onChange);
      query = null;
    }
  };
}

/**
 * True where the main pointer is a finger (the media query of the Tailwind class `pointer-coarse:`). A part that CSS hides on a touch
 * screen uses it to leave out the part itself, and so builds none of its nodes. It follows a change of the pointer.
 */
export function usePointerCoarse(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(COARSE).matches, () => false);
}
