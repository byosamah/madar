import type { Conversation } from '../../src/api/contract/entities';
import { nowStamp } from '../../src/lib/dates';
import type { OfficeSnapshot } from '../core/types';
import { isLite } from '../data/dialect';
import { liteDbOf } from '../data/lite/db';
import { readLiteOffice } from '../data/lite/office';
import type { SaveResult } from '../data/save';
import type { OutboxRow } from '../core/effects';
import type { Deps, Query } from '../core/ports';
import { sendPush, PushSendError } from './send';
import { PushConfigError } from './vapid';

/**
 * Browser push for every new notice and every new chat message (owner, 2026-10-08).
 *
 * - The producer: after the save of a write call, pushRows() finds the people who get something new and writes ONE push.notify
 *   outbox row for each one. A person gets a row when the save wrote an unread notice for them, or a message in a chat that
 *   they read and did not write, and they are an active human with at least one device. The rows commit with the call, so a
 *   rollback sends nothing. The 15-minute job calls pushRows() after its own save, where it calls noticeRows().
 *   A new notice is a row whose xmin is the id of the open transaction (the same rule as NEW_NOTICES_SQL in server/mail/notices.ts).
 *   A new message is one of the ids that the save step names (SaveResult.messageIds).
 * - The effect: sendPushNotify() reads the devices of the person again after the commit, and posts an empty push to each one
 *   (send.ts). The browser shows one fixed line (public/sw.js). The push carries no client data and no person.
 * - A device that the push service calls gone (404, 410) is removed. A device that took the push gets lastPushAt. A 429, a 5xx or
 *   a network error throws after the other devices were handled, so the outbox tries the row again. A retry posts to every device
 *   of the person again; the tag of the notification (madar-new) makes the browser show one line only.
 * - This is the one effect that writes a State table outside runCall. It touches push_devices only: private rows with no event,
 *   no chg, no signal. Every other write of a record goes through runCall.
 */

export const PUSH_EFFECT = 'push.notify';

/**
 * $1 the people whose notices the save changed. The people with a new unread notice from this transaction who may get a push.
 */
export const PUSH_NOTICE_PEOPLE_SQL = `select distinct n.user_id
from notifications n join users u on u.id = n.user_id
where n.user_id = any($1::text[]) and not n.read
  and n.xmin::text::bigint = (pg_current_xact_id_if_assigned()::text::bigint % 4294967296)
  and u.kind = 'human' and u.active
  and exists (select 1 from push_devices d where d.user_id = n.user_id)
order by n.user_id`;

/**
 * $1 the ids of the messages that the save inserted. The people who read those chats and did not write the message: a direct
 * chat or a group goes to its members, a project chat to the leader, the team and the Admins. The author and the person the
 * author acts for (an agent writes for a person) never get it.
 */
export const PUSH_MESSAGE_PEOPLE_SQL = `with sent as (
  select m.doc->>'authorId' as author_id, m.doc->>'actingForId' as acting_for_id, c.kind, c.project_id, c.doc->'memberIds' as member_ids
  from messages m join conversations c on c.id = m.conversation_id
  where m.id = any($1::text[])
),
audience as (
  select s.author_id, s.acting_for_id, member.user_id
  from sent s cross join lateral jsonb_array_elements_text(s.member_ids) as member(user_id)
  where s.kind in ('direct', 'group')
  union
  select s.author_id, s.acting_for_id, p.leader_id
  from sent s join projects p on p.id = s.project_id
  where s.kind = 'project' and p.leader_id is not null
  union
  select s.author_id, s.acting_for_id, mb.user_id
  from sent s join members mb on mb.project_id = s.project_id
  where s.kind = 'project'
  union
  select s.author_id, s.acting_for_id, adm.id
  from sent s cross join users adm
  where s.kind = 'project' and adm.kind = 'human' and adm.active and adm.doc->>'systemRole' = 'admin'
)
select distinct a.user_id
from audience a join users u on u.id = a.user_id
where u.kind = 'human' and u.active
  and a.user_id is distinct from a.author_id and a.user_id is distinct from a.acting_for_id
  and exists (select 1 from push_devices d where d.user_id = a.user_id)
order by a.user_id`;

// SQLite (exit wave 3). The new notices come from the save (SaveResult.noticeIds), the people of a chat from the office lists in
// memory: the users, conversations, projects and members tables hold only id and doc. One bound list each (json_each).
export const PUSH_NOTICE_PEOPLE_LITE = 'select distinct user_id from notifications where id in (select value from json_each(?1)) and read = 0';
export const PUSH_DEVICE_PEOPLE_LITE = 'select distinct user_id from push_devices where user_id in (select value from json_each(?1))';
export const MESSAGE_LITE = 'select conversation_id, doc from messages where id = ?1';

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

type PersonRow = { user_id: string };

/** The push.notify outbox rows of one save. Run inside the call's transaction, after the save. */
export async function pushRows(q: Query, saved: Pick<SaveResult, 'kinds' | 'people' | 'messageIds' | 'noticeIds'>): Promise<OutboxRow[]> {
  if (isLite(q)) return litePushRows(q, saved);
  const people = new Set<string>();
  if (saved.kinds.has('notifications') && saved.people.size > 0) {
    for (const row of await q<PersonRow>(PUSH_NOTICE_PEOPLE_SQL, [[...saved.people].sort()])) people.add(row.user_id);
  }
  if ((saved.messageIds?.length ?? 0) > 0) {
    for (const row of await q<PersonRow>(PUSH_MESSAGE_PEOPLE_SQL, [saved.messageIds])) people.add(row.user_id);
  }
  return [...people].sort().map((userId) => ({ kind: PUSH_EFFECT, payload: { userId } }));
}

/** The people who read a chat, as PUSH_MESSAGE_PEOPLE_SQL finds them: the members of a direct chat or a group; a project's leader, team and Admins. */
function chatAudience(lists: OfficeSnapshot['lists'], chat: Conversation): string[] {
  if (chat.kind !== 'project') return [...chat.memberIds];
  if (chat.projectId === null) return [];
  const projectId = chat.projectId;
  const out = Object.values(lists.members).filter((m) => m.projectId === projectId).map((m) => m.userId);
  const leaderId = lists.projects[projectId]?.leaderId;
  if (leaderId) out.push(leaderId);
  for (const user of Object.values(lists.users)) if (user.kind === 'human' && user.active && user.systemRole === 'admin') out.push(user.id);
  return out;
}

/** The push.notify rows of one save on SQLite (exit wave 3): the same people as the two Postgres texts. */
async function litePushRows(q: Query, saved: Pick<SaveResult, 'kinds' | 'people' | 'messageIds' | 'noticeIds'>): Promise<OutboxRow[]> {
  const noticeIds = saved.kinds.has('notifications') && saved.people.size > 0 ? saved.noticeIds ?? [] : [];
  const messageIds = saved.messageIds ?? [];
  if (noticeIds.length === 0 && messageIds.length === 0) return [];
  const { lists } = await readLiteOffice(liteDbOf(q), q);
  const reads = (userId: string) => lists.users[userId]?.kind === 'human' && lists.users[userId]?.active === true;
  const people = new Set<string>();
  if (noticeIds.length > 0) {
    for (const row of await q<PersonRow>(PUSH_NOTICE_PEOPLE_LITE, [noticeIds])) if (reads(row.user_id)) people.add(row.user_id);
  }
  for (const id of messageIds) {
    const [message] = await q<{ conversation_id: string; doc: { authorId?: string; actingForId?: string | null } }>(MESSAGE_LITE, [id]);
    const chat = message ? lists.conversations[message.conversation_id] : undefined;
    if (!message || !chat) continue;
    for (const userId of chatAudience(lists, chat)) {
      if (userId !== message.doc.authorId && userId !== message.doc.actingForId && reads(userId)) people.add(userId);
    }
  }
  if (people.size === 0) return [];
  const withDevice = new Set((await q<PersonRow>(PUSH_DEVICE_PEOPLE_LITE, [[...people].sort()])).map((row) => row.user_id));
  return [...people].filter((userId) => withDevice.has(userId)).sort().map((userId) => ({ kind: PUSH_EFFECT, payload: { userId } }));
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
