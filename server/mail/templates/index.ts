import type { EmailTrigger, Gender, Language } from '../../../src/api/contract/entities';
import { actorContext } from '../../../src/lib/grammar';
import { logoAddress, renderPage, type RenderedMail } from './layout';
import { mailWords } from './words';

export type { RenderedMail } from './layout';

/**
 * The mail templates (plan 5.4; task N2.1): one for each kind, in the person's language, Arabic right to left with the female forms.
 * Notice and summary mails carry no client data (plan 2, change 22; section 10, decision 8): Resend keeps mail content in the US,
 * so they say what happened in general words, give a count and a link, and never a task title, a project name or comment text.
 * A template reads only the fields of its data type, so extra fields that a caller passes never reach the mail.
 */

export const MAIL_TEMPLATES = ['invite', 'reset', 'notice', 'summary', 'limitWarning', 'quotaWarning'] as const;
export type MailTemplate = (typeof MAIL_TEMPLATES)[number];

/** The usage meters of the 80% warning (plan 5.8). filesR2: file storage after the move to R2 (section 10, decision 2). */
export const USAGE_METERS = ['calls', 'database', 'files', 'filesR2', 'backup', 'emailsToday', 'emailsMonth', 'egress'] as const;
export type UsageMeter = (typeof USAGE_METERS)[number];

export type MailData = {
  /** name: the new person; inviterName: the Admin who invited them. */
  invite: { name: string; inviterName: string; link: string };
  reset: { name: string; link: string };
  /** Only a trigger that sends email: the notices of requests and bugs have no mail words (owner, 2026-10-07). */
  notice: { trigger: EmailTrigger; link: string };
  summary: { dueToday: number; reviewsWaiting: number; link: string };
  limitWarning: { meter: UsageMeter; percent: number; link: string };
  /** limit: the daily notice limit that stopped the mail (90). */
  quotaWarning: { limit: number; link: string };
};

/** actor: the person who did the thing (the inviter); reader: the person who gets the mail. */
export type MailGenders = { actor?: Gender; reader?: Gender };

/** appUrl: the screens (APP_URL of the server config), for the Madar mark in the header. Without it the header shows the name only. */
export type MailOptions = { appUrl?: string };

type Parts = { subject: string; greeting?: string; paragraphs: string[]; button: string; footer: 'footerNotice' | 'footerSummary' | 'footerAuto' };

function partsOf<K extends MailTemplate>(kind: K, data: MailData[K], t: ReturnType<typeof mailWords>, g: MailGenders): Parts {
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
      const lines = [
        ...(d.dueToday > 0 ? [t('mail.summary.dueToday', { count: d.dueToday })] : []),
        ...(d.reviewsWaiting > 0 ? [t('mail.summary.reviewsWaiting', { count: d.reviewsWaiting })] : []),
      ];
      return { subject: t('mail.summary.subject'), paragraphs: [t('mail.summary.intro'), ...lines], button: t('mail.common.open'), footer: 'footerSummary' };
    }
    case 'limitWarning': {
      const d = data as MailData['limitWarning'];
      return {
        subject: t('mail.limit.subject'),
        paragraphs: [t('mail.limit.line', { meter: t(`mail.limit.meter.${d.meter}`), percent: Math.round(d.percent) }), t(`mail.limit.next.${d.meter}`)],
        button: t('mail.common.open'),
        footer: 'footerAuto',
      };
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
  const parts = partsOf(kind, data, t, g);
  return renderPage(
    {
      lang,
      subject: parts.subject,
      greeting: parts.greeting,
      paragraphs: parts.paragraphs,
      button: { label: parts.button, link: data.link },
      linkHelp: t('mail.common.linkHelp', reader),
      footer: t(`mail.common.${parts.footer}`, reader),
      logo: o.appUrl ? logoAddress(o.appUrl) : undefined,
    },
    t('mail.common.brand'),
  );
}
