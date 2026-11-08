import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { app as appAr, common as commonAr, errors as errorsAr, settings as settingsAr, admin as adminAr } from '../i18n/ar.json';
import { fields as fieldsAr } from '../i18n/real/clients.ar.json';
import { errors as errorsCoreAr } from '../i18n/real/core.ar.json';
import { subCompanies as subCompaniesAr } from '../i18n/real/subcompanies.ar.json';
import { app as appEn, common as commonEn, errors as errorsEn, settings as settingsEn, admin as adminEn } from '../i18n/en.json';
import { fields as fieldsEn } from '../i18n/real/clients.en.json';
import { errors as errorsCoreEn } from '../i18n/real/core.en.json';
import { subCompanies as subCompaniesEn } from '../i18n/real/subcompanies.en.json';
import { enterprises as enterprisesAr, errors as errorsAr2 } from '../i18n/real/ent-c.ar.json';
import { enterprises as enterprisesEn, errors as errorsEn2 } from '../i18n/real/ent-c.en.json';
import { enterprises as notCountedAr } from '../i18n/real/ent-ui.ar.json';
import { enterprises as notCountedEn } from '../i18n/real/ent-ui.en.json';
import siteAr from '../i18n/real/ent-f2.ar.json';
import siteEn from '../i18n/real/ent-f2.en.json';
import { mergeWords } from '../i18n/mergeWords';
import type { Language } from '../api/contract/entities';

/**
 * The words of the site Madar enterprises (design 12, D7). The site has its own small word tree: the groups that the shared parts use (common, fields,
 * errors, the logo words of sub-companies, the language names, the Save word), the page words (`enterprises`, in ent-c and ent-ui) and the words of the
 * site itself (`platformSite`, in ent-f2). Both languages are in the script file, because the tree is small and the switch must be instant.
 * A named import of a JSON file keeps only the groups that are named, so the words of the companies' screens stay out of this site.
 * `words.test.ts` renders the site and fails on a key that the tree lacks.
 */
type Tree = { [key: string]: string | Tree };

const pick = (tree: unknown, keys: string[]): Tree => Object.fromEntries(keys.map((key) => [key, (tree as Tree)[key]])) as Tree;

function build(l: { app: Tree; common: Tree; errors: Tree; errorsCore: Tree; fields: Tree; settings: Tree; subCompanies: Tree; admin: Tree; enterprises: Tree; errors2: Tree; notCounted: Tree; site: Tree }): Tree {
  return mergeWords(
    {
      app: l.app,
      common: l.common,
      errors: l.errors,
      fields: l.fields,
      // Only the language names of Settings and the Save word of Admin are used.
      settings: pick(l.settings, ['languages']),
      subCompanies: pick(l.subCompanies, ['changeLogo', 'chooseLogo', 'logoTooBig', 'logoUnreadable']),
      admin: pick(l.admin, ['save']),
    } as Tree,
    [
      { file: 'core', words: { errors: l.errorsCore } },
      { file: 'ent-c', words: { enterprises: l.enterprises, errors: l.errors2 } },
      { file: 'ent-ui', words: { enterprises: l.notCounted } },
      { file: 'ent-f2', words: l.site },
    ],
  );
}

export const WORDS: Record<Language, Tree> = {
  en: build({ app: appEn, common: commonEn, errors: errorsEn, errorsCore: errorsCoreEn, fields: fieldsEn, settings: settingsEn, subCompanies: subCompaniesEn, admin: adminEn, enterprises: enterprisesEn, errors2: errorsEn2, notCounted: notCountedEn, site: siteEn } as never),
  ar: build({ app: appAr, common: commonAr, errors: errorsAr, errorsCore: errorsCoreAr, fields: fieldsAr, settings: settingsAr, subCompanies: subCompaniesAr, admin: adminAr, enterprises: enterprisesAr, errors2: errorsAr2, notCounted: notCountedAr, site: siteAr } as never),
};

/** The key of the language that a person chose on this device. */
export const PLATFORM_LANGUAGE_KEY = 'madar.platform.lang';

/** The saved language, else the browser's. Blocked storage gives the browser's. */
export function startLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(PLATFORM_LANGUAGE_KEY);
    if (saved === 'en' || saved === 'ar') return saved;
  } catch {
    // Blocked storage: the browser language stands.
  }
  return (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

/** Sets the language and the direction of the page together. */
export function applyLanguage(language: Language, save = false): void {
  void i18n.changeLanguage(language);
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  if (!save) return;
  try {
    window.localStorage.setItem(PLATFORM_LANGUAGE_KEY, language);
  } catch {
    // Blocked storage: the choice lasts until the page closes.
  }
}

/** Starts i18next with the words of both languages. */
export function initSiteI18n(language: Language): typeof i18n {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      lng: language,
      fallbackLng: 'en',
      resources: { en: { translation: WORDS.en }, ar: { translation: WORDS.ar } },
      interpolation: { escapeValue: false },
      initAsync: false,
    });
  }
  applyLanguage(language);
  return i18n;
}
