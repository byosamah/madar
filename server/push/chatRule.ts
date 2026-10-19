import { levelFromRead } from '../../src/api/chatState';
import type { NotifyLevel } from '../../src/api/contract/entities';
import { chatReadKey } from '../../src/api/rowKeys';
import { mentionedUserIds } from '../../src/lib/text';

/**
 * The one rule of who gets the push of a chat message or a task comment (chat design items 19, 20, 21 and 23). It is a pure function
 * of plain facts, with no database and no State, so Postgres and SQLite feed it the same way (server/push/chatFacts.ts) and
 * test:lite and test:office keep the same rule. The push stays one fixed line with no data (2026-10-08).
 */

export type PushPerson = { id: string; kind: 'human' | 'agent'; active: boolean; admin: boolean; ownerId: string | null; device: boolean };
/**
 * A chat message of the save. "teamIds": the leader and the team of a project chat (empty for a direct chat and a group).
 * "memberIds": the people of a direct chat or a group. "mentions": the people the message names (an @mention, and the author of the
 * old message for a reply). "isNew": the save inserted the message; false for an edit.
 */
export type MessageFact = {
  kind: 'message'; id: string; chatId: string; chatKind: 'project' | 'direct' | 'group'; memberIds: string[]; teamIds: string[];
  authorId: string; actingForId: string; mentions: string[]; isNew: boolean;
};
/**
 * A task comment of the save. "chatId" of its push item is the task id. "makerId" is the raw createdBy of the task. "line": a quiet
 * reason line, which never pushes. "replyAuthorId": the author of the comment this one answers.
 */
export type CommentFact = {
  kind: 'comment'; id: string; taskId: string; office: boolean; leadId: string | null; makerId: string; helperIds: string[]; authorId: string;
  body: string; replyAuthorId: string | null; line: boolean; isNew: boolean;
};
export type PushNotice = { userId: string; targetType: string; targetId: string; messageId: string | null };
/** "levels" is keyed by chatReadKey(chatId, userId) and holds only stored levels. "notices": the new unread notices of reachable people. */
export type PushFacts = { people: PushPerson[]; items: Array<MessageFact | CommentFact>; levels: Readonly<Record<string, NotifyLevel>>; notices: PushNotice[]; undo: boolean };
export type ChatPushItem = { chatId: string; itemId: string };
/** "now": the people who get a push at once (a plain notice). "waited": the people who get one push after the wait, with its items. */
export type PushPlan = { now: string[]; waited: Array<{ userId: string; items: ChatPushItem[] }> };

/** True for a notice that points to a chat message or a task comment: its push joins the push of that item and waits. */
export function isChatItemNotice(n: { targetType: string; messageId?: string | null }): boolean {
  return typeof n.messageId === 'string' && n.messageId !== '' && (n.targetType === 'chat' || n.targetType === 'task');
}

const sorted = (ids: Iterable<string>): string[] => [...new Set(ids)].sort();

export function planPushes(facts: PushFacts): PushPlan {
  const people = new Map(facts.people.map((p) => [p.id, p]));
  const reach = (id: string): boolean => {
    const p = people.get(id);
    return p !== undefined && p.kind === 'human' && p.active && p.device;
  };
  /** The person behind an id: the owner of an agent, else the id itself. */
  const principal = (id: string | null): string | null => {
    if (id === null) return null;
    const p = people.get(id);
    return p?.kind === 'agent' && p.ownerId !== null ? p.ownerId : id;
  };
  const levelOf = (userId: string, chatId: string, chatKind: MessageFact['chatKind']): NotifyLevel => {
    const stored = facts.levels[chatReadKey(chatId, userId)];
    return levelFromRead(stored === undefined ? undefined : { notify: stored }, chatKind);
  };
  const admins = facts.people.filter((p) => p.admin).map((p) => p.id);

  // A plain notice (it points to no chat message and no task comment) gives its push at once.
  const now = sorted(facts.notices.filter((n) => !isChatItemNotice(n)).map((n) => n.userId));

  /** What each person gets: the items by itemId. */
  const wanted = new Map<string, Map<string, ChatPushItem>>();
  const add = (userId: string, item: ChatPushItem) => {
    const mine = wanted.get(userId) ?? new Map<string, ChatPushItem>();
    mine.set(item.itemId, item);
    wanted.set(userId, mine);
  };

  // A quiet line never pushes, and an Undo brings back an old item, so a new item of an Undo pushes nobody.
  const items = facts.items.filter((item) => !(item.kind === 'comment' && item.line) && !(item.isNew && facts.undo));
  const skipOf = (item: MessageFact | CommentFact): Set<string> => {
    const skip = new Set<string>();
    const author = principal(item.authorId);
    if (author !== null) skip.add(author);
    if (item.kind === 'message') skip.add(item.actingForId);
    return skip;
  };

  for (const item of items) {
    if (!item.isNew) continue;
    const skip = skipOf(item);
    if (item.kind === 'message') {
      const candidates = item.chatKind === 'project' ? [...item.teamIds, ...admins] : item.memberIds;
      for (const userId of candidates) {
        if (skip.has(userId)) continue;
        if (levelOf(userId, item.chatId, item.chatKind) === 'all' || item.mentions.includes(userId)) add(userId, { chatId: item.chatId, itemId: item.id });
      }
      continue;
    }
    const maker = principal(item.makerId);
    const plain = [item.leadId, ...(item.office ? [maker] : [])].filter((id): id is string => id !== null);
    const named = [...mentionedUserIds(item.body), ...[principal(item.replyAuthorId)].filter((id): id is string => id !== null)];
    // A project task: any person may read it. An office task: its maker, lead, helpers and the Admins.
    const mayRead = (userId: string): boolean => !item.office || userId === maker || userId === item.leadId || item.helperIds.includes(userId) || admins.includes(userId);
    for (const userId of new Set([...plain, ...named])) {
      if (skip.has(userId) || !mayRead(userId)) continue;
      add(userId, { chatId: item.taskId, itemId: item.id });
    }
  }

  // A mention or reply notice of an item joins the push of that item. A new item already pushed the people it names. The notice of an
  // edit pushes only a person whom the plain rule of the item does not push already.
  for (const notice of facts.notices) {
    if (!isChatItemNotice(notice)) continue;
    const item = items.find((candidate) => candidate.id === notice.messageId);
    if (item === undefined || skipOf(item).has(notice.userId)) continue;
    const chatId = item.kind === 'message' ? item.chatId : item.taskId;
    if (item.isNew) {
      add(notice.userId, { chatId, itemId: item.id });
      continue;
    }
    const plainPush = item.kind === 'message'
      ? levelOf(notice.userId, item.chatId, item.chatKind) === 'all'
      : notice.userId === item.leadId || (item.office && notice.userId === principal(item.makerId));
    if (!plainPush) add(notice.userId, { chatId, itemId: item.id });
  }

  const waited = sorted(wanted.keys())
    .filter((userId) => reach(userId) && !now.includes(userId))
    .map((userId) => ({ userId, items: [...wanted.get(userId)!.values()].sort((a, b) => a.itemId.localeCompare(b.itemId)) }));
  return { now, waited };
}
