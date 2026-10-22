/**
 * The one rule of who a chat message or a task comment names, the "Notify me" level of a person and the link of a reply (chat design
 * 2026-10-19, items 4, 10 and 21). The views, the notices, the push and the "waits" rule all read these functions, so no screen and
 * no handler keeps a rule of its own. They hold plain functions only: nothing runs at load, so the cycle with views.ts is safe.
 */
import type { Comment, Conversation, Message, NotifyLevel } from './contract/entities';
import type { ReplyRef } from './contract/views';
import { principalOf } from './permissions';
import { chatReadKey } from './rowKeys';
import type { State } from './store';
import { cardOf } from './views';
import { mentionedUserIds, firstLineOf } from '../lib/text';

/** True when the message is not deleted. A message with "deletedAt" set is gone from every read path until an Undo. */
export function isLiveMessage(m: Message): boolean {
  return m.deletedAt === undefined;
}

/** A message is told from a comment by "conversationId": only a message has it. */
function isMessage(item: Message | Comment): item is Message {
  return 'conversationId' in item;
}

/** The person behind an item: the person an agent acted for on a message, the owner of an agent on a comment. */
function principalOfItem(state: State, item: Message | Comment): string {
  return isMessage(item) ? item.actingForId : principalOf(state, item.authorId);
}

/**
 * True when the item names the person (design item 4): an @mention of the person in the text, or a reply to a message of the person.
 * A reply on a message already joined "mentions" on the server (a reply names the author of the old message), so a message reads
 * "mentions" only. A comment keeps a list only for @everyone (the people that the words named): it reads that list, the mentions of its text and
 * the author of the comment it answers. Never true
 * for the person's own item.
 */
export function namesPerson(state: State, item: Message | Comment, personId: string): boolean {
  if (principalOfItem(state, item) === personId) return false;
  if (isMessage(item)) return item.mentions.includes(personId);
  if (mentionedUserIds(item.body).includes(personId) || (item.mentions ?? []).includes(personId)) return true;
  const old = item.replyToId === undefined ? undefined : state.comments[item.replyToId];
  return old !== undefined && principalOf(state, old.authorId) === personId;
}

/**
 * The "Notify me" level of a person for a chat (item 21): the stored choice, else "named" for a project chat and "all" for a direct
 * chat or a group.
 */
export function notifyLevelOf(state: State, conversation: Conversation, userId: string): NotifyLevel {
  return state.chatReads[chatReadKey(conversation.id, userId)]?.notify ?? (conversation.kind === 'project' ? 'named' : 'all');
}

/** The old item that a reply answers, only when it may be shown: a live message of the same chat, or a comment of the same task. */
function oldItemOf(state: State, item: Message | Comment): Message | Comment | undefined {
  if (item.replyToId === undefined) return undefined;
  if (isMessage(item)) {
    const old = state.messages[item.replyToId];
    return old !== undefined && isLiveMessage(old) && old.conversationId === item.conversationId ? old : undefined;
  }
  const old = state.comments[item.replyToId];
  return old !== undefined && old.targetType === item.targetType && old.targetId === item.targetId ? old : undefined;
}

/**
 * The link of a reply (item 10), or null when the item answers nothing. A live old item of the same chat (a message) or of the same
 * task (a comment) gives its author and its first line. A deleted, missing or unreadable old item (another chat, another task) gives
 * "deleted: true", an empty first line and the author of the reply itself: no text and no name of the other place leaves. The two
 * cases look the same on purpose, so an answer never tells that an id exists elsewhere. The rule is the same for every reader, so
 * "viewerId" is not read today. It keeps the place for a reader rule.
 */
export function replyRefOf(state: State, item: Message | Comment, viewerId: string): ReplyRef | null {
  if (item.replyToId === undefined) return null;
  const old = oldItemOf(state, item);
  if (old === undefined) return { id: item.replyToId, author: cardOf(state, item.authorId), firstLine: '', deleted: true };
  return { id: item.replyToId, author: cardOf(state, principalOfItem(state, old)), firstLine: firstLineOf(old.body), deleted: false };
}
