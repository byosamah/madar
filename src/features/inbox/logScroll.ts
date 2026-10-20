/** The last 80 px of the log count as its bottom: a reader there follows the newest message (chat design 2026-10-19, item 1). */
export const BOTTOM_ZONE = 80;

/** An item that the log puts near its top sits this far under the edge (the New line, item 3). */
export const START_GAP = 16;

/** True when the log shows its bottom, within the bottom zone. The rule of the log before this design stays. */
export function isNearBottom(log: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return log.scrollHeight - log.scrollTop - log.clientHeight < BOTTOM_ZONE;
}

/**
 * The scroll position that puts an item 16 px under the top of the log, or in the middle of it. `view` and `item` are the
 * `getBoundingClientRect` top and height of the log and of the item, read at the same moment. The result is never below 0.
 */
export function scrollTopFor(
  scrollTop: number,
  view: { top: number; height: number },
  item: { top: number; height: number },
  where: 'start' | 'center',
): number {
  const offset = item.top - view.top;
  const next = where === 'start' ? scrollTop + offset - START_GAP : scrollTop + offset - (view.height - item.height) / 2;
  return Math.max(0, next);
}
