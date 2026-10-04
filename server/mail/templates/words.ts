import i18next, { type TFunction } from 'i18next';
import type { Language } from '../../../src/api/contract/entities';
import { ar, en } from '../../../src/i18n/trees';

/**
 * The words of the mail (plan 5.4): the merged word trees of the screens (src/i18n/trees.ts, with src/i18n/real/mail.*.json), in
 * an i18next instance of the server's own, so the server never touches the instance of the screens. i18next picks the Arabic
 * plural forms from "count" and the "_female" forms from "context", as on the screens (src/lib/grammar.ts).
 * escapeValue is off: the templates escape each text for HTML after it is complete.
 */
const instance = i18next.createInstance();
void instance.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: en }, ar: { translation: ar } },
  interpolation: { escapeValue: false },
  initAsync: false,
});

export function mailWords(lang: Language): TFunction {
  return instance.getFixedT(lang);
}
