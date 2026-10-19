import { z } from 'zod';
import { isLiveMessage } from './chatNaming';
import { canSeeConversation } from './chatState';
import { Stamp, type Conversation, type Message, type User } from './contract/entities';
import { ProjectRef, UserCard } from './contract/views';
import { principalOf } from './permissions';
import type { State } from './store';
import { cardOf } from './views';
import { bodySearchText, hitLine, holdsWords, searchesMessages } from '../lib/searchMatch';
import { markOf } from '../lib/projectMark';
import { plainText } from '../lib/text';

/**
 * The Messages group of search.query (chat design 2026-10-19, item 16): the newest chat messages whose folded text holds every word of
 * the query. A person finds what the person may open today, and no more: the project chats the person may open, and the person's own
 * direct chats and groups. The tasks comments join in a later task of the track.
 */
export const MessageHit = z.object({
  /** The id of the message (msg_) or of the comment (cmt_). */
  id: z.string(),
  /** The id of the chat, or of the task for a comment. A hit opens `/inbox/<chatId>?at=<id>`. */
  chatId: z.string(),
  kind: z.enum(['project', 'direct', 'group', 'task']),
  /** The name of the chat: the project, the group, the other person, or the task. */
  title: z.string(),
  project: ProjectRef.nullable(),
  /** The other person of a direct chat. */
  person: UserCard.nullable(),
  author: UserCard,
  mine: z.boolean(),
  /** The line of the hit, in plain text (a mention reads "@Name"). */
  line: z.string().max(200),
  at: Stamp,
});
export type MessageHit = z.infer<typeof MessageHit>;

/** The most hits of the group. The loader reads the newest MESSAGE_HITS of each kind, so the cut of the handler gives the same rows. */
export const MESSAGE_HITS = 5;

/** Newest first by (stamp, id), in code point order, as the loaders read (collate "C"). */
export const byNewest = (a: { at: string; id: string }, b: { at: string; id: string }): number =>
  a.at === b.at ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.at < b.at ? 1 : -1;

function chatHit(state: State, viewer: User, conversation: Conversation, message: Message, words: readonly string[]): MessageHit {
  const project = conversation.projectId ? state.projects[conversation.projectId] : undefined;
  const otherId = conversation.kind === 'direct' ? conversation.memberIds.find((id) => id !== viewer.id) : undefined;
  const person = otherId ? cardOf(state, otherId) : null;
  return {
    id: message.id,
    chatId: conversation.id,
    kind: conversation.kind,
    title: conversation.kind === 'project' ? (project?.name ?? '') : conversation.kind === 'group' ? (conversation.name ?? '') : (person?.name ?? ''),
    project: conversation.kind === 'project' && project ? { id: project.id, code: project.code, name: project.name, mark: markOf(project) } : null,
    person,
    author: cardOf(state, message.authorId),
    // The rule of isMine in handlers/chats.ts. This module imports no handler.
    mine: message.actingForId === viewer.id || principalOf(state, message.authorId) === viewer.id,
    line: hitLine(plainText(message.body), words),
    at: message.createdAt,
  };
}

/**
 * The hits of the chat messages for one viewer: no hit unless one word has 3 letters or more; the live messages of the chats that
 * canSeeConversation allows, whose folded text holds every word; newest first; the first MESSAGE_HITS.
 */
export function messageHits(state: State, viewer: User, words: readonly string[]): MessageHit[] {
  if (!searchesMessages(words)) return [];
  const seen = new Map<string, Conversation>();
  for (const conversation of Object.values(state.conversations)) if (canSeeConversation(state, conversation, viewer)) seen.set(conversation.id, conversation);
  const found: { hit: MessageHit; at: string; id: string }[] = [];
  for (const message of Object.values(state.messages)) {
    const conversation = seen.get(message.conversationId);
    if (!conversation || !isLiveMessage(message) || !holdsWords(bodySearchText(message.body), words)) continue;
    found.push({ hit: chatHit(state, viewer, conversation, message, words), at: message.createdAt, id: message.id });
  }
  return found.sort(byNewest).slice(0, MESSAGE_HITS).map((row) => row.hit);
}
