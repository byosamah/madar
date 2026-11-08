/**
 * How far a swipe goes before an Inbox row archives (owner, 2026-11-08: "Longer swipe, keep the unread mark"). It was 80 px, which a
 * finger reaches while it scrolls or holds the phone, so chats went to the archive by accident. It is now about twice that, and still less
 * than half of a 390 px phone. A drag of exactly this length does not archive.
 */
export const SWIPE_PX = 160;

/** True when a drag of "dx" pixels (to either side) is long enough to archive the row. */
export function swipeArchives(dx: number): boolean {
  return Math.abs(dx) > SWIPE_PX;
}
