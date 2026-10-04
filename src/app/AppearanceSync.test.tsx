import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// No session: the remote build before sign-in (X2, signin.spec). session.get has no data there.
vi.mock('./runtime', () => ({
  useCall: () => ({ data: undefined }),
  useRuntime: () => ({ auth: { status: () => 'signed_out', subscribe: () => () => undefined } }),
}));

import { AppearanceSync } from './AppearanceSync';

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
});

describe('AppearanceSync with no session (X2 merge lead patch)', () => {
  it('applies the device theme before sign-in, as the System theme does', () => {
    deviceDark(true);
    render(<AppearanceSync />);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies light on a light device', () => {
    deviceDark(false);
    render(<AppearanceSync />);
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
