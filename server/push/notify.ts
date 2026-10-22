import type { PushKeys } from '../../src/api/contract/entities';
import { nowStamp } from '../../src/lib/dates';
import { isQuietNow } from '../core/quiet';
import { isLite } from '../data/dialect';
import type { OutboxRow } from '../core/effects';
import type { Deps, Query } from '../core/ports';
import { MESSAGE_LITE, PUSH_COMMENT_LITE, readPushFacts, type PushSaved } from './chatFacts';
import { planPushes, type ChatPushItem } from './chatRule';
import { encryptPush, PushTextError } from './encrypt';
import { chatLine, noticeLine, type LineOptions, type PushLine } from './line';
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
 * - The effects: sendPushNotify() reads the devices of the person again after the commit, and posts a push to each one (send.ts).
 *   sendChatPush() first asks which items the person has not read on any device and which are not deleted.
 * - The line (owner, 2026-10-21, "Like WhatsApp"): when a device has keys, the effect reads AS THE PERSON (line.ts) and posts the
 *   line encrypted for that device alone (encrypt.ts): the bell sentence of a notice, or "Name: words" of a chat. A device with no
 *   keys, or a line that cannot be made, gets the empty push, and the browser shows the fixed line (public/sw.js). The log of the
 *   server never holds the words of a line.
 * - A device that the push service calls gone (404, 410) is removed. A device that took the push gets lastPushAt. A 429, a 5xx or
 *   a network error throws after the other devices were handled, so the outbox tries the row again. A retry posts to every device
 *   of the person again; the tag of the notification (madar-new) makes the browser show one line only.
 * - Quiet hours (owner, 2026-10-22, fbk_048): both effects ask isQuietNow (server/core/quiet.ts) at send time. A person in quiet hours gets no
 *   push: the effect marks the devices of the person held (heldAt) and ends as done. The job step held.ts sends ONE push when the quiet
 *   hours are over, and clears the mark.
 * - This is the one effect that writes a State table outside runCall. It touches push_devices only: private rows with no event,
 *   no chg, no signal. Every other write of a record goes through runCall.
 */

export const PUSH_EFFECT = 'push.notify';
/** The push of a chat message or a task comment: it waits 10 seconds after the answer and checks again (chat design item 20). */
export const PUSH_CHAT_EFFECT = 'push.chat';

export {
  MESSAGE_LITE, PUSH_COMMENT_LITE, PUSH_DEVICE_PEOPLE_LITE, PUSH_FACTS_SQL, PUSH_ITEMS_SQL, PUSH_LEVELS_LITE, PUSH_LEVELS_SQL, PUSH_NEW_NOTICES_LITE, PUSH_NEW_NOTICES_SQL, PUSH_PEOPLE_SQL, PUSH_TASK_LITE,
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

/** $1 the person. The push addresses of an active human, with the keys of each browser (null before 2026-10-21), oldest device first. */
export const PUSH_DEVICES_SQL = `select d.endpoint, d.doc->'keys' as keys
from push_devices d join users u on u.id = d.user_id
where d.user_id = $1 and u.kind = 'human' and u.active
order by d.ord`;

/**
 * $1 the endpoints that took the push, $2 the stamp. A device that took a push holds nothing back any more (quiet hours, owner
 * 2026-10-22): the mark "heldAt" goes, so the job step of the quiet end sends it nothing more.
 */
export const PUSH_SENT_SQL = "update push_devices set doc = jsonb_set(doc, '{lastPushAt}', to_jsonb($2::text)) - 'heldAt' where endpoint = any($1::text[])";

/**
 * Quiet hours (owner, 2026-10-22, fbk_048). $1 the person, $2 the stamp. A push for a person in quiet hours is not sent: the effect marks
 * the devices of the person as held, once, and ends. The job step of the quiet end (held.ts) sends ONE push when the quiet hours are over.
 * The mark is a private field of the device row: no event, no chg, no signal.
 */
export const PUSH_HOLD_SQL = "update push_devices set doc = jsonb_set(doc, '{heldAt}', to_jsonb($2::text)) where user_id = $1 and doc->>'heldAt' is null";
/** $1 the person. The devices of the person hold nothing back any more. */
export const PUSH_RELEASE_SQL = "update push_devices set doc = doc - 'heldAt' where user_id = $1 and doc->>'heldAt' is not null";

/** $1 the endpoints that the push service calls gone. */
export const PUSH_GONE_SQL = 'delete from push_devices where endpoint = any($1::text[])';

// SQLite forms (exit wave 3). The person of a device is read from the users doc; a list of endpoints goes one statement each.
export const PUSH_DEVICES_LITE = "select d.rowid as ord, d.endpoint as endpoint, json_extract(d.doc, '$.keys') as keys, u.doc as doc from push_devices d join users u on u.id = d.user_id where d.user_id = ?1";
export const PUSH_SENT_LITE = "update push_devices set doc = json_remove(json_set(doc, '$.lastPushAt', ?2), '$.heldAt') where endpoint = ?1";
export const PUSH_HOLD_LITE = "update push_devices set doc = json_set(doc, '$.heldAt', ?2) where user_id = ?1 and json_extract(doc, '$.heldAt') is null";
export const PUSH_RELEASE_LITE = "update push_devices set doc = json_remove(doc, '$.heldAt') where user_id = ?1 and json_extract(doc, '$.heldAt') is not null";
export const PUSH_GONE_LITE = 'delete from push_devices where endpoint = ?1';

export type Device = { endpoint: string; keys: PushKeys | null };

/** The keys of a device as the database gives them: an object (jsonb), JSON text (SQLite), or nothing. */
function keysOf(value: unknown): PushKeys | null {
  const keys = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (typeof keys !== 'object' || keys === null) return null;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  return typeof p256dh === 'string' && typeof auth === 'string' ? { p256dh, auth } : null;
}

/** The push addresses of an active human, with their keys, oldest device first, on both databases. */
export async function devicesOf(deps: Deps, userId: string): Promise<Device[]> {
  if (!isLite(deps.db)) {
    const rows = await deps.db.statement<{ endpoint: string; keys?: unknown }>('write', PUSH_DEVICES_SQL, [userId]);
    return rows.map((row) => ({ endpoint: row.endpoint, keys: keysOf(row.keys) }));
  }
  const rows = await deps.db.statement<{ ord: number; endpoint: string; keys?: unknown; doc: { kind?: string; active?: boolean } }>('read', PUSH_DEVICES_LITE, [userId]);
  return rows.filter((row) => row.doc.kind === 'human' && row.doc.active === true).sort((a, b) => a.ord - b.ord)
    .map((row) => ({ endpoint: row.endpoint, keys: keysOf(row.keys) }));
}

/**
 * The line, or null. A failure to make it never stops the push: the person gets the fixed line. The log names the kind of error
 * only, never its text, which may quote the words of a message.
 */
async function lineOrNull(deps: Deps, devices: Device[], make: () => Promise<PushLine | null>): Promise<PushLine | null> {
  if (!devices.some((device) => device.keys !== null)) return null;
  try {
    return await make();
  } catch (error) {
    deps.log.warn('The push line could not be made. The fixed line goes.', { error: error instanceof Error ? error.name : 'unknown' });
    return null;
  }
}

/** The encrypted line for one device, or no body (no keys, no line, or keys of a wrong form). */
async function bodyFor(device: Device, line: PushLine | null): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (!line || !device.keys) return undefined;
  try {
    return await encryptPush(new TextEncoder().encode(JSON.stringify(line)), device.keys);
  } catch (error) {
    if (error instanceof PushTextError) return undefined;
    throw error;
  }
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

/** Marks the devices of a person as held (PUSH_HOLD_SQL), on both databases. */
async function holdDevices(deps: Deps, userId: string): Promise<void> {
  const stamp = nowStamp(deps.clock.now());
  await deps.db.statement('write', isLite(deps.db) ? PUSH_HOLD_LITE : PUSH_HOLD_SQL, [userId, stamp]);
}

/** Gives back the devices of a person: they hold nothing any more (PUSH_RELEASE_SQL), on both databases. */
export async function releaseDevices(deps: Deps, userId: string): Promise<void> {
  await deps.db.statement('write', isLite(deps.db) ? PUSH_RELEASE_LITE : PUSH_RELEASE_SQL, [userId]);
}

/**
 * The push.chat effect (chat design item 20): it runs 10 seconds after the answer (WAITED_KINDS), asks which items the person has
 * not read on any device and which are not deleted, and sends the one empty push only when one is left.
 */
export async function sendChatPush(payload: Record<string, unknown>, deps: Deps, o: LineOptions = {}): Promise<void> {
  const userId = String(payload.userId ?? '');
  const items = Array.isArray(payload.items) ? (payload.items as ChatPushItem[]) : [];
  if (items.length === 0) return;
  const fresh = await stillNewItems(deps, userId, items);
  if (fresh.length === 0) return;
  // Quiet hours (owner, 2026-10-22): asked at send time, after the wait. A person in quiet hours gets no push now, and the row ends as done.
  if (await isQuietNow(deps.db, userId, deps.clock.now())) return holdDevices(deps, userId);
  // The line shows the chat of the newest item that is still new.
  const newest = [...items].reverse().find((item) => fresh.includes(item.itemId));
  const devices = await devicesOf(deps, userId);
  if (devices.length === 0) return;
  const line = newest ? await lineOrNull(deps, devices, () => chatLine(deps, userId, newest.chatId, o)) : null;
  await postToDevices(deps, devices, line);
}

/** The push.notify effect: one push to each device of one person, with the line of the newest unread notice. */
export async function sendPushNotify(payload: Record<string, unknown>, deps: Deps, o: LineOptions = {}): Promise<void> {
  const userId = String(payload.userId ?? '');
  // Quiet hours (owner, 2026-10-22): a person in quiet hours gets no push now, and the row ends as done. The bell keeps the notice.
  if (await isQuietNow(deps.db, userId, deps.clock.now())) return holdDevices(deps, userId);
  // The primary, never a read copy: the effect runs right after the commit that wrote the notice or the device.
  const devices = await devicesOf(deps, userId);
  if (devices.length === 0) return;
  await postToDevices(deps, devices, await lineOrNull(deps, devices, () => noticeLine(deps, userId, o)));
}

/** One push to each device: the encrypted line where the device has keys, else the empty push. */
export async function postToDevices(deps: Deps, devices: Device[], line: PushLine | null): Promise<void> {
  const config = deps.config.push;
  const sent: string[] = [];
  const gone: string[] = [];
  const retries: PushSendError[] = [];
  const off: PushConfigError[] = [];
  await Promise.all(devices.map(async (device) => {
    const { endpoint } = device;
    try {
      const body = await bodyFor(device, line);
      // deps.pushFetch: the office object posts through the network port of the Worker (server/office/net.ts).
      const outcome = await sendPush(config, endpoint, { now: () => deps.clock.now(), ...(deps.pushFetch ? { fetch: deps.pushFetch } : {}), ...(body ? { body } : {}) });
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
