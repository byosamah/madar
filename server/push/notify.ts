import { nowStamp } from '../../src/lib/dates';
import { isLite } from '../data/dialect';
import type { OutboxRow } from '../core/effects';
import type { Deps, Query } from '../core/ports';
import { MESSAGE_LITE, PUSH_COMMENT_LITE, readPushFacts, type PushSaved } from './chatFacts';
import { planPushes, type ChatPushItem } from './chatRule';
import { sendPush, PushSendError } from './send';
import { PushConfigError } from './vapid';

/**
 * Browser push for every new notice and every new chat message (owner, 2026-10-08), with the chat rules of 2026-10-19.
 *
 * - The producer: after the save of a write call, pushRows() reads the facts of the save (chatFacts.ts), asks planPushes (chatRule.ts)
 *   who gets a push, and writes ONE outbox row for each person. A plain notice gives a push.notify row, which runs at once. A chat
 *   message, a task comment, and a mention or reply notice of one give a push.chat row, which waits 10 seconds (WAITED_KINDS) and
 *   checks again. A person gets a row only as an active human with at least one device. The rows commit with the call, so a rollback
 *   sends nothing. The 15-minute job calls pushRows() after its own save, where it calls noticeRows().
 *   A new notice is a row whose xmin is the id of the open transaction (the same rule as NEW_NOTICES_SQL in server/mail/notices.ts).
 *   A new message or comment is one of the ids that the save step names (SaveResult.messageIds, SaveResult.commentIds).
 * - The effects: sendPushNotify() reads the devices of the person again after the commit, and posts an empty push to each one
 *   (send.ts). sendChatPush() first asks which items the person has not read on any device and which are not deleted. The browser
 *   shows one fixed line (public/sw.js). The push carries no client data and no person.
 * - A device that the push service calls gone (404, 410) is removed. A device that took the push gets lastPushAt. A 429, a 5xx or
 *   a network error throws after the other devices were handled, so the outbox tries the row again. A retry posts to every device
 *   of the person again; the tag of the notification (madar-new) makes the browser show one line only.
 * - This is the one effect that writes a State table outside runCall. It touches push_devices only: private rows with no event,
 *   no chg, no signal. Every other write of a record goes through runCall.
 */

export const PUSH_EFFECT = 'push.notify';
/** The push of a chat message or a task comment: it waits 10 seconds after the answer and checks again (chat design item 20). */
export const PUSH_CHAT_EFFECT = 'push.chat';

export {
  MESSAGE_LITE, PUSH_COMMENT_LITE, PUSH_DEVICE_PEOPLE_LITE, PUSH_ITEMS_SQL, PUSH_LEVELS_LITE, PUSH_LEVELS_SQL, PUSH_NEW_NOTICES_LITE, PUSH_NEW_NOTICES_SQL, PUSH_PEOPLE_SQL, PUSH_TASK_LITE,
} from './chatFacts';

/**
 * $1 the person, $2 the items as JSON text ([{ chatId, itemId }]). The items of a waited push that are still new for the person: the
 * message or the comment exists, a message is not deleted, and the person has no read mark of that chat or task thread that is newer.
 * The stamps compare as text with collate "C", as the unread count does (server/data/loaders/sqlSource.ts, BOUND_TERMS). It runs on
 * the primary, as devicesOf does, because the read or the delete may have committed a moment ago.
 */
export const PUSH_STILL_NEW_SQL = `select i."itemId" as item_id
from jsonb_to_recordset($2::jsonb) as i("chatId" text, "itemId" text)
left join messages m on m.id = i."itemId"
left join comments k on k.id = i."itemId"
left join chat_reads r on r.conversation_id = i."chatId" and r.user_id = $1
where coalesce(m.created_at, k.created_at) is not null
  and (m.id is null or m.doc->>'deletedAt' is null)
  and (r.conversation_id is null or coalesce(m.created_at, k.created_at) collate "C" > (r.doc->>'lastReadAt') collate "C")
order by 1`;

// The SQLite forms of PUSH_STILL_NEW_SQL: one message or comment and one read mark at a time, then the same test in JavaScript.
export const CHAT_READ_LITE = 'select doc from chat_reads where conversation_id = ?1 and user_id = ?2';

/** $1 the person. The push addresses of an active human, oldest device first. */
export const PUSH_DEVICES_SQL = `select d.endpoint
from push_devices d join users u on u.id = d.user_id
where d.user_id = $1 and u.kind = 'human' and u.active
order by d.ord`;

/** $1 the endpoints that took the push, $2 the stamp. */
export const PUSH_SENT_SQL = "update push_devices set doc = jsonb_set(doc, '{lastPushAt}', to_jsonb($2::text)) where endpoint = any($1::text[])";

/** $1 the endpoints that the push service calls gone. */
export const PUSH_GONE_SQL = 'delete from push_devices where endpoint = any($1::text[])';

// SQLite forms (exit wave 3). The person of a device is read from the users doc; a list of endpoints goes one statement each.
export const PUSH_DEVICES_LITE = 'select d.rowid as ord, d.endpoint as endpoint, u.doc as doc from push_devices d join users u on u.id = d.user_id where d.user_id = ?1';
export const PUSH_SENT_LITE = "update push_devices set doc = json_set(doc, '$.lastPushAt', ?2) where endpoint = ?1";
export const PUSH_GONE_LITE = 'delete from push_devices where endpoint = ?1';

/** The push addresses of an active human, oldest device first, on both databases. */
async function devicesOf(deps: Deps, userId: string): Promise<{ endpoint: string }[]> {
  if (!isLite(deps.db)) return deps.db.statement<{ endpoint: string }>('write', PUSH_DEVICES_SQL, [userId]);
  const rows = await deps.db.statement<{ ord: number; endpoint: string; doc: { kind?: string; active?: boolean } }>('read', PUSH_DEVICES_LITE, [userId]);
  return rows.filter((row) => row.doc.kind === 'human' && row.doc.active === true).sort((a, b) => a.ord - b.ord).map((row) => ({ endpoint: row.endpoint }));
}

/**
 * The outbox rows of one save (chat design items 19 to 21). Run inside the call's transaction, after the save. planPushes decides:
 * a push.notify row at once for a plain notice, and a push.chat row for a chat message or a task comment, which waits 10 seconds
 * (WAITED_KINDS). One row for each person for each save. "undo": the call brings old records back, so it pushes nothing for them.
 */
export async function pushRows(q: Query, saved: PushSaved, o: { undo?: boolean } = {}): Promise<OutboxRow[]> {
  const facts = await readPushFacts(q, saved, { undo: o.undo === true });
  if (facts === null) return [];
  const plan = planPushes(facts);
  return [
    ...plan.now.map((userId) => ({ kind: PUSH_EFFECT, payload: { userId } })),
    ...plan.waited.map(({ userId, items }) => ({ kind: PUSH_CHAT_EFFECT, payload: { userId, items } })),
  ];
}

/** The items of a waited push that are still new for the person (PUSH_STILL_NEW_SQL), on both databases. */
async function stillNewItems(deps: Deps, userId: string, items: ChatPushItem[]): Promise<string[]> {
  if (!isLite(deps.db)) {
    const rows = await deps.db.statement<{ item_id: string }>('write', PUSH_STILL_NEW_SQL, [userId, JSON.stringify(items)]);
    return rows.map((row) => row.item_id);
  }
  const fresh: string[] = [];
  for (const { chatId, itemId } of items) {
    let createdAt: string | undefined;
    if (itemId.startsWith('msg_')) {
      const [message] = await deps.db.statement<{ doc: { createdAt?: string; deletedAt?: string } }>('write', MESSAGE_LITE, [itemId]);
      if (message && message.doc.deletedAt === undefined) createdAt = message.doc.createdAt;
    } else {
      const [comment] = await deps.db.statement<{ created_at: string }>('write', PUSH_COMMENT_LITE, [itemId]);
      createdAt = comment?.created_at;
    }
    if (createdAt === undefined) continue;
    const [read] = await deps.db.statement<{ doc: { lastReadAt?: string } }>('write', CHAT_READ_LITE, [chatId, userId]);
    if (!read || (read.doc.lastReadAt !== undefined && createdAt > read.doc.lastReadAt)) fresh.push(itemId);
  }
  return fresh.sort();
}

/**
 * The push.chat effect (chat design item 20): it runs 10 seconds after the answer (WAITED_KINDS), asks which items the person has
 * not read on any device and which are not deleted, and sends the one empty push only when one is left.
 */
export async function sendChatPush(payload: Record<string, unknown>, deps: Deps): Promise<void> {
  const userId = String(payload.userId ?? '');
  const items = Array.isArray(payload.items) ? (payload.items as ChatPushItem[]) : [];
  if (items.length === 0) return;
  if ((await stillNewItems(deps, userId, items)).length === 0) return;
  await sendPushNotify({ userId }, deps);
}

/** The push.notify effect: one push to each device of one person. */
export async function sendPushNotify(payload: Record<string, unknown>, deps: Deps): Promise<void> {
  const userId = String(payload.userId ?? '');
  // The primary, never a read copy: the effect runs right after the commit that wrote the notice or the device.
  const devices = await devicesOf(deps, userId);
  if (devices.length === 0) return;
  const config = deps.config.push;
  const sent: string[] = [];
  const gone: string[] = [];
  const retries: PushSendError[] = [];
  const off: PushConfigError[] = [];
  await Promise.all(devices.map(async ({ endpoint }) => {
    try {
      // deps.pushFetch: the office object posts through the network port of the Worker (server/office/net.ts).
      const outcome = await sendPush(config, endpoint, { now: () => deps.clock.now(), ...(deps.pushFetch ? { fetch: deps.pushFetch } : {}) });
      if (outcome === 'sent') sent.push(endpoint);
      else if (outcome === 'gone') gone.push(endpoint);
      else deps.log.warn('A push service refused a push. Nothing is tried again.', { host: new URL(endpoint).hostname });
    } catch (error) {
      if (error instanceof PushConfigError) off.push(error);
      else if (error instanceof PushSendError) retries.push(error);
      else throw error;
    }
  }));
  if (off.length > 0) {
    deps.log.warn('Push is off. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT in the function secrets. No push was sent.');
    return;
  }
  if (sent.length > 0) {
    if (isLite(deps.db)) for (const endpoint of sent.sort()) await deps.db.statement('write', PUSH_SENT_LITE, [endpoint, nowStamp(deps.clock.now())]);
    else await deps.db.statement('write', PUSH_SENT_SQL, [sent.sort(), nowStamp(deps.clock.now())]);
  }
  if (gone.length > 0) {
    if (isLite(deps.db)) for (const endpoint of gone.sort()) await deps.db.statement('write', PUSH_GONE_LITE, [endpoint]);
    else await deps.db.statement('write', PUSH_GONE_SQL, [gone.sort()]);
  }
  if (retries.length > 0) throw retries[0];
}
