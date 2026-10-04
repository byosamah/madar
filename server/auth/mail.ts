import type { Gender, Language } from '../../src/api/contract/entities';
import ar from '../../src/i18n/real/p.ar.json';
import en from '../../src/i18n/real/p.en.json';
import sAr from '../../src/i18n/real/s.ar.json';
import sEn from '../../src/i18n/real/s.en.json';

/**
 * The sign-in mail of Madar (plan 5.1, change 8): the invitation, the reset link, and the notice at the old email after an
 * email change (renderEmailChangedMail, with no link), in the person's language, with the
 * feminine Arabic forms for a woman (the "_female" keys, as actorContext() picks them on the screens). The words live in
 * src/i18n/real/p.{en,ar}.json, so the word tests check them like every screen text. The server imports those two files and not
 * src/i18n/trees.ts, whose import.meta.glob works only in a Vite build (server/workerGraph.test.ts). Track S adds the line that
 * names who changed the email (src/i18n/real/s.{en,ar}.json, task S1); the loader merges it into the same signinMail.emailChanged.
 *
 * Track N2 builds renderMail for every mail kind (plan 5.4). When it merges, it can take these two kinds over; until then, the
 * effects of track P use this module. The mail holds no client data: only the person's own name and the link.
 */

export type SigninMailKind = 'invite' | 'reset';
export type RenderedMail = { subject: string; html: string; text: string };
type Words = Record<string, string>;

type MailWordsKind = SigninMailKind | 'emailChanged';

function wordsOf(lang: Language, kind: MailWordsKind): Words & { linkHint: string; linkHint_female?: string } {
  const tree = (lang === 'ar' ? ar : en) as unknown as { signinMail: Record<MailWordsKind, Words> & { linkHint: string; linkHint_female?: string } };
  const more = (lang === 'ar' ? sAr : sEn) as unknown as { signinMail: Partial<Record<MailWordsKind, Words>> };
  return {
    ...tree.signinMail[kind],
    ...more.signinMail[kind],
    linkHint: tree.signinMail.linkHint,
    ...(tree.signinMail.linkHint_female ? { linkHint_female: tree.signinMail.linkHint_female } : {}),
  };
}

function pick(words: Words, key: string, reader: Gender | undefined): string {
  const female = reader === 'female' ? words[`${key}_female`] : undefined;
  const text = female ?? words[key];
  if (text === undefined) throw new Error(`The sign-in mail has no text for ${key}.`);
  return text;
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (all, name: string) => values[name] ?? all);
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The link of a sign-in mail. The screen sends "type" to verifyOtp, so it must be the type of the link that Auth made. */
export function signinLink(appUrl: string, screen: 'welcome' | 'reset', tokenHash: string, type: 'invite' | 'recovery'): string {
  const query = new URLSearchParams({ token_hash: tokenHash, type });
  return `${appUrl.replace(/\/+$/, '')}/${screen}?${query.toString()}`;
}

function page(lang: Language, parts: string[]): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const align = lang === 'ar' ? 'right' : 'left';
  return [
    '<!doctype html>',
    `<html lang="${lang}" dir="${dir}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    `<body style="margin:0;padding:24px;background:#ffffff;color:#1d1d1f;font-family:-apple-system,'Segoe UI',Tahoma,Arial,sans-serif;text-align:${align}">`,
    ...parts,
    '</body></html>',
  ].join('\n');
}

/**
 * The notice at the OLD email after the sign-in email of a person who accepted changed. It holds no link: it names the new
 * email and who made the change (by, when known), and asks the person to tell the Admin when they did not expect it.
 */
export function renderEmailChangedMail(lang: Language, data: { name: string; email: string; by?: string }, reader?: Gender): RenderedMail {
  const words = wordsOf(lang, 'emailChanged');
  const subject = pick(words, 'subject', reader);
  const title = fill(pick(words, 'title', reader), { name: data.name });
  const body = fill(pick(words, 'body', reader), { email: data.email });
  const by = data.by ? fill(pick(words, 'by', reader), { actor: data.by }) : undefined;
  const note = pick(words, 'note', reader);
  const text = [title, '', body, ...(by ? ['', by] : []), '', note].join('\n');
  const html = page(lang, [
    `<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>`,
    `<p style="font-size:15px;line-height:1.5;margin:0 0 24px">${escapeHtml(body)}</p>`,
    ...(by ? [`<p style="font-size:15px;line-height:1.5;margin:0 0 24px">${escapeHtml(by)}</p>`] : []),
    `<p style="font-size:13px;line-height:1.5;color:#6e6e73;margin:0">${escapeHtml(note)}</p>`,
  ]);
  return { subject, html, text };
}

export function renderSigninMail(kind: SigninMailKind, lang: Language, data: { name: string; link: string }, reader?: Gender): RenderedMail {
  const words = wordsOf(lang, kind);
  const values = { name: data.name };
  const subject = pick(words, 'subject', reader);
  const title = fill(pick(words, 'title', reader), values);
  const body = pick(words, 'body', reader);
  const button = pick(words, 'button', reader);
  const note = pick(words, 'note', reader);
  const hint = pick(words, 'linkHint', reader);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const align = lang === 'ar' ? 'right' : 'left';
  const link = escapeHtml(data.link);

  const text = [title, '', body, '', `${button}: ${data.link}`, '', note].join('\n');
  const html = [
    '<!doctype html>',
    `<html lang="${lang}" dir="${dir}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    `<body style="margin:0;padding:24px;background:#ffffff;color:#1d1d1f;font-family:-apple-system,'Segoe UI',Tahoma,Arial,sans-serif;text-align:${align}">`,
    `<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>`,
    `<p style="font-size:15px;line-height:1.5;margin:0 0 24px">${escapeHtml(body)}</p>`,
    `<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#1d1d1f;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(button)}</a></p>`,
    `<p style="font-size:13px;line-height:1.5;color:#6e6e73;margin:0 0 8px">${escapeHtml(hint)}</p>`,
    `<p dir="ltr" style="font-size:13px;line-height:1.5;color:#6e6e73;margin:0 0 24px;word-break:break-all">${link}</p>`,
    `<p style="font-size:13px;line-height:1.5;color:#6e6e73;margin:0">${escapeHtml(note)}</p>`,
    '</body></html>',
  ].join('\n');
  return { subject, html, text };
}
