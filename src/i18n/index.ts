import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Language } from '../api/contract/entities';
import { ar, en } from './trees';

export { ar, en };

export function initI18n(language: Language = 'en'): typeof i18n {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      lng: language,
      fallbackLng: 'en',
      resources: { en: { translation: en }, ar: { translation: ar } },
      interpolation: { escapeValue: false },
      initAsync: false,
    });
  } else if (i18n.language !== language) {
    void i18n.changeLanguage(language);
  }
  return i18n;
}

export function applyLanguage(root: HTMLElement, language: Language): void {
  root.lang = language;
  root.dir = language === 'ar' ? 'rtl' : 'ltr';
}
