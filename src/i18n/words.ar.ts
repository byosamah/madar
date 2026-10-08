import baseAr from './ar.json';
import { mergeWords, partsOf } from './mergeWords';

/** The Arabic words: the base file plus the Arabic file of each track. The screens load it on demand (src/i18n/index.ts). */
export const ar: typeof baseAr = mergeWords(baseAr, partsOf(import.meta.glob('./real/*.ar.json', { eager: true, import: 'default' })));
