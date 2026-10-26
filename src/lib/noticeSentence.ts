import type { CallOutput } from '../api/calls';
import type { Language } from '../api/contract/entities';
import { clockFormat, formatDay, listFormat, stampDay, todayISO } from './dates';
import { actorContext } from './grammar';
import { personName } from './personName';

/**
 * The sentence of one bell notice in one language. The bell row (src/features/notifications/NotificationsScreen.tsx) and the push
 * line of the server (server/push/line.ts, owner 2026-10-21) both write it here, so a notice reads the same in both places. No
 * React: the caller gives its own word function.
 */

export type NoticeView = CallOutput<'notifications.list'>[number];
/** The word function of i18next, or of the server's own instance (server/push/words.ts). */
export type Words = (key: string, params: Record<string, unknown>) => string;

/** The sentence of a report notice (owner, 2026-10-07; rejected, fbk_067). A hidden one has no words of its report, so it names nothing. */
function reportKey(n: NoticeView['notification']): string {
  if (!n.feedback) return 'inbox.feedback.hidden';
  const bug = n.feedback.kind === 'bug';
  if (n.trigger === 'feedback_sent') return bug ? 'inbox.feedback.sentBug' : 'inbox.feedback.sentFeature';
  // A notice with a reason says the report was rejected (fbk_067). The done notice has no reason.
  if (n.feedback.reason !== undefined) return bug ? 'inbox.feedback.rejectedBug' : 'inbox.feedback.rejectedFeature';
  return bug ? 'inbox.feedback.doneBug' : 'inbox.feedback.doneFeature';
}

/** The sentence of a group notice: a mention or an add, with the name of the group, or with "a group" when the person has left it. */
function groupKey(trigger: string, named: boolean): string {
  if (trigger === 'mention') return named ? 'inbox.mentionGroup' : 'inbox.mentionGroupGone';
  return named ? `inbox.trigger.${trigger}` : 'inbox.addedGroupGone';
}

/**
 * The sentence of a meeting notice (fbk_022): new, moved or cancelled for meeting_invited, and the reminder. A meeting that the person
 * no longer sees has no title and no time, so its sentence names neither.
 */
function meetingKey(n: NoticeView['notification'], gone: boolean): string {
  if (gone) return 'inbox.meetingGone';
  if (n.trigger === 'meeting_soon') return 'inbox.trigger.meeting_soon';
  if (n.meeting?.change === 'moved') return 'inbox.trigger.meeting_invited_moved';
  if (n.meeting?.change === 'cancelled') return 'inbox.trigger.meeting_invited_cancelled';
  return 'inbox.trigger.meeting_invited';
}

/**
 * The sentence of a copy for an Admin who picked "Everything" (owner, 2026-10-23). It names the actor and the people that the original
 * went to. A copy of an item that the viewer no longer sees names nobody, and says so in one line.
 */
function copyKey(view: NoticeView): string {
  const n = view.notification;
  if (view.forPeople.length === 0) return 'adminReach.copyGone';
  if (n.trigger === 'mention') return `adminReach.copy.${n.reply === true ? 'reply' : 'mention'}_${n.targetType === 'chat' ? 'chat' : 'task'}`;
  if (n.trigger === 'meeting_invited') return `adminReach.copy.meeting_${n.meeting?.change ?? 'new'}`;
  return `adminReach.copy.${n.trigger}`;
}

/**
 * The sentence of a mention that came from @everyone (owner, 2026-10-22, fbk_041): "<name> mentioned everyone in <place>". A group names the
 * group, or says "a group" when the person has left it.
 */
function everyoneKey(group: boolean, named: boolean): string {
  if (!group) return 'inbox.mentionEveryone';
  return named ? 'inbox.mentionEveryoneGroup' : 'inbox.mentionEveryoneGroupGone';
}

/** Up to 3 names in one list ("A, B and C"). With more people: the first 2 names, then the number of the others. */
const MOST_NAMES = 3;

export function noticeSentence(view: NoticeView, t: Words, lang: Language): string {
  const { notification: n, actor, target, project, gone, dueDate, startsAt } = view;
  const nameOf = (person: Parameters<typeof personName>[0]) => personName(person, lang);
  const report = n.targetType === 'feedback';
  // A group notice names the group, so it never reads as a direct message (UX audit 2026-10-19, INT-03). A group the person has left
  // has no name here, and its sentence says "a group".
  const group = n.targetType === 'chat' && view.chatKind === 'group';
  // A chat with no project and no group is a direct chat: its sentence names no place (audit 2026-10-03, SHL-14).
  const direct = n.trigger === 'mention' && n.targetType === 'chat' && !project && !group;
  // A restart reminder says "is today" on its day and "was <day>" after it (fbk_025). Its project name keeps its own direction.
  const restart = n.trigger === 'resume_due';
  const restartPast = restart && dueDate !== null && dueDate < todayISO();
  const meeting = n.targetType === 'meeting';
  // A payment reminder says "is due today" on its day and "was due <day>" after it (the Daftra link, owner 2026-10-26). A payment notice of a viewer
  // who may not see payments has no payment (the server takes it out), so its sentence names nothing.
  const paymentDue = n.trigger === 'payment_due';
  const paymentPast = paymentDue && dueDate !== null && dueDate < todayISO();
  // A reply to a message of the person says "replied to you" (chat design 2026-10-19, item 10). The place is named as for a mention.
  const reply = n.trigger === 'mention' && n.reply === true;
  // A mention that came from @everyone has its own sentence (owner, 2026-10-22, fbk_041).
  const everyone = n.trigger === 'mention' && n.everyone === true;
  // A copy for an Admin who picked "Everything" (owner, 2026-10-23) has its own sentences, with the people of the original.
  const copy = n.forUserIds !== undefined;
  const names = view.forPeople.map((person) => `\u2068${nameOf(person)}\u2069`);
  const people = names.length <= MOST_NAMES
    ? listFormat(lang).format(names)
    : t('adminReach.andOthers', { names: names.slice(0, 2).join(', '), others: t('adminReach.others', { count: names.length - 2 }) });
  // The name of a project in the target follows the language (owner, 2026-10-26, fbk_062). The other targets have no Arabic twin.
  const shownTarget = lang === 'ar' && view.targetAr ? view.targetAr : target;
  const sentenceKey = copy ? copyKey(view) : meeting ? meetingKey(n, gone) : report ? reportKey(n) : everyone ? everyoneKey(group, target !== '')
    : reply ? (direct ? 'notices.repliedDirect' : group && target === '' ? 'notices.repliedGroupGone' : 'notices.repliedToYou')
      : direct ? 'inbox.mentionDirect' : group ? groupKey(n.trigger, target !== '') : restartPast ? 'inbox.trigger.resume_due_past'
        : paymentDue && !n.payment ? 'inbox.paymentGone' : paymentPast ? 'inbox.trigger.payment_due_past' : `inbox.trigger.${n.trigger}`;
  return t(sentenceKey, {
    actor: actor ? nameOf(actor) : t('inbox.someone', {}),
    context: actorContext(actor),
    // The excerpt of a report, the name of a group and the title of a meeting keep their own direction (FSI and PDI), so an English "…" or "?" stays at its end in Arabic.
    people,
    target: report || group || restart || meeting || paymentDue ? `\u2068${shownTarget}\u2069` : shownTarget,
    // The reason of a rejected report is the Admin's own text, so it keeps its direction too (fbk_067).
    reason: n.feedback?.reason ? `\u2068${n.feedback.reason}\u2069` : '',
    // The name of a payment is the office's own text, so it keeps its direction too.
    payment: n.payment ? `\u2068${n.payment.name}\u2069` : '',
    // A reminder names its due day, which can be days away after a weekend (audit 2026-10-03, API-11). A meeting notice names the day and the time of the start (fbk_022).
    day: startsAt ? formatDay(stampDay(startsAt), lang, 'withWeekday') : dueDate ? formatDay(dueDate, lang, 'weekday') : '',
    time: startsAt ? clockFormat(lang).format(new Date(startsAt)) : '',
  });
}
