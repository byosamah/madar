import { WHATS_NEW, type WhatsNewEntry } from './entries';

/** The browser key of the seen mark of one person. */
const keyOf = (userId: string): string => `madar.whatsNewSeen.${userId}`;

/** True when the newest entry is not the entry that the person has seen. */
export function hasNew(entries: readonly WhatsNewEntry[], seenId: string | null): boolean {
  return entries.length > 0 && entries[0].id !== seenId;
}

/**
 * The entry that the person has seen last, or null when none is stored. A blocked storage gives the newest entry, so the
 * bold item never shows on a device that keeps no mark.
 */
export function readSeen(userId: string): string | null {
  try {
    return window.localStorage.getItem(keyOf(userId));
  } catch {
    return WHATS_NEW[0]?.id ?? null;
  }
}

/** Keeps the newest entry as seen for the person. A blocked storage keeps no mark. */
export function markSeen(userId: string, newestId: string): void {
  try {
    window.localStorage.setItem(keyOf(userId), newestId);
  } catch {
    // Blocked storage keeps no mark.
  }
}
