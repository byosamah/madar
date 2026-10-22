import type { QueryClient } from '@tanstack/react-query';
import type { Language } from '../api/contract/entities';
import { loadWords } from './index';

/** The quiet time between the first settled reads and the load of the other language. */
export const OTHER_LANGUAGE_GAP_MS = 3000;

/**
 * Loads the words of the other language after the first screen is done (performance audit 2026-10-21, FL-7, option A). Before,
 * the load started at the first render, at the same time as the first reads: 38 to 48 KB gz for a person who never switches
 * language. Now it starts OTHER_LANGUAGE_GAP_MS after the first reads of the screen settled: no read on its way, and at least
 * one answer or error in the cache. A person who has no read (the sign-in page) loads nothing until a switch. A language switch
 * still works at any time: `withWords` loads the words and applies them when they are there (src/i18n/index.ts).
 * Returns the function that cancels the wait.
 */
export function loadOtherLanguageLater(o: {
  queryClient: QueryClient;
  language: Language;
  load?: (language: Language) => Promise<void>;
  gapMs?: number;
}): () => void {
  const { queryClient, language, load = loadWords, gapMs = OTHER_LANGUAGE_GAP_MS } = o;
  const other: Language = language === 'ar' ? 'en' : 'ar';
  const cache = queryClient.getQueryCache();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  let stopListening = () => undefined as void;

  const settled = () => queryClient.isFetching() === 0 && cache.getAll().some((query) => query.state.dataUpdatedAt > 0 || query.state.errorUpdatedAt > 0);
  const check = () => {
    if (done || timer !== undefined || !settled()) return;
    timer = setTimeout(() => {
      done = true;
      stopListening();
      // A failed load leaves nothing, so the next language switch tries it again.
      load(other).catch(() => undefined);
    }, gapMs);
  };
  stopListening = cache.subscribe(check);
  check();
  return () => {
    done = true;
    stopListening();
    if (timer !== undefined) clearTimeout(timer);
  };
}
