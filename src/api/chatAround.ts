import { MESSAGE_PAGE_MAX, messagesOf } from './chatState';
import type { Message } from './contract/entities';
import type { State } from './store';

/** The live messages that the page of "around" holds before the message it opens at (chat design 2026-10-19, item 17). */
export const AROUND_BEFORE = 20;

/**
 * The page that holds one message. The newest page when the message is in it. Else the page starts AROUND_BEFORE live messages
 * before the message and runs to the newest message, at most MESSAGE_PAGE_MAX in all; "newer" is true when newer messages follow the
 * page. Null when the id is not a live message of this chat (a deleted message, a message of another chat, an unknown id): the call
 * then gives the newest page and no error, so the answer never tells that an id exists elsewhere.
 */
export function messagePageAround(state: State, conversationId: string, limit: number, aroundId: string): { page: Message[]; newer: boolean } | null {
  const live = messagesOf(state, conversationId);
  const index = live.findIndex((m) => m.id === aroundId);
  if (index < 0) return null;
  if (index >= live.length - limit) return { page: live.slice(Math.max(0, live.length - limit)), newer: false };
  const start = Math.max(0, index - AROUND_BEFORE);
  const end = Math.min(live.length, start + MESSAGE_PAGE_MAX);
  return { page: live.slice(start, end), newer: end < live.length };
}
