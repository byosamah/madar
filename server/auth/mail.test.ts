import { describe, expect, it } from 'vitest';
import { brandHeader, logoAddress } from '../mail/templates/layout';
import { renderEmailChangedMail, renderSigninMail, signinLink } from './mail';

const LINK = 'https://madar.test/welcome?token_hash=abc&type=invite';

describe('renderSigninMail: the invitation and reset mail in the person\'s language (plan 5.1, change 8)', () => {
  it('writes the English invitation with the name, the link and a plain text form', () => {
    const mail = renderSigninMail('invite', 'en', { name: 'Sara', link: LINK });
    expect(mail.subject).toBe('Your invitation to Madar');
    expect(mail.text).toContain('Welcome to Madar, Sara');
    expect(mail.text).toContain(LINK);
    expect(mail.html).toContain('<html lang="en" dir="ltr">');
    expect(mail.html).toContain('href="https://madar.test/welcome?token_hash=abc&amp;type=invite"');
    expect(mail.html).toContain('Accept the invitation');
  });

  it('writes the Arabic invitation right to left, with the feminine forms for a woman', () => {
    const man = renderSigninMail('invite', 'ar', { name: 'خالد', link: LINK }, 'male');
    const woman = renderSigninMail('invite', 'ar', { name: 'سارة', link: LINK }, 'female');
    expect(man.html).toContain('<html lang="ar" dir="rtl">');
    expect(man.subject).toBe('دعوتك إلى مدار');
    expect(man.text).toContain('افتح الرابط');
    expect(woman.text).toContain('افتحي الرابط');
    expect(woman.text).toContain('أهلًا سارة، مرحبًا بكِ في مدار');
    // A person with no gender reads the masculine form, as in the rest of the app.
    expect(renderSigninMail('invite', 'ar', { name: 'خالد', link: LINK }).text).toBe(man.text);
  });

  it('writes the reset mail in both languages', () => {
    const en = renderSigninMail('reset', 'en', { name: 'Sara', link: LINK });
    expect(en.subject).toBe('Reset your Madar password');
    expect(en.text).toContain('If you did not ask for this, ignore this email.');
    const ar = renderSigninMail('reset', 'ar', { name: 'سارة', link: LINK }, 'female');
    expect(ar.subject).toBe('إعادة تعيين كلمة المرور في مدار');
    expect(ar.text).toContain('إذا لم تطلبي ذلك');
  });

  it('escapes the name in the HTML, so a name never adds markup', () => {
    const mail = renderSigninMail('invite', 'en', { name: '<b>Sara</b> & "Co"', link: LINK });
    expect(mail.html).not.toContain('<b>Sara</b>');
    expect(mail.html).toContain('&lt;b&gt;Sara&lt;/b&gt; &amp; &quot;Co&quot;');
    expect(mail.text).toContain('<b>Sara</b> & "Co"');
  });

  it('has no em dash in any output', () => {
    for (const kind of ['invite', 'reset'] as const) {
      for (const lang of ['en', 'ar'] as const) {
        const mail = renderSigninMail(kind, lang, { name: 'N', link: LINK }, 'female');
        expect(`${mail.subject}${mail.text}${mail.html}`).not.toContain(String.fromCharCode(0x2014));
      }
    }
  });
});

describe('the header of the invitation and the reset mail: the Madar mark of the N2 templates (wave 6, V)', () => {
  const APP = 'https://madar.test';
  const KINDS = ['invite', 'reset'] as const;
  const LANGS = ['en', 'ar'] as const;
  const headerOf = (html: string) => html.slice(html.indexOf('<body'), html.indexOf('<h1'));

  it('shows the 192 px mark at the app address with the name, before the title, in both languages, as the N2 header does', () => {
    for (const kind of KINDS) {
      for (const lang of LANGS) {
        const html = renderSigninMail(kind, lang, { name: 'N', link: LINK }, undefined, { appUrl: APP }).html;
        // The same header as the N2 templates, from the same function, and the empty alt for the same reason: the name sits in the next cell.
        expect(headerOf(html)).toContain(brandHeader(lang === 'ar' ? 'مدار' : 'Madar', lang === 'ar' ? 'rtl' : 'ltr', logoAddress(APP)));
        expect(headerOf(html)).toContain('<img src="https://madar.test/icons/madar-192.png" width="28" height="28" alt=""');
        expect(headerOf(html)).toMatch(lang === 'ar' ? />مدار<\/td>/ : />Madar<\/td>/);
        expect(html).not.toMatch(/<svg|data:|\.svg/);
      }
    }
  });

  it('takes the app address with a path and a slash at the end too', () => {
    const html = renderSigninMail('invite', 'en', { name: 'N', link: LINK }, undefined, { appUrl: 'https://office.example/madar/' }).html;
    expect(html).toContain('src="https://office.example/madar/icons/madar-192.png"');
  });

  it('shows the name only when no app address is known', () => {
    for (const kind of KINDS) {
      for (const lang of LANGS) {
        const html = renderSigninMail(kind, lang, { name: 'N', link: LINK }).html;
        expect(html).not.toContain('<img');
        expect(headerOf(html)).toContain(lang === 'ar' ? '>مدار</p>' : '>Madar</p>');
      }
    }
  });

  it('holds the direction and the alignment in a div inside the body, because Gmail drops the html and body tags with their attributes', () => {
    const bodyOf = (html: string) => html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.indexOf('</body>')).trim();
    for (const lang of LANGS) {
      const dir = lang === 'ar' ? 'rtl' : 'ltr';
      const align = lang === 'ar' ? 'right' : 'left';
      const mails = [
        ...KINDS.map((kind) => renderSigninMail(kind, lang, { name: 'N', link: LINK }, undefined, { appUrl: APP }).html),
        ...KINDS.map((kind) => renderSigninMail(kind, lang, { name: 'N', link: LINK }).html),
        renderEmailChangedMail(lang, { name: 'N', email: 'e@madar.test' }).html,
      ];
      for (const html of mails) {
        const inner = bodyOf(html);
        expect(inner.startsWith(`<div dir="${dir}" style="text-align:${align}">`)).toBe(true);
        expect(inner.endsWith('</div>')).toBe(true);
      }
    }
  });

  it('keeps the words, the link and the text part as they were', () => {
    for (const kind of KINDS) {
      for (const lang of LANGS) {
        const plain = renderSigninMail(kind, lang, { name: 'N', link: LINK }, 'female');
        const marked = renderSigninMail(kind, lang, { name: 'N', link: LINK }, 'female', { appUrl: APP });
        expect([marked.subject, marked.text]).toEqual([plain.subject, plain.text]);
        expect(marked.html.slice(marked.html.indexOf('<h1'))).toBe(plain.html.slice(plain.html.indexOf('<h1')));
      }
    }
  });

  it('matches the snapshot of each mail, in English and in Arabic for a woman', () => {
    for (const kind of KINDS) {
      expect(renderSigninMail(kind, 'en', { name: 'Sara', link: LINK }, undefined, { appUrl: APP })).toMatchSnapshot(`${kind} en`);
      expect(renderSigninMail(kind, 'ar', { name: 'سارة', link: LINK }, 'female', { appUrl: APP })).toMatchSnapshot(`${kind} ar`);
    }
  });
});

describe('renderEmailChangedMail: the notice at the old email after an email change', () => {
  it('names the new email, holds no link, and tells the person to tell the Admin, in both languages', () => {
    const en = renderEmailChangedMail('en', { name: 'Sara', email: 'sara.new@madar.test' });
    expect(en.subject).toBe('Your Madar sign-in email changed');
    expect(en.text).toContain('Hello Sara');
    expect(en.text).toContain('sara.new@madar.test');
    expect(en.text).toContain('tell the Admin');
    expect(`${en.text}${en.html}`).not.toMatch(/href=|https?:/);
    const ar = renderEmailChangedMail('ar', { name: 'سارة', email: 'sara.new@madar.test' }, 'female');
    expect(ar.subject).toBe('تغيّر بريد تسجيل الدخول إلى مدار');
    expect(ar.text).toContain('أخبري مدير النظام');
    expect(ar.html).toContain('<html lang="ar" dir="rtl">');
    expect(renderEmailChangedMail('ar', { name: 'خالد', email: 'k@madar.test' }).text).toContain('أخبر مدير النظام');
  });

  it('names who made the change (S1) in both languages, and leaves the line out when nobody is known', () => {
    const en = renderEmailChangedMail('en', { name: 'Sara', email: 'sara.new@madar.test', by: 'Faisal Al Harbi' });
    expect(en.text).toContain('The change came from Faisal Al Harbi.');
    expect(en.html).toContain('The change came from Faisal Al Harbi.');
    expect(en.text.indexOf('Faisal')).toBeLessThan(en.text.indexOf('tell the Admin'));
    const ar = renderEmailChangedMail('ar', { name: 'سارة', email: 'sara.new@madar.test', by: 'فيصل الحربي' }, 'female');
    expect(ar.text).toContain('جاء التغيير من فيصل الحربي.');
    expect(renderEmailChangedMail('en', { name: 'Sara', email: 'sara.new@madar.test' }).text).not.toContain('came from');
    expect(renderEmailChangedMail('en', { name: 'S', email: 'e@madar.test', by: '<b>X</b>' }).html).toContain('&lt;b&gt;X&lt;/b&gt;');
  });

  it('escapes the name and the email in the HTML, and has no em dash', () => {
    const mail = renderEmailChangedMail('en', { name: '<i>S</i>', email: 'a&b@madar.test' });
    expect(mail.html).toContain('&lt;i&gt;S&lt;/i&gt;');
    expect(mail.html).toContain('a&amp;b@madar.test');
    for (const lang of ['en', 'ar'] as const) {
      const out = renderEmailChangedMail(lang, { name: 'N', email: 'e@madar.test' }, 'female');
      expect(`${out.subject}${out.text}${out.html}`).not.toContain(String.fromCharCode(0x2014));
    }
  });
});

describe('signinLink', () => {
  it('points at Welcome for an invitation and at Reset for a reset, with the link type that the screen sends to verifyOtp', () => {
    expect(signinLink('https://madar.test/', 'welcome', 'h a/sh', 'invite')).toBe('https://madar.test/welcome?token_hash=h+a%2Fsh&type=invite');
    expect(signinLink('https://madar.test', 'welcome', 'h', 'recovery')).toBe('https://madar.test/welcome?token_hash=h&type=recovery');
    expect(signinLink('https://madar.test', 'reset', 'h', 'recovery')).toBe('https://madar.test/reset?token_hash=h&type=recovery');
  });
});
