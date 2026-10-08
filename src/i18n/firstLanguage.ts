import type { Language } from '../api/contract/entities';

/**
 * The language of the first screen of the remote build (client map 7.4). main.tsx reads it before the bootstrap, so the words
 * of that language load next to it (performance audit BND-7). src/app/remote/bootstrap.ts exports these again.
 */

/** The language of the first screen: the one saved on this device, else the first of the browser that Madar has. */
export function firstLanguage(saved: string | null, browser: readonly string[]): Language {
  if (saved === 'ar' || saved === 'en') return saved;
  for (const tag of browser) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'ar' || base === 'en') return base;
  }
  return 'en';
}

/** The saved language key of the sign-in screens (src/features/auth/AuthPage.tsx, LANGUAGE_KEY). */
const LANGUAGE_KEY = 'madar.lang';

/** firstLanguage with the values of this browser. Blocked storage counts as nothing saved. */
export function browserLanguage(): Language {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(LANGUAGE_KEY);
  } catch {
    // Blocked storage.
  }
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  return firstLanguage(saved, list.filter(Boolean));
}
