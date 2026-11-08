import { applyAppearance, ENV_QUERIES, readEnvironment } from '../app/appearance';

/** The key of the theme that a person chose on this device. Only light and dark: the site has no "system" choice, it starts from the device. */
export const PLATFORM_THEME_KEY = 'madar.platform.theme';
export type SiteTheme = 'light' | 'dark';

/** The saved theme, else the device's. Blocked storage gives the device's. */
export function startTheme(): SiteTheme {
  try {
    const saved = window.localStorage.getItem(PLATFORM_THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Blocked storage: the device theme stands.
  }
  return readEnvironment().prefersDark ? 'dark' : 'light';
}

/** Puts the theme on the page, and saves it when the person chose it. */
export function applyTheme(theme: SiteTheme, save = false): void {
  const env = readEnvironment();
  applyAppearance(document.documentElement, { theme, glass: env.reduceTransparency ? 'solid' : 'frosted', contrast: env.moreContrast ? 'more' : 'normal' });
  if (!save) return;
  try {
    window.localStorage.setItem(PLATFORM_THEME_KEY, theme);
  } catch {
    // Blocked storage: the choice lasts until the page closes.
  }
}

export { ENV_QUERIES };
