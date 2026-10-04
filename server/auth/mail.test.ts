import { describe, expect, it } from 'vitest';
import { renderSigninMail, signinLink } from './mail';

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
        expect(`${mail.subject}${mail.text}${mail.html}`).not.toContain('—');
      }
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
