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

export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  root.dataset.theme = appearance.theme;
  root.dataset.glass = appearance.glass;
  root.dataset.contrast = appearance.contrast;
  root.ownerDocument.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearance.theme === 'dark' ? '#000000' : '#F5F5F7');
}
