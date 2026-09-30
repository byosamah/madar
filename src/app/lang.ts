import { useTranslation } from 'react-i18next';
import type { Lang } from '../lib/dates';

/** The interface language, for formatDay and formatNumber. */
export function useLang(): Lang {
  const { i18n } = useTranslation();
  return i18n.language === 'ar' ? 'ar' : 'en';
}
