import { useState } from 'react';
import type { Bubble } from './MessageBubble';

/**
 * What the pane knows at the open (chat design 2026-10-19, item 3): how many messages were unread, and the read time of the reader
 * from before the open. A chat has both. A task thread has only the count (`comments.list` gives no read time), so it leaves
 * `readUpTo` out.
 */
export type NewMark = { unread: number; readUpTo?: string | null };

/**
 * The id of the message that the New line goes above, or null for no line. A counted message is the message of another person: no
 * quiet line, no reason line, and not yours.
 * - With a read time (a chat): the first counted message that is later than the read time. A chat never read (null) starts at the
 *   first counted message of the list.
 * - With no read time (a task thread): walk back from the newest message over the counted ones, stop at a message of yours, and
 *   return the message where the count reaches `unread` (or the oldest one met).
 */
export function firstUnreadId(bubbles: readonly Bubble[], mark: NewMark): string | null {
  if (mark.unread <= 0) return null;
  const counted = (bubble: Bubble) => !bubble.line && !bubble.reason && !bubble.mine;
  if (mark.readUpTo !== undefined) {
    const since = mark.readUpTo === null ? Number.NEGATIVE_INFINITY : Date.parse(mark.readUpTo);
    return bubbles.find((bubble) => counted(bubble) && Date.parse(bubble.createdAt) > since)?.id ?? null;
  }
  let found: string | null = null;
  let left = mark.unread;
  for (let i = bubbles.length - 1; i >= 0 && left > 0; i -= 1) {
    const bubble = bubbles[i];
    if (bubble.line || bubble.reason) continue;
    if (bubble.mine) break;
    found = bubble.id;
    left -= 1;
  }
  return found;
}

/**
 * The read state at the open. The open marks the chat read, so the state from before it must be kept: this keeps the first `pick(data)`
 * of an answer that is fresh, and never changes it after that. An answer is fresh when it came after the screen mounted, or when it
 * came from the cache and no change made it old. Before that the hook gives null and the pane shows no log. It reads during render,
 * so the mark exists before the effect that marks the chat read. The pane is keyed by the chat id, so a new chat starts again.
 */
export function useOpenMark<T>(answer: { data: T | undefined; isStale: boolean; isFetchedAfterMount: boolean }, pick: (data: T) => NewMark): NewMark | null {
  const [mark, setMark] = useState<NewMark | null>(null);
  if (mark === null && answer.data !== undefined && (answer.isFetchedAfterMount || !answer.isStale)) setMark(pick(answer.data));
  return mark;
}
