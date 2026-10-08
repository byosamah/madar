/**
 * The word trees of both languages, at once. The server and the tests read them here. The screens load one language at a
 * time instead (loadWords, src/i18n/index.ts), so the first load holds the words of one language only (performance audit BND-7).
 */
export { mergeWords } from './mergeWords';
export { en } from './words.en';
export { ar } from './words.ar';
