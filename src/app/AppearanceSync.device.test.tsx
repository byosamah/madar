import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPreferences } from '../api/contract/entities';

// A signed-in person who chose the dark theme.
vi.mock('./runtime', () => ({
  useCall: () => ({ data: { user: { preferences: { ...defaultPreferences(), theme: 'dark' } } } }),
  useRuntime: () => ({ auth: { status: () => 'signed_in', subscribe: () => () => undefined } }),
}));

import { AppearanceSync } from './AppearanceSync';
import { THEME_KEY } from './appearance';

afterEach(() => {
  delete document.documentElement.dataset.theme;
  window.localStorage.removeItem(THEME_KEY);
});

describe('AppearanceSync for a signed-in person (owner, 2026-10-05, item 11)', () => {
  it('applies the person\'s theme and saves it on this device for the screens before the next sign-in', () => {
    render(<AppearanceSync />);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark');
  });
});
