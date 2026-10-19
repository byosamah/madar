import { excerptOf, normalizeForSearch, plainText } from './text';

/**
 * The words of a message search and the line of a hit (chat design 2026-10-19, item 16). One fold serves the server column, the
 * handler and the screen: `normalizeForSearch(plainText(body))`. This module imports no zod, so the Search screen chunk stays small.
 */
export const SEARCH_WORDS_MAX = 5;
export const MESSAGE_WORD_MIN = 3;
export const HIT_LINE_MAX = 120;

/** Trim, drop a first run of "#" or "@", fold, split on spaces, keep each word once, at most 5. */
export function searchWords(text: string): string[] {
  const folded = normalizeForSearch(text.trim().replace(/^[#@]+/, ''));
  if (folded === '') return [];
  return [...new Set(folded.split(' '))].slice(0, SEARCH_WORDS_MAX);
}

/** True when one word has 3 code points or more. A 2-letter pattern has no trigram, so it never reads the messages. */
export function searchesMessages(words: readonly string[]): boolean {
  return words.some((word) => Array.from(word).length >= MESSAGE_WORD_MIN);
}

/** The folded text of a body, with each mention as "@Name". The server column and the handler both call it. */
export function bodySearchText(body: string): string {
  return normalizeForSearch(plainText(body));
}

/** True when every word is a substring of the folded text. */
export function holdsWords(folded: string, words: readonly string[]): boolean {
  return words.every((word) => folded.includes(word));
}

function holdsAny(word: string, words: readonly string[]): boolean {
  const folded = normalizeForSearch(word);
  return words.some((search) => folded.includes(search));
}

/**
 * The line of a hit. A short text stays whole. A long text starts 3 words before the first word that holds a search word, with "…"
 * in front. When there is no such word, or fewer than max / 2 code points come before it, the line is the start of the text.
 */
export function hitLine(plain: string, words: readonly string[], max = HIT_LINE_MAX): string {
  const flat = plain.replace(/\s+/g, ' ').trim();
  const parts = flat === '' ? [] : flat.split(' ');
  const first = parts.findIndex((part) => holdsAny(part, words));
  if (first < 0) return excerptOf(flat, max);
  const before = Array.from(parts.slice(0, first).join(' ')).length;
  if (before < max / 2) return excerptOf(flat, max);
  return `…${excerptOf(parts.slice(Math.max(0, first - 3)).join(' '), max - 1)}`;
}

/** Each whole word whose fold holds a search word is one marked part. The text between marked words joins into one unmarked part. */
export function markedParts(line: string, words: readonly string[]): { text: string; marked: boolean }[] {
  const out: { text: string; marked: boolean }[] = [];
  for (const token of line.split(/(\s+)/)) {
    if (token === '') continue;
    const marked = !/^\s+$/.test(token) && holdsAny(token, words);
    const last = out[out.length - 1];
    if (!marked && last && !last.marked) last.text += token;
    else out.push({ text: token, marked });
  }
  return out;
}
