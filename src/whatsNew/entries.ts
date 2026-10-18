/**
 * The What's new entries, newest first (fbk_018). Each id has its title and its body in the word files
 * (`whatsNew.items.<id>.title` and `whatsNew.items.<id>.body`, src/i18n/real/whatsnew.<lang>.json).
 * Add a new entry at the top. The id is the release day and the number of the entry on that day.
 */
export type WhatsNewEntry = { id: string; day: string };

export const WHATS_NEW: readonly WhatsNewEntry[] = [
  { id: '2026-10-23-1', day: '2026-10-23' },
  { id: '2026-10-23-2', day: '2026-10-23' },
  { id: '2026-10-23-3', day: '2026-10-23' },
  { id: '2026-10-23-4', day: '2026-10-23' },
];
