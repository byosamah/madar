import { chatReadKey } from '../../../src/api/store';
import type { Load } from './build';
import { newestMessages } from './steps';

type Input = Record<string, unknown>;

/**
 * chats.openDirect (chat design 2026-10-19, item 18): the direct chat that exists between the person and the person named, when
 * there is one. The handler writes a read mark for a chat with no live message, and none for a chat with messages or with a mark, so
 * the load holds the newest live message of the chat and the read mark of the person. A new chat has neither. The chat itself is an
 * office record, so the office lists hold it already.
 */
export async function chatsOpenDirect(L: Load, input: Input): Promise<void> {
  const me = L.authority?.id;
  const other = typeof input.userId === 'string' ? input.userId : '';
  if (!me || other === '') return;
  const existing = Object.values(L.office.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes(me) && c.memberIds.includes(other));
  if (!existing) return;
  await newestMessages(L, [existing.id]);
  await L.byKey('chatReads', [chatReadKey(existing.id, me)]);
}
