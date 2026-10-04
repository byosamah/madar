import type { Language } from '../../../src/api/contract/entities';

/**
 * The one page of every Madar mail (plan 5.4): a white page, one title line, short paragraphs, one button, the plain link under
 * it, and a small footer. Mail clients ignore most CSS, so the styles are inline and the direction is set on the html element
 * and on the content block, with text-align from the direction (Gmail does not read start and end).
 */

export type MailPage = {
  lang: Language;
  subject: string;
  /** "Hello Sara," or nothing. */
  greeting?: string;
  paragraphs: string[];
  button: { label: string; link: string };
  linkHelp: string;
  footer: string;
};

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
    p(brand, 'font-weight:600;font-size:18px;margin-bottom:24px;'),
    ...(page.greeting ? [p(page.greeting)] : []),
    ...page.paragraphs.map((text) => p(text)),
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
    `${page.button.label}: ${link}`,
    '',
    page.footer,
    '',
  ].join('\n');
  return { subject: page.subject, html, text };
}
