import { useCallback, useMemo } from 'react';
import { byPersonName, personName, type Named } from '../lib/personName';
import { useLang } from './lang';

/**
 * The name of a person in the screen language (owner item 12, 2026-10-05): the Arabic name on Arabic screens, the English name
 * on English screens, the other one when that is missing. Use: `const nameOf = usePersonName();` then `nameOf(user)`.
 */
export function usePersonName(): (person: Named) => string {
  const lang = useLang();
  return useCallback((person: Named) => personName(person, lang), [lang]);
}

/** Sorts people by the name that the screen shows: `[...people].sort(byName)`. */
export function useByPersonName(): (a: Named, b: Named) => number {
  const lang = useLang();
  return useMemo(() => byPersonName(lang), [lang]);
}
