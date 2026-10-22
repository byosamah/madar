/** The bubbles that a log mounts before its first paint. A longer log mounts the others at an idle moment (performance audit 2026-10-21, RN-1). */
export const FIRST_BUBBLES = 60;

/**
 * The id of the first bubble that a log mounts at once, or null when the log mounts all (60 bubbles or fewer, or every bubble is needed).
 * The newest 60 are the first mount. A bubble in `keep` (the focus message, the message after the New line) is always in it, so the log can
 * place itself there at the open: the first mount then reaches back to the oldest of them.
 */
export function stageStartId(bubbles: readonly { id: string }[], keep: readonly (string | null | undefined)[]): string | null {
  if (bubbles.length <= FIRST_BUBBLES) return null;
  let from = bubbles.length - FIRST_BUBBLES;
  for (const id of keep) {
    if (id == null) continue;
    const at = bubbles.findIndex((bubble) => bubble.id === id);
    if (at >= 0 && at < from) from = at;
  }
  return from > 0 ? bubbles[from]!.id : null;
}
