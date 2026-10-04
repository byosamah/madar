import type { Gender, Preferences, Trigger } from '../../src/api/contract/entities';
import { emailOn } from '../../src/api/notify';
import type { SaveResult } from '../data/save';
import { processOutbox, writeOutbox, type OutboxRow } from '../core/effects';
import type { Deps, Mail, Query } from '../core/ports';
import { QUOTA_LIMITS, sendCounted, utcDay, type QuotaKind, type SendCounted } from './quota';
import { renderMail, type RenderedMail } from './templates';

/**
 * The notice mail (plan 4.12, 5.4; task N2.2).
 *
 * - The producer: after the save of a write call, noticeRows() finds the notices that this transaction inserted and writes one
 *   mail.notice outbox row for each one whose person is an active human with the email switch of the trigger on (a switch the
 *   person never set takes its default, src/api/notify.ts). The rows commit with the call, so a rollback sends nothing.
 *   A new notice is a row whose xmin is the transaction's own id (runCall uses no savepoint around the save step, as the office
 *   cache relies on too) and that is unread. Only the read-mark calls change old notices, and markUnread makes one unread again,
 *   so those calls have no producer (NOTICE_FREE_CALLS). The 15-minute job (track N3) calls noticeRows() after its own save.
 * - The effect: sendNoticeMail() reads the notice and its person again after the commit, from the primary. A notice that an Undo
 *   took back, a person who left, and a switch that is off by now send nothing. The mail counts against the daily quota under
 *   the key notice-<id>, so an effect that runs twice keeps one place and Resend sends one mail.
 * - Notice 91 of the UTC day stays in the app. The first refusal of the day writes one mail.quotaWarning row for each active
 *   Admin in the same transaction as the mark (quota.ts), and those rows run right after.
 * - The mail carries no client data (plan 2, change 22): the trigger in general words and a link to the notices.
 */

export const NOTICE_EFFECT = 'mail.notice';
export const QUOTA_WARNING_EFFECT = 'mail.quotaWarning';

/** The calls that change old notices and never make one: no notice producer runs for them. */
export const NOTICE_FREE_CALLS: ReadonlySet<string> = new Set(['notifications.markRead', 'notifications.markAllRead', 'notifications.markUnread']);

/** $1 the people whose notices the save changed. The unread notices that the open transaction inserted, with their person. */
export const NEW_NOTICES_SQL = `select n.id, n.user_id, n.doc->>'trigger' as trigger, u.kind, u.active, u.doc->'preferences' as preferences
from notifications n join users u on u.id = n.user_id
where n.user_id = any($1::text[]) and not n.read
  and n.xmin::text::bigint = (pg_current_xact_id_if_assigned()::text::bigint % 4294967296)
order by n.ord`;

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

type NewNotice = { id: string; user_id: string; trigger: Trigger; kind: string; active: boolean; preferences: Preferences };
export type PersonRow = { user_id: string; kind: string; active: boolean; email: string; preferences: Preferences; gender: Gender | null };
type NoticeRow = PersonRow & { id: string; trigger: Trigger };

/** The screens URL and a path, with one slash between them. */
export function appLink(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/+$/, '')}${path}`;
}

/** True when the person may get mail at all: an active human. */
export const mailable = (person: Pick<PersonRow, 'kind' | 'active'>): boolean => person.kind === 'human' && person.active;

/** The mail.notice outbox rows of one save. Run inside the call's transaction, after the save. */
export async function noticeRows(q: Query, saved: Pick<SaveResult, 'kinds' | 'people'>): Promise<OutboxRow[]> {
  if (!saved.kinds.has('notifications') || saved.people.size === 0) return [];
  const found = await q<NewNotice>(NEW_NOTICES_SQL, [[...saved.people].sort()]);
  return found
    .filter((n) => mailable(n) && n.preferences.notifications[n.trigger] && emailOn(n.preferences, n.trigger))
    .map((n) => ({ kind: NOTICE_EFFECT, payload: { notificationId: n.id } }));
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
      const admins = await q<{ id: string }>(ADMINS_SQL);
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
  const [notice] = await deps.db.statement<NoticeRow>('write', NOTICE_MAIL_SQL, [id]);
  if (!notice || !mailable(notice)) return;
  const { preferences, trigger } = notice;
  if (!preferences.notifications[trigger] || !emailOn(preferences, trigger)) return;
  const rendered = renderMail('notice', preferences.language, { trigger, link: appLink(deps.config.appUrl, '/notifications') }, { reader: notice.gender ?? undefined }, { appUrl: deps.config.appUrl });
  await sendWarned(deps, 'notice', mailOf(notice.email, rendered, 'notice', `notice-${id}`), notice.user_id);
}

/** The mail.quotaWarning effect: one warning to one Admin, once a day. */
export async function sendQuotaWarning(payload: Record<string, unknown>, deps: Deps): Promise<void> {
  const userId = String(payload.userId ?? '');
  const day = String(payload.day ?? utcDay(deps.clock.now()));
  const [person] = await deps.db.statement<PersonRow>('write', USER_MAIL_SQL, [userId]);
  if (!person || !mailable(person)) return;
  const rendered = renderMail('quotaWarning', person.preferences.language, { limit: QUOTA_LIMITS.notice, link: appLink(deps.config.appUrl, '/admin') }, { reader: person.gender ?? undefined }, { appUrl: deps.config.appUrl });
  await sendCounted(deps, 'warning', mailOf(person.email, rendered, 'quota-warning', `quota-warning-${day}-${userId}`), { userId });
}
