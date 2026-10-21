/**
 * The search of the emoji panel (chat presence design D4, track emoji E1). One field finds the English and the Arabic names and the
 * keywords at the same time, whatever the screen language. The Arabic is folded first: the short vowels, the tatweel and the forms of
 * alef, teh marbuta and alef maksura do not count, so a person need not type them. Plain functions with no React, so a test reads them.
 */

/** One emoji of the data file. `s` holds the five forms with a skin tone, light to dark, for an emoji that has them. */
export type EmojiItem = { e: string; en: string; ar: string; k: string[]; ka: string[]; s?: string[] };

/** The marks of Arabic that a search ignores: the short vowels (U+064B to U+0652), the dagger alef (U+0670) and the tatweel (U+0640). */
const MARKS = /[ً-ْٰـ]/g;

/** The text for a comparison: no marks, one form for each pair of look-alike letters, and Latin letters in lower case. */
export function foldArabic(text: string): string {
  return text
    .replace(MARKS, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase();
}

/** The words of a folded text: runs of letters and digits. */
const wordsOf = (text: string): string[] => foldArabic(text).match(/[\p{L}\p{N}]+/gu) ?? [];

/** The folded words of one item, cached for the life of the page: the search runs on each key. */
const cache = new WeakMap<EmojiItem, string[]>();
function itemWords(item: EmojiItem): string[] {
  let words = cache.get(item);
  if (!words) {
    words = [...new Set([item.en, item.ar, ...item.k, ...item.ka].flatMap(wordsOf))];
    cache.set(item, words);
  }
  return words;
}

/**
 * The items whose words start with every word of the query, in the order of the list (the groups, then the items), at most `limit`.
 * An empty query finds nothing: the panel shows its groups then.
 */
export function searchEmoji(groups: readonly { items: readonly EmojiItem[] }[], query: string, limit = 80): EmojiItem[] {
  const wanted = wordsOf(query);
  if (wanted.length === 0) return [];
  const found: EmojiItem[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      const words = itemWords(item);
      if (wanted.every((word) => words.some((own) => own.startsWith(word)))) {
        found.push(item);
        if (found.length >= limit) return found;
      }
    }
  }
  return found;
}
