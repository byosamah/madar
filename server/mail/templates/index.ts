import type { EmailTrigger, Gender, Language } from '../../../src/api/contract/entities';
import { formatDay } from '../../../src/lib/dates';
import { actorContext } from '../../../src/lib/grammar';
import type { SummaryLine } from '../summaryTasks';
import { logoAddress, renderPage, type MailGroup, type RenderedMail } from './layout';
import { mailWords } from './words';

export type { RenderedMail } from './layout';

/**
 * The mail templates (plan 5.4; task N2.1): one for each kind, in the person's language, Arabic right to left with the female forms.
 * A notice mail carries no client data (plan 2, change 22; section 10, decision 8): Resend keeps mail content in the US, so it
 * says what happened in general words and gives a link, and never a task title, a project name or comment text. The morning
 * summary is the one exception (owner, 2026-10-19, fbk_021): it lists the open tasks of its reader, each with the task title, the
 * project key (or "Office") and the due day, and nothing else of the project, the client or a comment.
 * A template reads only the fields of its data type, so extra fields that a caller passes never reach the mail.
 */

export const MAIL_TEMPLATES = ['invite', 'reset', 'notice', 'summary', 'quotaWarning'] as const;
export type MailTemplate = (typeof MAIL_TEMPLATES)[number];

export type MailData = {
  /** name: the new person; inviterName: the Admin who invited them. */
  invite: { name: string; inviterName: string; link: string };
  reset: { name: string; link: string };
  /** Only a trigger that sends email: the notices of requests and bugs have no mail words (owner, 2026-10-07). */
  notice: { trigger: EmailTrigger; link: string };
  /** The open tasks in three groups (server/mail/summaryTasks.ts), at most 8 lines in all; more: the tasks that do not show. */
  summary: { pastDue: SummaryLine[]; today: SummaryLine[]; week: SummaryLine[]; more: number; reviewsWaiting: number; link: string };
  /** limit: the daily notice limit that stopped the mail (90). */
  quotaWarning: { limit: number; link: string };
};

/** actor: the person who did the thing (the inviter); reader: the person who gets the mail. */
export type MailGenders = { actor?: Gender; reader?: Gender };

/** appUrl: the screens (APP_URL of the server config), for the Madar mark in the header. Without it the header shows the name only. */
export type MailOptions = { appUrl?: string };

type Parts = {
  subject: string; greeting?: string; paragraphs: string[]; groups?: MailGroup[]; closing?: string[]; button: string;
  footer: 'footerNotice' | 'footerSummary' | 'footerAuto';
};

function partsOf<K extends MailTemplate>(kind: K, lang: Language, data: MailData[K], t: ReturnType<typeof mailWords>, g: MailGenders): Parts {
  const actor = { context: actorContext({ gender: g.actor }) };
  const reader = { context: actorContext({ gender: g.reader }) };
  switch (kind) {
    case 'invite': {
      const d = data as MailData['invite'];
      return {
        subject: t('mail.invite.subject', { ...actor, actor: d.inviterName }),
        greeting: t('mail.common.greeting', { name: d.name }),
        paragraphs: [t('mail.invite.added', { ...actor, actor: d.inviterName }), t('mail.invite.setPassword', reader), t('mail.invite.expired', reader)],
        button: t('mail.invite.button'),
        footer: 'footerAuto',
      };
    }
    case 'reset': {
      const d = data as MailData['reset'];
      return {
        subject: t('mail.reset.subject'),
        greeting: t('mail.common.greeting', { name: d.name }),
        paragraphs: [t('mail.reset.asked'), t('mail.reset.choose', reader), t('mail.reset.ignore', reader)],
        button: t('mail.reset.button'),
        footer: 'footerAuto',
      };
    }
    case 'notice': {
      const d = data as MailData['notice'];
      const subject = t(`mail.notice.subject.${d.trigger}`);
      return { subject, paragraphs: [`${subject}.`, t('mail.notice.details', reader)], button: t('mail.common.open'), footer: 'footerNotice' };
    }
    case 'summary': {
      const d = data as MailData['summary'];
      // A row: the title, then the project key (or Office) and the due day. The middle dot is no word, so it has no key.
      const rows = (lines: SummaryLine[]) => lines.map((line) => ({ title: line.title, meta: `${line.where ?? t('mail.summary.office')} \u00b7 ${formatDay(line.due, lang, 'withWeekday')}` }));
      const groups: MailGroup[] = [
        { heading: t('mail.summary.pastDue'), rows: rows(d.pastDue) },
        { heading: t('mail.summary.today'), rows: rows(d.today) },
        { heading: t('mail.summary.week'), rows: rows(d.week) },
      ].filter((group) => group.rows.length > 0);
      const closing = [
        ...(d.more > 0 ? [t('mail.summary.more', { count: d.more })] : []),
        ...(d.reviewsWaiting > 0 ? [t('mail.summary.reviewsWaiting', { count: d.reviewsWaiting })] : []),
      ];
      return { subject: t('mail.summary.subject'), paragraphs: [t('mail.summary.intro')], groups, closing, button: t('mail.common.open'), footer: 'footerSummary' };
    }
    case 'quotaWarning': {
      const d = data as MailData['quotaWarning'];
      return {
        subject: t('mail.quota.subject'),
        paragraphs: [t('mail.quota.stopped', { limit: d.limit }), t('mail.quota.stayInApp'), t('mail.quota.signinStill'), t('mail.quota.noAction')],
        button: t('mail.common.open'),
        footer: 'footerAuto',
      };
    }
    default:
      throw new Error(`No mail template for ${String(kind)}.`);
  }
}

export function renderMail<K extends MailTemplate>(kind: K, lang: Language, data: MailData[K], g: MailGenders = {}, o: MailOptions = {}): RenderedMail {
  const t = mailWords(lang);
  const reader = { context: actorContext({ gender: g.reader }) };
  const parts = partsOf(kind, lang, data, t, g);
  return renderPage(
    {
      lang,
      subject: parts.subject,
      greeting: parts.greeting,
      paragraphs: parts.paragraphs,
      groups: parts.groups,
      closing: parts.closing,
      button: { label: parts.button, link: data.link },
      linkHelp: t('mail.common.linkHelp', reader),
      footer: t(`mail.common.${parts.footer}`, reader),
      logo: o.appUrl ? logoAddress(o.appUrl) : undefined,
    },
    t('mail.common.brand'),
  );
}
