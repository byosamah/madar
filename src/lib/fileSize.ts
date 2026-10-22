import type { TFunction } from 'i18next';
import { formatNumber, type Lang } from './dates';

/**
 * The size of a file in words: whole KB under 1 MB (at least 1 KB), else MB with one decimal. Western digits in both languages.
 * The task panel on a phone and the Files tab of a project show the same words.
 */
export function fileSizeText(size: number, t: TFunction, lang: Lang): string {
  return size < 1024 * 1024
    ? t('files.kb', { n: formatNumber(Math.max(1, Math.round(size / 1024)), lang) })
    : t('files.mb', { n: formatNumber(size / (1024 * 1024), lang, 1) });
}
