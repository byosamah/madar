import baseEn from './en.json';
import { mergeWords, partsOf } from './mergeWords';

/** The English words: the base file plus the English file of each track. The screens load it on demand (src/i18n/index.ts). */
export const en: typeof baseEn = mergeWords(baseEn, partsOf(import.meta.glob('./real/*.en.json', { eager: true, import: 'default' })));
