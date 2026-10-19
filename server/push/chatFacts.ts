import type { Comment, Message, Notification, NotifyLevel, Task, User } from '../../src/api/contract/entities';
import { chatReadKey } from '../../src/api/rowKeys';
import { isLine } from '../../src/lib/commentLine';
import type { Query } from '../core/ports';
import { isLite } from '../data/dialect';
import { liteDbOf } from '../data/lite/db';
import { readLiteOffice } from '../data/lite/office';
import type { SaveResult } from '../data/save';
import { isChatItemNotice, type CommentFact, type MessageFact, type PushFacts, type PushNotice, type PushPerson } from './chatRule';

/**
 * The fact readers of the push producer (chat design items 19 to 21). They read what planPushes (chatRule.ts) needs, in the
 * transaction of the call: on Postgres four statements at most, on SQLite the office lists in memory plus reads by key. The rule
 * itself holds no SQL, so both databases keep one rule.
 */

/** The part of a SaveResult that the readers use. */
export type PushSaved = Pick<SaveResult, 'kinds' | 'people' | 'messageIds' | 'commentIds' | 'noticeIds'>;

/**
 * $1 the people whose notices the save changed. The unread notices that the open transaction inserted, for an active human with at
 * least one device, with the message or comment that each one points to.
 */
export const PUSH_NEW_NOTICES_SQL = `select n.user_id, n.target_type, n.target_id, n.doc->>'messageId' as message_id
from notifications n join users u on u.id = n.user_id
where n.user_id = any($1::text[]) and not n.read
  and n.xmin::text::bigint = (pg_current_xact_id_if_assigned()::text::bigint % 4294967296)
  and u.kind = 'human' and u.active
  and exists (select 1 from push_devices d where d.user_id = n.user_id)
order by n.user_id, n.ord`;

/**
 * $1 the message ids, $2 the comment ids. A message comes with its chat kind, the people of its chat (a direct chat or a group:
 * memberIds; a project chat: the leader and the team). A comment of a task comes with its task and the author of the comment it
 * replies to.
 */
export const PUSH_ITEMS_SQL = `select 'message' as kind, m.id, m.conversation_id as chat_id, c.kind as chat_kind, c.project_id, m.doc, c.doc->'memberIds' as member_ids,
  (select coalesce(jsonb_agg(t.user_id order by t.user_id), '[]'::jsonb) from (select p.leader_id as user_id from projects p where p.id = c.project_id and p.leader_id is not null union select mb.user_id from members mb where mb.project_id = c.project_id) t) as team_ids,
  null::jsonb as task, null::text as reply_author_id
from messages m join conversations c on c.id = m.conversation_id where m.id = any($1::text[])
union all
select 'comment', k.id, k.target_id, 'task', t.project_id, k.doc, null::jsonb, null::jsonb, t.doc, r.doc->>'authorId'
from comments k join tasks t on t.id = k.target_id left join comments r on r.id = k.doc->>'replyToId'
where k.id = any($2::text[]) and k.target_type = 'task'`;

/** Every person, with the system role, the owner of an agent and the flag of a push device. */
export const PUSH_PEOPLE_SQL = `select u.id, u.kind, u.active, u.doc->>'systemRole' as system_role, u.doc->>'ownerId' as owner_id,
  exists (select 1 from push_devices d where d.user_id = u.id) as device
from users u order by u.id`;

/** $1 the chat ids of the message items. The stored "Notify me" choices of those chats. A missing choice means the default of the chat kind. */
export const PUSH_LEVELS_SQL = "select r.conversation_id, r.user_id, r.doc->>'notify' as notify from chat_reads r where r.conversation_id = any($1::text[]) and r.doc ? 'notify'";

// SQLite forms (exit wave 3 and chat design items 19 to 21): the tables hold id and doc, so the fields come from doc, and the people
// of a chat come from the office lists in memory.
export const PUSH_NEW_NOTICES_LITE = 'select user_id, doc from notifications where id in (select value from json_each(?1)) and read = 0';
export const PUSH_DEVICE_PEOPLE_LITE = 'select distinct user_id from push_devices where user_id in (select value from json_each(?1))';
export const MESSAGE_LITE = 'select conversation_id, doc from messages where id = ?1';
export const PUSH_COMMENT_LITE = 'select target_type, target_id, created_at, doc from comments where id = ?1';
export const PUSH_TASK_LITE = 'select doc from tasks where id = ?1';
export const PUSH_LEVELS_LITE = "select user_id, json_extract(doc, '$.notify') as notify from chat_reads where conversation_id = ?1 and json_extract(doc, '$.notify') is not null";

type NoticeRow = { user_id: string; target_type: string; target_id: string; message_id: string | null };
type ItemRow = {
  kind: 'message' | 'comment'; id: string; chat_id: string; chat_kind: string; project_id: string | null; doc: Message | Comment;
  member_ids: string[] | null; team_ids: string[] | null; task: Task | null; reply_author_id: string | null;
};
type PersonRow = { id: string; kind: 'human' | 'agent'; active: boolean; system_role: string | null; owner_id: string | null; device: boolean };
type LevelRow = { conversation_id: string; user_id: string; notify: NotifyLevel };

const unique = (ids: Iterable<string>): string[] => [...new Set(ids)];

/** The facts of a message row, or null for a deleted message (it pushes nobody). isNew: the save inserted the message. */
function messageFact(row: ItemRow, isNew: boolean): MessageFact | null {
  const doc = row.doc as Message;
  if (doc.deletedAt !== undefined) return null;
  return {
    kind: 'message', id: row.id, chatId: row.chat_id, chatKind: row.chat_kind as MessageFact['chatKind'], memberIds: row.chat_kind === 'project' ? [] : row.member_ids ?? [],
    teamIds: row.chat_kind === 'project' ? row.team_ids ?? [] : [], authorId: doc.authorId, actingForId: doc.actingForId, mentions: doc.mentions ?? [], isNew,
  };
}

/** The facts of a comment row of a task. An office task has no project. */
function commentFact(row: ItemRow, isNew: boolean): CommentFact | null {
  const doc = row.doc as Comment;
  const task = row.task;
  if (!task) return null;
  return {
    kind: 'comment', id: row.id, taskId: row.chat_id, office: task.projectId == null, leadId: task.ownerId ?? null, makerId: task.createdBy,
    helperIds: task.helperIds ?? [], authorId: doc.authorId, body: doc.body, replyAuthorId: row.reply_author_id, line: isLine(doc), isNew,
  };
}

/** The ids to read: the messages and comments the save inserted, and the ones that a new notice points to (an edit names an old one). */
function itemIdsOf(saved: PushSaved, notices: PushNotice[], undo: boolean): { messages: string[]; comments: string[] } {
  const pointed = notices.filter((n) => isChatItemNotice(n)).map((n) => n.messageId!);
  return {
    messages: unique([...(saved.messageIds ?? []), ...pointed.filter((id) => id.startsWith('msg_'))]),
    // An Undo brings old comments back: they are no new comment, so they push nobody (planPushes leaves a new item of an Undo out).
    comments: unique([...(undo ? [] : saved.commentIds ?? []), ...pointed.filter((id) => id.startsWith('cmt_'))]),
  };
}

async function postgresFacts(q: Query, saved: PushSaved, wroteNotices: boolean, undo: boolean): Promise<PushFacts> {
  const rows = wroteNotices ? await q<NoticeRow>(PUSH_NEW_NOTICES_SQL, [[...saved.people].sort()]) : [];
  const notices: PushNotice[] = rows.map((n) => ({ userId: n.user_id, targetType: n.target_type, targetId: n.target_id, messageId: n.message_id }));
  const ids = itemIdsOf(saved, notices, undo);
  if (ids.messages.length === 0 && ids.comments.length === 0) return { people: [], items: [], levels: {}, notices, undo };
  const itemRows = await q<ItemRow>(PUSH_ITEMS_SQL, [ids.messages, ids.comments]);
  const newMessages = new Set(saved.messageIds ?? []);
  const newComments = new Set(saved.commentIds ?? []);
  const items: PushFacts['items'] = [];
  for (const row of itemRows) {
    const fact = row.kind === 'message' ? messageFact(row, newMessages.has(row.id)) : commentFact(row, newComments.has(row.id));
    if (fact) items.push(fact);
  }
  const people = (await q<PersonRow>(PUSH_PEOPLE_SQL)).map(personOf);
  const chatIds = unique(items.filter((i): i is MessageFact => i.kind === 'message').map((i) => i.chatId));
  const levels: Record<string, NotifyLevel> = {};
  if (chatIds.length > 0) for (const r of await q<LevelRow>(PUSH_LEVELS_SQL, [chatIds])) levels[chatReadKey(r.conversation_id, r.user_id)] = r.notify;
  return { people, items, levels, notices, undo };
}

const personOf = (row: PersonRow): PushPerson => ({
  id: row.id, kind: row.kind, active: row.active, admin: row.system_role === 'admin', ownerId: row.owner_id, device: row.device,
});

async function liteFacts(q: Query, saved: PushSaved, wroteNotices: boolean, undo: boolean): Promise<PushFacts> {
  const { lists } = await readLiteOffice(liteDbOf(q), q);
  const users = lists.users as Record<string, User>;
  const allIds = Object.keys(users).sort();
  const withDevice = new Set<string>();
  const devicesOf = async (ids: string[]) => {
    if (ids.length > 0) for (const row of await q<{ user_id: string }>(PUSH_DEVICE_PEOPLE_LITE, [ids])) withDevice.add(row.user_id);
  };
  const notices: PushNotice[] = [];
  const noticeIds = wroteNotices ? saved.noticeIds ?? [] : [];
  if (noticeIds.length > 0) {
    await devicesOf(allIds);
    for (const row of await q<{ user_id: string; doc: Notification }>(PUSH_NEW_NOTICES_LITE, [noticeIds])) {
      const person = users[row.user_id];
      if (person?.kind !== 'human' || person.active !== true || !withDevice.has(row.user_id)) continue;
      notices.push({ userId: row.user_id, targetType: row.doc.targetType, targetId: row.doc.targetId, messageId: row.doc.messageId ?? null });
    }
  }
  const ids = itemIdsOf(saved, notices, undo);
  if (ids.messages.length === 0 && ids.comments.length === 0) return { people: [], items: [], levels: {}, notices, undo };
  const newMessages = new Set(saved.messageIds ?? []);
  const newComments = new Set(saved.commentIds ?? []);
  const items: PushFacts['items'] = [];
  for (const id of ids.messages) {
    const [message] = await q<{ conversation_id: string; doc: Message }>(MESSAGE_LITE, [id]);
    const chat = message ? lists.conversations[message.conversation_id] : undefined;
    if (!message || !chat) continue;
    const team: string[] = [];
    if (chat.kind === 'project' && chat.projectId !== null) {
      const leaderId = lists.projects[chat.projectId]?.leaderId;
      if (leaderId) team.push(leaderId);
      for (const m of Object.values(lists.members)) if (m.projectId === chat.projectId) team.push(m.userId);
    }
    const fact = messageFact({ kind: 'message', id, chat_id: chat.id, chat_kind: chat.kind, project_id: chat.projectId, doc: message.doc, member_ids: [...chat.memberIds], team_ids: unique(team).sort(), task: null, reply_author_id: null }, newMessages.has(id));
    if (fact) items.push(fact);
  }
  for (const id of ids.comments) {
    const [comment] = await q<{ target_type: string; target_id: string; doc: Comment }>(PUSH_COMMENT_LITE, [id]);
    if (!comment || comment.target_type !== 'task') continue;
    const [task] = await q<{ doc: Task }>(PUSH_TASK_LITE, [comment.target_id]);
    if (!task) continue;
    const old = comment.doc.replyToId === undefined ? undefined : (await q<{ doc: Comment }>(PUSH_COMMENT_LITE, [comment.doc.replyToId]))[0];
    const fact = commentFact({ kind: 'comment', id, chat_id: comment.target_id, chat_kind: 'task', project_id: task.doc.projectId ?? null, doc: comment.doc, member_ids: null, team_ids: null, task: task.doc, reply_author_id: old?.doc.authorId ?? null }, newComments.has(id));
    if (fact) items.push(fact);
  }
  await devicesOf(allIds);
  const people: PushPerson[] = allIds.map((id) => ({
    id, kind: users[id].kind, active: users[id].active === true, admin: users[id].systemRole === 'admin', ownerId: users[id].ownerId ?? null, device: withDevice.has(id),
  }));
  const levels: Record<string, NotifyLevel> = {};
  for (const chatId of unique(items.filter((i): i is MessageFact => i.kind === 'message').map((i) => i.chatId))) {
    for (const r of await q<{ user_id: string; notify: NotifyLevel }>(PUSH_LEVELS_LITE, [chatId])) levels[chatReadKey(chatId, r.user_id)] = r.notify;
  }
  return { people, items, levels, notices, undo };
}

/**
 * The facts of one save for planPushes, or null when the save wrote no notice, no message and no new comment (no statement runs).
 * "undo": the call is an Undo, which brings old comments back and pushes nobody for them.
 */
export async function readPushFacts(q: Query, saved: PushSaved, o: { undo: boolean }): Promise<PushFacts | null> {
  const wroteNotices = saved.kinds.has('notifications') && saved.people.size > 0;
  const wroteMessages = (saved.messageIds?.length ?? 0) > 0;
  const wroteComments = !o.undo && (saved.commentIds?.length ?? 0) > 0;
  if (!wroteNotices && !wroteMessages && !wroteComments) return null;
  return isLite(q) ? liteFacts(q, saved, wroteNotices, o.undo) : postgresFacts(q, saved, wroteNotices, o.undo);
}
