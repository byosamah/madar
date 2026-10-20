import { stampDay } from '../../lib/dates';

/** Two messages of one person join into a run when the second comes within 5 minutes of the first (chat design 2026-10-19, item 2). */
export const RUN_GAP_MS = 300_000;

/** What the rule reads from a bubble. A Bubble fits it. */
export type RunItem = { id: string; author: { id: string; kind: 'human' | 'agent' }; createdAt: string; line?: unknown; reason?: unknown };

/**
 * The ids of the items that start a run, in the list order. An item starts a run when it is the first, when it or the item before it
 * is a quiet line or a reason line, when the author differs, when it or the item before it is an agent message, when the office day
 * differs, when the gap from the item before is over 5 minutes (counted from the item before, not from the start of the run), or when
 * it is the item under the New line (`breakBefore`).
 */
export function runStarts(items: readonly RunItem[], breakBefore?: string | null): Set<string> {
  const starts = new Set<string>();
  items.forEach((item, index) => {
    const before = items[index - 1];
    const starting =
      !before
      || item.line !== undefined || item.reason !== undefined || before.line !== undefined || before.reason !== undefined
      || item.author.id !== before.author.id
      || item.author.kind === 'agent' || before.author.kind === 'agent'
      || stampDay(item.createdAt) !== stampDay(before.createdAt)
      || Date.parse(item.createdAt) - Date.parse(before.createdAt) > RUN_GAP_MS
      || item.id === breakBefore;
    if (starting) starts.add(item.id);
  });
  return starts;
}
