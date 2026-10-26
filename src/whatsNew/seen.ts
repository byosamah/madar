import { WHATS_NEW, type WhatsNewEntry } from './entries';

/** The browser key of the seen mark of one person. */
const keyOf = (userId: string): string => `madar.whatsNewSeen.${userId}`;

/**
 * The entries from the newest day to the oldest. The usage data entry stays first in the list whatever its day (insight design, section 8),
 * so the first entry is not always the newest one (2026-10-26). The sort keeps the list order inside one day.
 */
function byAge(entries: readonly WhatsNewEntry[]): readonly WhatsNewEntry[] {
  return [...entries].sort((one, other) => (one.day === other.day ? 0 : one.day > other.day ? -1 : 1));
}

/** The newest entry: the first entry of the newest day. */
export function newestId(entries: readonly WhatsNewEntry[]): string | null {
  return byAge(entries)[0]?.id ?? null;
}

/** True when the entry came after the entry that the person saw. With no seen entry, or one the list does not hold, nothing counts as newer. */
export function isNewer(entries: readonly WhatsNewEntry[], entryId: string, seenId: string | null): boolean {
  const order = byAge(entries).map((entry) => entry.id);
  const seenAt = seenId === null ? -1 : order.indexOf(seenId);
  return seenAt > 0 && order.indexOf(entryId) < seenAt && order.includes(entryId);
}

/** True when the newest entry is not the entry that the person has seen. */
export function hasNew(entries: readonly WhatsNewEntry[], seenId: string | null): boolean {
  const newest = newestId(entries);
  return newest !== null && newest !== seenId;
}

/**
 * The entry that the person has seen last, or null when the browser stores none. A blocked storage gives the newest entry, so the
 * bold item never shows on a device that keeps no mark.
 */
export function readSeen(userId: string): string | null {
  try {
    return window.localStorage.getItem(keyOf(userId));
  } catch {
    return newestId(WHATS_NEW);
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
