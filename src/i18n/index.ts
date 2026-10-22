import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Language } from '../api/contract/entities';

/**
 * The words of each language load on demand (performance audit BND-7): the first screen waits only for its own language, and
 * main.tsx loads the other one after the first reads settled (otherLanguage.ts). The tests and the server read both trees from trees.ts, and
 * src/test/setup.ts gives both to this module with addWords. The prototype keeps one script file, so its words are in it.
 */
const loaded = new Map<Language, object>();
const loading = new Map<Language, Promise<void>>();

/** Gives the words of a language to i18next. Before initI18n they wait here, and initI18n takes them. */
export function addWords(language: Language, words: object): void {
  loaded.set(language, words);
  if (i18n.isInitialized) i18n.addResourceBundle(language, 'translation', words, true, true);
}

/** True when the words of the language are there. */
export function wordsReady(language: Language): boolean {
  return loaded.has(language);
}

/** Loads the words of a language once. A failed load leaves nothing, so the next call tries again. */
export function loadWords(language: Language): Promise<void> {
  if (loaded.has(language)) return Promise.resolve();
  let promise = loading.get(language);
  if (!promise) {
    const words = language === 'ar' ? import('./words.ar').then((m) => m.ar) : import('./words.en').then((m) => m.en);
    promise = words.then(
      (tree) => {
        loading.delete(language);
        addWords(language, tree);
      },
      (error: unknown) => {
        loading.delete(language);
        throw error;
      },
    );
    loading.set(language, promise);
  }
  return promise;
}

/**
 * Runs apply when the words of the language are there: at once when they are, else after they load. So a language switch
 * changes the direction and the words together, and never shows one language in the direction of the other. A failed load
 * applies nothing. The function that it returns cancels a late apply.
 */
export function withWords(language: Language, apply: () => void): () => void {
  if (loaded.has(language)) {
    apply();
    return () => undefined;
  }
  let live = true;
  loadWords(language).then(
    () => {
      if (live) apply();
    },
    () => undefined,
  );
  return () => {
    live = false;
  };
}

/** Starts i18next in a language, or switches to it. The words of that language must be there (loadWords). */
export function initI18n(language: Language = 'en'): typeof i18n {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      lng: language,
      fallbackLng: 'en',
      resources: Object.fromEntries([...loaded].map(([lang, words]) => [lang, { translation: words }])),
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
