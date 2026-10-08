import { useSyncExternalStore } from 'react';
import { getI18n } from 'react-i18next';
import type { Lang } from '../lib/dates';

// The one i18next instance of the app (src/i18n/index.ts), the same one that useTranslation finds.
const subscribe = (onChange: () => void) => {
  const i18n = getI18n();
  if (!i18n) return () => undefined;
  i18n.on('languageChanged', onChange);
  return () => i18n.off('languageChanged', onChange);
};
const snapshot = (): Lang => (getI18n()?.language === 'ar' ? 'ar' : 'en');

/**
 * The interface language, for formatDay and formatNumber. It listens only to a language change, the same event that renders
 * useTranslation again, without the rest of that hook: every row and picture reads it (performance audit 2026-10-07, RND-8).
 */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, snapshot);
}
