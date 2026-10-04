import i18next, { type TFunction } from 'i18next';
import type { Language } from '../../../src/api/contract/entities';
import ar from '../../../src/i18n/real/mail.ar.json';
import en from '../../../src/i18n/real/mail.en.json';

/**
 * The words of the mail (plan 5.4): the mail word files of the screens (src/i18n/real/mail.*.json, which the screens' tests check
 * with every other word file), in an i18next instance of the server's own, so the server never touches the instance of the
 * screens. i18next picks the Arabic plural forms from "count" and the "_female" forms from "context", as on the screens
 * (src/lib/grammar.ts). escapeValue is off: the templates escape each text for HTML after it is complete.
 * The templates read only mail.* keys, so the server imports the two JSON files and not src/i18n/trees.ts: its import.meta.glob
 * works only in a Vite build, and "wrangler dev" bundles the Workers entry with esbuild (server/it/workerdb.it.test.ts).
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
