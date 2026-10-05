import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// No session: the remote build before sign-in (X2, signin.spec). session.get has no data there.
vi.mock('./runtime', () => ({
  useCall: () => ({ data: undefined }),
  useRuntime: () => ({ auth: { status: () => 'signed_out', subscribe: () => () => undefined } }),
}));

import { AppearanceSync } from './AppearanceSync';
import { THEME_KEY } from './appearance';

const realMatchMedia = window.matchMedia;

function deviceDark(dark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: dark && query === '(prefers-color-scheme: dark)',
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = realMatchMedia;
  delete document.documentElement.dataset.theme;
  window.localStorage.removeItem(THEME_KEY);
});

describe('AppearanceSync with no session (X2 merge lead patch)', () => {
  // The owner (2026-10-05, item 11): the screens before sign-in are light, also on a dark device, unless this device saved a choice.
  it('applies light before sign-in, also on a dark device', () => {
    deviceDark(true);
    render(<AppearanceSync />);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('applies the theme saved on this device before sign-in', () => {
    deviceDark(false);
    window.localStorage.setItem(THEME_KEY, 'dark');
    render(<AppearanceSync />);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('follows a dark device when the saved choice is System', () => {
    deviceDark(true);
    window.localStorage.setItem(THEME_KEY, 'system');
    render(<AppearanceSync />);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies light when the saved value is not a theme', () => {
    deviceDark(true);
    window.localStorage.setItem(THEME_KEY, 'purple');
    render(<AppearanceSync />);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('applies light on a light device', () => {
    deviceDark(false);
    render(<AppearanceSync />);
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
