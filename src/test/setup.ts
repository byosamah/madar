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

afterEach(() => {
  cleanup();
  setNow(null);
  const root = document.documentElement;
  for (const name of ['dir', 'lang', 'data-theme', 'data-glass', 'data-contrast']) root.removeAttribute(name);
});
