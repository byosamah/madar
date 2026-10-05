import type { Preferences } from '../api/contract/entities';

export type Appearance = { theme: 'light' | 'dark'; glass: 'clear' | 'frosted' | 'solid'; contrast: 'normal' | 'more' };
export type Environment = { prefersDark: boolean; reduceTransparency: boolean; moreContrast: boolean };

export const ENV_QUERIES = ['(prefers-color-scheme: dark)', '(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)'];

export function resolveAppearance(prefs: Pick<Preferences, 'theme' | 'glass'>, env: Environment): Appearance {
  return {
    theme: prefs.theme === 'system' ? (env.prefersDark ? 'dark' : 'light') : prefs.theme,
    glass: env.reduceTransparency ? 'solid' : prefs.glass,
    contrast: env.moreContrast ? 'more' : 'normal',
  };
}

export function readEnvironment(win: Window = window): Environment {
  const matches = (query: string) => win.matchMedia?.(query).matches ?? false;
  return {
    prefersDark: matches(ENV_QUERIES[0]),
    reduceTransparency: matches(ENV_QUERIES[1]),
    moreContrast: matches(ENV_QUERIES[2]),
  };
}

/** The theme of the last person who signed in on this device. The screens before sign-in use it. */
export const THEME_KEY = 'madar.theme';
const THEMES: readonly Preferences['theme'][] = ['system', 'light', 'dark'];

/** The theme of the screens before sign-in: the choice saved on this device, else light (owner, 2026-10-05, item 11). */
export function deviceTheme(): Preferences['theme'] {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    return THEMES.includes(saved as Preferences['theme']) ? (saved as Preferences['theme']) : 'light';
  } catch {
    return 'light';
  }
}

export function saveDeviceTheme(theme: Preferences['theme']): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Blocked storage: the screens before sign-in stay light.
  }
}

export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  root.dataset.theme = appearance.theme;
  root.dataset.glass = appearance.glass;
  root.dataset.contrast = appearance.contrast;
  root.ownerDocument.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearance.theme === 'dark' ? '#000000' : '#F5F5F7');
}
