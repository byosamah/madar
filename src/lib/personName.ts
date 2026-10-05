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
