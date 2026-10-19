import type { Lang } from './dates';
import { normalizeForSearch } from './text';

/** A person with an English name and an optional Arabic name (owner item 12, 2026-10-05). */
export type Named = { name: string; nameAr?: string | null };

/**
 * The name of a person in the screen language: Arabic screens show the Arabic name, English screens the English name.
 * When that name is missing, the other one shows. The same rule as clientName.
 */
export function personName(person: Named, lang: Lang): string {
  const arabic = person.nameAr?.trim() ?? '';
  const english = person.name.trim();
  return lang === 'ar' ? arabic || english : english || arabic;
}

/** Sorts people by the name that the screen shows. */
export function byPersonName(lang: Lang): (a: Named, b: Named) => number {
  return (a, b) => personName(a, lang).localeCompare(personName(b, lang), lang);
}

/** True when the search text is in the English name or in the Arabic name. An empty text matches everyone. */
export function matchesPerson(person: Named, query: string): boolean {
  const needle = normalizeForSearch(query);
  if (!needle) return true;
  return [person.name, person.nameAr ?? ''].some((name) => normalizeForSearch(name).includes(needle));
}

/**
 * A person's name that the server wrote into a text detail (an event or a row). The server writes the English name under
 * "key" and the Arabic name under "keyAr", so the screen picks the one of its language here.
 */
export function localName(detail: Record<string, string | undefined>, key: string, lang: Lang): string {
  return personName({ name: detail[key] ?? '', nameAr: detail[`${key}Ar`] }, lang);
}

/**
 * How well a person matches the letters typed after "@": 0 when a name starts with them, 1 when a later word of a name starts with
 * them ("Al-Harbi"), 2 when they sit inside a word, and -1 for no match. The best of the English and the Arabic name counts.
 */
export function matchRank(person: Named, query: string): number {
  const needle = normalizeForSearch(query);
  if (!needle) return 0;
  let best = -1;
  for (const name of [person.name, person.nameAr ?? '']) {
    const text = normalizeForSearch(name);
    if (!text.includes(needle)) continue;
    const words = text.split(/[\s-]+/);
    const rank = text.startsWith(needle) ? 0 : words.some((word) => word.startsWith(needle)) ? 1 : 2;
    best = best < 0 ? rank : Math.min(best, rank);
  }
  return best;
}

/** The people that match the letters, the names that start with them first. Equal ranks keep their order (the sort is stable). */
export function rankedMatches<T extends Named>(people: T[], query: string): T[] {
  return people
    .map((person) => ({ person, rank: matchRank(person, query) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.person);
}
