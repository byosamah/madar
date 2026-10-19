import type { Language } from '../../../src/api/contract/entities';

/**
 * The one page of every Madar mail (plan 5.4): a white page, one title line, short paragraphs, one button, the plain link under
 * it, and a small footer. Mail clients ignore most CSS, so the styles are inline and the direction is set on the html element
 * and on the content block, with text-align from the direction (Gmail does not read start and end).
 */

/** A list of rows under a small heading (the morning summary). A row is a title and one small line under it. */
export type MailGroup = { heading: string; rows: { title: string; meta: string }[] };

export type MailPage = {
  lang: Language;
  subject: string;
  /** "Hello Sara," or nothing. */
  greeting?: string;
  paragraphs: string[];
  /** Lists of rows after the paragraphs. Nothing renders for a missing or empty list. */
  groups?: MailGroup[];
  /** Short paragraphs after the lists and before the button. */
  closing?: string[];
  button: { label: string; link: string };
  linkHelp: string;
  footer: string;
  /** The absolute address of the Madar mark picture for the header. Without it the header shows the name only. */
  logo?: string;
};

/**
 * The Madar mark of the mail header (TASKS.md, Logo): the 192 px PNG of the screens build (public/icons, made by
 * scripts/icons/make-icons.tsx), at the app address. Email programs often block SVG and data: pictures, so it is a PNG link.
 */
export const MAIL_LOGO_PATH = 'icons/madar-192.png';

/** The address of the mark under the app address (APP_URL), which may end with a path or a slash. */
export function logoAddress(appUrl: string): string {
  return checkLink(`${appUrl.replace(/\/+$/, '')}/${MAIL_LOGO_PATH}`);
}

export type RenderedMail = { subject: string; html: string; text: string };

const INK = '#1c1b19';
const MUTED = '#5f5c55';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, Arial, sans-serif";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Only an absolute http or https link goes into a mail. */
export function checkLink(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error('A mail link must be an absolute http or https URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('A mail link must be an absolute http or https URL.');
  return link;
}

/** The mark and the name in one row. A table, because mail programs do not read flex; the cells follow the direction. */
function header(logo: string, brand: string, dir: 'ltr' | 'rtl'): string {
  const gap = dir === 'rtl' ? 'padding-left:10px;' : 'padding-right:10px;';
  const name = escapeHtml(brand);
  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 24px;">',
    `<tr><td style="padding:0;${gap}vertical-align:middle;"><img src="${escapeHtml(logo)}" width="28" height="28" alt="" style="display:block;border:0;outline:none;width:28px;height:28px;"></td>`,
    `<td style="padding:0;vertical-align:middle;font-weight:600;font-size:18px;">${name}</td></tr>`,
    '</table>',
  ].join('');
}

/**
 * The top of every Madar mail: the mark and the name, or the name only when no picture address is known (logo undefined). The
 * sign-in mails of server/auth/mail.ts use it too, so every mail has the same header.
 */
export function brandHeader(brand: string, dir: 'ltr' | 'rtl', logo?: string): string {
  return logo ? header(logo, brand, dir) : `<p style="margin:0 0 16px;font-weight:600;font-size:18px;margin-bottom:24px;">${escapeHtml(brand)}</p>`;
}

export function renderPage(page: MailPage, brand: string): RenderedMail {
  const link = checkLink(page.button.link);
  const dir = page.lang === 'ar' ? 'rtl' : 'ltr';
  const align = dir === 'rtl' ? 'right' : 'left';
  const p = (text: string, style = '') => `<p style="margin:0 0 16px;${style}">${escapeHtml(text)}</p>`;
  const html = [
    '<!doctype html>',
    `<html lang="${page.lang}" dir="${dir}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(page.subject)}</title></head>`,
    `<body style="margin:0;padding:0;background:#ffffff;color:${INK};">`,
    `<div dir="${dir}" style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:${FONT};font-size:16px;line-height:1.6;text-align:${align};">`,
    brandHeader(brand, dir, page.logo),
    ...(page.greeting ? [p(page.greeting)] : []),
    ...page.paragraphs.map((text) => p(text)),
    ...(page.groups ?? []).flatMap((group) => [
      `<p style="margin:20px 0 10px;font-size:14px;font-weight:600;color:${MUTED};border-top:1px solid #e6e3dc;padding-top:12px;">${escapeHtml(group.heading)}</p>`,
      // The title sits in a bdi, so a title in another script keeps its own direction and does not bend the line around it.
      ...group.rows.map((row) => `<p style="margin:0 0 12px;"><bdi dir="auto">${escapeHtml(row.title)}</bdi><br><span style="font-size:14px;color:${MUTED};">${escapeHtml(row.meta)}</span></p>`),
    ]),
    ...(page.closing ?? []).map((text) => p(text)),
    `<p style="margin:24px 0;"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:${INK};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${escapeHtml(page.button.label)}</a></p>`,
    p(page.linkHelp, `font-size:14px;color:${MUTED};margin-bottom:4px;`),
    `<p style="margin:0 0 24px;font-size:14px;word-break:break-all;" dir="ltr"><a href="${escapeHtml(link)}" style="color:${INK};">${escapeHtml(link)}</a></p>`,
    p(page.footer, `font-size:13px;color:${MUTED};border-top:1px solid #e6e3dc;padding-top:16px;`),
    '</div>',
    '</body>',
    '</html>',
  ].join('\n');
  const text = [
    ...(page.greeting ? [page.greeting, ''] : []),
    ...page.paragraphs.flatMap((paragraph) => [paragraph, '']),
    ...(page.groups ?? []).flatMap((group) => [group.heading, ...group.rows.flatMap((row) => [`- ${row.title}`, `  ${row.meta}`]), '']),
    ...(page.closing ?? []).flatMap((paragraph) => [paragraph, '']),
    `${page.button.label}: ${link}`,
    '',
    page.footer,
    '',
  ].join('\n');
  return { subject: page.subject, html, text };
}
