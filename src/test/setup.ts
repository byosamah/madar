import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setNow } from '../lib/dates';

// jsdom has no matchMedia. The app reads device settings through it.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false, media: query, onchange: null,
      addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom has no pointer capture. Vaul calls it when a person presses inside a sheet.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
}

// File previews and covers use blob URLs. The test browser's own helper fails on these blobs, so tests use a fixed URL.
URL.createObjectURL = () => 'blob:madar-test';
URL.revokeObjectURL = () => undefined;
// cmdk measures its list and scrolls the selected item into view. jsdom has neither.
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
// React Router's ScrollRestoration scrolls the page; jsdom has no page scroll.
window.scrollTo = (() => undefined) as typeof window.scrollTo;

afterEach(() => {
  window.localStorage.clear();
  cleanup();
  // The meeting keeps its session for the day in the session storage, so each test starts a new meeting.
  // The clear comes after the unmount, because a meeting saves its clock when it closes.
  try {
    window.sessionStorage.clear();
  } catch {
    // A test blocked the storage, so it holds nothing.
  }
  setNow(null);
  const root = document.documentElement;
  for (const name of ['dir', 'lang', 'data-theme', 'data-glass', 'data-contrast']) root.removeAttribute(name);
});
