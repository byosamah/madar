import { isEmailTrigger, type Gender, type Notification, type Preferences, type Trigger } from '../../src/api/contract/entities';
import { emailOn, inAppOn } from '../../src/api/notify';
import { isLite } from '../data/dialect';
import { liteDbOf } from '../data/lite/db';
import { readLiteOffice } from '../data/lite/office';
import type { SaveResult } from '../data/save';
import { processOutbox, writeOutbox, type OutboxRow } from '../core/effects';
import { isQuietNow } from '../core/quiet';
import type { Db, Deps, Mail, Query } from '../core/ports';
import { isChatItemNotice } from '../push/chatRule';
import { QUOTA_LIMITS, sendCounted, utcDay, type QuotaKind, type SendCounted } from './quota';
import { renderMail, type RenderedMail } from './templates';

/**
 * The notice mail (plan 4.12, 5.4; task N2.2).
 *
 * - The producer: after the save of a write call, noticeRows() finds the notices that this transaction inserted and writes one
 *   mail.notice outbox row for each one whose person is an active human with the email switch of the trigger on (a switch the
 *   person never set takes its default, src/api/notify.ts). The notices of requests and bugs stay in the app and never get a row
 *   (IN_APP_ONLY_TRIGGERS; owner, 2026-10-07). The rows commit with the call, so a rollback sends nothing.
 *   A new notice is a row whose xmin is the transaction's own id (runCall uses no savepoint around the save step, as the office
 *   cache relies on too) and that is unread. Only the read-mark calls change old notices, and markUnread makes one unread again,
 *   so those calls have no producer (NOTICE_FREE_CALLS). The 15-minute job (track N3) calls noticeRows() after its own save.
 * - The effect: sendNoticeMail() reads the notice and its person again after the commit, from the primary. A notice that an Undo
 *   took back, a person who left, and a switch that is off by now send nothing. The mail counts against the daily quota under
 *   the key notice-<id>, so an effect that runs twice keeps one place and Resend sends one mail.
 * - Notice 91 of the UTC day stays in the app. The first refusal of the day writes one mail.quotaWarning row for each active
 *   Admin in the same transaction as the mark (quota.ts), and those rows run right after.
 * - Quiet hours (owner, 2026-10-22, fbk_048): sendNoticeMail asks isQuietNow (server/core/quiet.ts) at send time, after the wait of a chat mail. A
 *   person in quiet hours gets no mail: the row ends as done, no place of the quota is taken, and no mail goes later. The bell keeps the notice.
 * - The mail carries no client data (plan 2, change 22): the trigger in general words and a link to the notices.
 */

export const NOTICE_EFFECT = 'mail.notice';
/** The mention or reply mail of a chat message or a task comment: it waits 10 seconds after the answer and checks again (chat design item 20). */
export const CHAT_NOTICE_EFFECT = 'mail.chatNotice';
export const QUOTA_WARNING_EFFECT = 'mail.quotaWarning';

/**
 * The calls that change old notices and never make one: no notice producer runs for them. A read of a chat or a task thread and an
 * archive mark its mention notices read (chat design item 20), and the Notify me choice (chats.setNotify) touches no notice.
 */
export const NOTICE_FREE_CALLS: ReadonlySet<string> = new Set([
  'notifications.markRead', 'notifications.markAllRead', 'notifications.markUnread', 'chats.markRead', 'chats.archive', 'chats.setNotify',
]);

/**
 * $1 the people whose notices the save changed. The unread notices that the open transaction inserted, with their person. A copy for an
 * Admin who picked "Everything" has "forUserIds" and gets no mail (owner, 2026-10-23).
 */
export const NEW_NOTICES_SQL = `select n.id, n.user_id, n.doc->>'trigger' as trigger, n.target_type, n.doc->>'messageId' as message_id, u.kind, u.active, u.doc->'preferences' as preferences
from notifications n join users u on u.id = n.user_id
where n.user_id = any($1::text[]) and not n.read
  and n.xmin::text::bigint = (pg_current_xact_id_if_assigned()::text::bigint % 4294967296)
  and n.doc->'forUserIds' is null
order by n.ord`;

/**
 * SQLite (exit wave 3): one notice that the save inserted, if it is still unread. SQLite has no xmin: the save names its new
 * notices (SaveResult.noticeIds). The person comes from the office lists in memory, as the users table holds only id and doc.
 */
export const NEW_NOTICE_LITE = 'select id, user_id, doc from notifications where id = ?1 and read = 0';

/** $1 the notice. The notice and the person who gets it. */
export const NOTICE_MAIL_SQL = `select n.id, n.doc->>'trigger' as trigger, u.id as user_id, u.kind, u.active, u.doc->>'email' as email,
  u.doc->'preferences' as preferences, u.doc->>'gender' as gender
from notifications n join users u on u.id = n.user_id
where n.id = $1`;

/** $1 the person. */
export const USER_MAIL_SQL = `select id as user_id, kind, active, doc->>'email' as email, doc->'preferences' as preferences, doc->>'gender' as gender
from users where id = $1`;

/** The people who get the quota warning: every active Admin. */
export const ADMINS_SQL = "select id from users where kind = 'human' and active and doc->>'systemRole' = 'admin' order by ord";

/**
 * $1 the person. The row of USER_MAIL_SQL with the system role, so a warning to the Admins (the quota warning here)
 * sends nothing to a person who lost the Admin role between the row write and the send (the job
 * retries a row for about an hour).
 */
export const ADMIN_MAIL_SQL = `select id as user_id, kind, active, doc->>'email' as email, doc->'preferences' as preferences, doc->>'gender' as gender,
  doc->>'systemRole' as system_role
from users where id = $1`;

// SQLite forms (exit wave 3): the users table holds id and doc only, so the person fields come from doc.
export const NOTICE_MAIL_LITE = "select n.id as id, json_extract(n.doc, '$.trigger') as trigger, u.doc as doc from notifications n join users u on u.id = n.user_id where n.id = ?1";
export const USER_DOC_LITE = 'select doc from users where id = ?1';
export const ADMINS_LITE = "select rowid as ord, id from users where json_extract(doc, '$.kind') = 'human' and json_type(doc, '$.active') = 'true' and json_extract(doc, '$.systemRole') = 'admin'";

type NewNotice = { id: string; user_id: string; trigger: Trigger; target_type?: string; message_id?: string | null; kind: string; active: boolean; preferences: Preferences };
export type PersonRow = { user_id: string; kind: string; active: boolean; email: string; preferences: Preferences; gender: Gender | null };
type NoticeRow = PersonRow & { id: string; trigger: Trigger };
type UserDoc = { id: string; kind: string; active?: boolean; email: string; preferences: Preferences; gender?: Gender | null; systemRole?: string };

/** The row of USER_MAIL_SQL and ADMIN_MAIL_SQL, made from a users doc. */
export function personOfDoc(doc: UserDoc): PersonRow & { system_role: string | null } {
  return { user_id: doc.id, kind: doc.kind, active: doc.active === true, email: doc.email, preferences: doc.preferences, gender: doc.gender ?? null, system_role: doc.systemRole ?? null };
}

/** The person of one user id on SQLite, as at most one row: the shape of a statement answer. */
export async function litePerson(db: Db, userId: string): Promise<(PersonRow & { system_role: string | null })[]> {
  return (await db.statement<{ doc: UserDoc }>('read', USER_DOC_LITE, [userId])).map((row) => personOfDoc(row.doc));
}

/** Every active Admin, oldest first (ADMINS_SQL), on both databases. */
export async function adminsOf(q: Query): Promise<{ id: string }[]> {
  if (!isLite(q)) return q<{ id: string }>(ADMINS_SQL);
  return (await q<{ ord: number; id: string }>(ADMINS_LITE)).sort((a, b) => a.ord - b.ord).map((row) => ({ id: row.id }));
}

/** The notice and its person on SQLite, as at most one row of NOTICE_MAIL_SQL. */
async function liteNotice(db: Db, id: string): Promise<NoticeRow[]> {
  const rows = await db.statement<{ id: string; trigger: Trigger; doc: UserDoc }>('read', NOTICE_MAIL_LITE, [id]);
  return rows.map((row) => ({ ...personOfDoc(row.doc), id: row.id, trigger: row.trigger }));
}

/** The screens URL and a path, with one slash between them. */
export function appLink(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/+$/, '')}${path}`;
}

/** True when the person may get mail at all: an active human. */
export const mailable = (person: Pick<PersonRow, 'kind' | 'active'>): boolean => person.kind === 'human' && person.active;

/**
 * The outbox row of one new notice (chat design item 20): a mention or reply notice of a chat message or a task comment waits 10 seconds
 * and sends nothing when the person read it by then (mail.chatNotice). Every other notice goes at once (mail.notice).
 */
function mailRowOf(id: string, targetType: string | undefined, messageId: string | null | undefined): OutboxRow {
  const waits = isChatItemNotice({ targetType: targetType ?? '', messageId });
  return { kind: waits ? CHAT_NOTICE_EFFECT : NOTICE_EFFECT, payload: { notificationId: id } };
}

/** The mail outbox rows of one save. Run inside the call's transaction, after the save. */
export async function noticeRows(q: Query, saved: Pick<SaveResult, 'kinds' | 'people' | 'noticeIds'>): Promise<OutboxRow[]> {
  if (!saved.kinds.has('notifications') || saved.people.size === 0) return [];
  if (isLite(q)) return liteNoticeRows(q, saved.noticeIds ?? []);
  const found = await q<NewNotice>(NEW_NOTICES_SQL, [[...saved.people].sort()]);
  return found
    .filter((n) => mailable(n) && inAppOn(n.preferences, n.trigger) && emailOn(n.preferences, n.trigger))
    .map((n) => mailRowOf(n.id, n.target_type, n.message_id));
}

/** The mail rows of the new notices on SQLite, in the order of the save (the order of ord on Postgres). */
async function liteNoticeRows(q: Query, ids: readonly string[]): Promise<OutboxRow[]> {
  if (ids.length === 0) return [];
  const { lists } = await readLiteOffice(liteDbOf(q), q);
  const rows: OutboxRow[] = [];
  for (const id of ids) {
    const [notice] = await q<{ id: string; user_id: string; doc: Notification }>(NEW_NOTICE_LITE, [id]);
    const person = notice ? lists.users[notice.user_id] : undefined;
    if (!notice || !person) continue;
    // A copy for an Admin who picked "Everything" gets no mail (owner, 2026-10-23).
    if (notice.doc.forUserIds !== undefined) continue;
    const trigger = notice.doc.trigger;
    if (mailable(person) && inAppOn(person.preferences, trigger) && emailOn(person.preferences, trigger)) {
      rows.push(mailRowOf(notice.id, notice.doc.targetType, notice.doc.messageId ?? null));
    }
  }
  return rows;
}

/** One rendered mail as the port takes it. */
export function mailOf(to: string, rendered: RenderedMail, tag: string, idempotencyKey: string): Mail {
  return { to, subject: rendered.subject, html: rendered.html, text: rendered.text, tag, idempotencyKey };
}

/**
 * One counted mail that warns the Admins on the first refusal of the day: the warning rows commit with the refusal mark, and run
 * right after. A notice or a summary goes through here; a warning itself never warns.
 */
export async function sendWarned(deps: Deps, kind: QuotaKind, mail: Mail, userId: string): Promise<SendCounted> {
  const day = utcDay(deps.clock.now());
  let warnings: string[] = [];
  const result = await sendCounted(deps, kind, mail, {
    userId,
    onFirstRefusal: async (q) => {
      const admins = await adminsOf(q);
      warnings = await writeOutbox(q, admins.map((admin) => ({ kind: QUOTA_WARNING_EFFECT, payload: { userId: admin.id, day } })));
    },
  });
  if (result.status === 'over' && warnings.length > 0) await processOutbox(deps, warnings);
  return result;
}

/** The mail.notice effect. */
export async function sendNoticeMail(payload: Record<string, unknown>, deps: Deps): Promise<void> {
  const id = String(payload.notificationId ?? '');
  // The primary, never a read copy: the effect runs right after the commit that wrote the notice.
  const [notice] = isLite(deps.db) ? await liteNotice(deps.db, id) : await deps.db.statement<NoticeRow>('write', NOTICE_MAIL_SQL, [id]);
  if (!notice || !mailable(notice)) return;
  const { preferences, trigger } = notice;
  // A notice that stays in the app has no mail (owner, 2026-10-07). emailOn says the same; the check also gives the mail its type.
  if (!isEmailTrigger(trigger) || !inAppOn(preferences, trigger) || !emailOn(preferences, trigger)) return;
  // Quiet hours (owner, 2026-10-22, fbk_048): a person in quiet hours gets no mail at send time. The row ends as done, and no mail goes later.
  // The place of the day quota is taken only inside sendCounted, so nothing is reserved yet and nothing needs to go back.
  if (await isQuietNow(deps.db, notice.user_id, deps.clock.now())) return;
  const rendered = renderMail('notice', preferences.language, { trigger, link: appLink(deps.config.appUrl, '/notifications') }, { reader: notice.gender ?? undefined }, { appUrl: deps.config.appUrl });
  await sendWarned(deps, 'notice', mailOf(notice.email, rendered, 'notice', `notice-${id}`), notice.user_id);
}

/** $1 the notice. The notice, when it is still unread. A read of the chat marks its mention notices read (chat design item 20). */
export const NOTICE_UNREAD_SQL = 'select id from notifications where id = $1 and not read';
export const NOTICE_UNREAD_LITE = 'select id from notifications where id = ?1 and read = 0';

/**
 * The mail.chatNotice effect: the mention or reply mail of a chat message or a task comment, 10 seconds after the answer. A notice that
 * is read by now (the person read the chat or the notice), or gone (a delete or an edit took it), sends nothing. Otherwise it sends
 * the same mail as sendNoticeMail, with the same quota and the same key notice-<id>.
 */
export async function sendChatNoticeMail(payload: Record<string, unknown>, deps: Deps): Promise<void> {
  const id = String(payload.notificationId ?? '');
  // The primary, never a read copy: the read may have committed a moment ago.
  const unread = await deps.db.statement<{ id: string }>('write', isLite(deps.db) ? NOTICE_UNREAD_LITE : NOTICE_UNREAD_SQL, [id]);
  if (unread.length === 0) return;
  await sendNoticeMail(payload, deps);
}

/** The mail.quotaWarning effect: one warning to one Admin, once a day. A person who is no longer an Admin gets nothing. */
export async function sendQuotaWarning(payload: Record<string, unknown>, deps: Deps): Promise<void> {
  const userId = String(payload.userId ?? '');
  const day = String(payload.day ?? utcDay(deps.clock.now()));
  const [person] = isLite(deps.db) ? await litePerson(deps.db, userId) : await deps.db.statement<PersonRow & { system_role: string | null }>('write', ADMIN_MAIL_SQL, [userId]);
  if (!person || !mailable(person) || person.system_role !== 'admin') return;
  const rendered = renderMail('quotaWarning', person.preferences.language, { limit: QUOTA_LIMITS.notice, link: appLink(deps.config.appUrl, '/admin') }, { reader: person.gender ?? undefined }, { appUrl: deps.config.appUrl });
  await sendCounted(deps, 'warning', mailOf(person.email, rendered, 'quota-warning', `quota-warning-${day}-${userId}`), { userId });
}
