import { describe, expect, it } from 'vitest';
import { TRIGGERS, type Gender, type Language } from '../../../src/api/contract/entities';
import { MAIL_TEMPLATES, USAGE_METERS, renderMail, type MailData, type MailTemplate } from './index';

/**
 * The mail templates (plan 5.4, change 22; task N2.1): snapshots in both languages, Arabic right to left with the female forms,
 * and no client data in a notice or a summary.
 */

const LINK = 'https://madar.example/tasks/tsk_001?from=mail';

const SAMPLES: { [K in MailTemplate]: MailData[K] } = {
  invite: { name: 'Sara', inviterName: 'Huda', link: 'https://madar.example/welcome?token_hash=abc&type=invite' },
  reset: { name: 'Sara', link: 'https://madar.example/reset?token_hash=abc&type=recovery' },
  notice: { trigger: 'task_assigned', link: LINK },
  summary: { dueToday: 3, reviewsWaiting: 1, link: 'https://madar.example/' },
  limitWarning: { meter: 'files', percent: 85, link: 'https://madar.example/admin' },
  quotaWarning: { limit: 90, link: 'https://madar.example/admin' },
};

const FEMALE = { actor: 'female', reader: 'female' } as const;
const MALE = { actor: 'male', reader: 'male' } as const;

function allOutput(m: { subject: string; html: string; text: string }): string {
  return `${m.subject}\n${m.html}\n${m.text}`;
}

describe('renderMail', () => {
  it('has one template for each mail kind', () => {
    expect([...MAIL_TEMPLATES].sort()).toEqual(['invite', 'limitWarning', 'notice', 'quotaWarning', 'reset', 'summary']);
  });

  for (const kind of MAIL_TEMPLATES) {
    it(`renders ${kind} in English, and in Arabic with a female actor and reader`, () => {
      expect(renderMail(kind, 'en', SAMPLES[kind] as never)).toMatchSnapshot();
      expect(renderMail(kind, 'ar', SAMPLES[kind] as never, FEMALE)).toMatchSnapshot();
    });
  }

  it('renders each notice trigger with its own subject in both languages', () => {
    for (const lang of ['en', 'ar'] as Language[]) {
      const subjects = TRIGGERS.map((trigger) => renderMail('notice', lang, { trigger, link: LINK }).subject);
      expect(new Set(subjects).size).toBe(TRIGGERS.length);
      expect(Object.fromEntries(TRIGGERS.map((trigger, i) => [trigger, subjects[i]]))).toMatchSnapshot(`notice subjects ${lang}`);
    }
  });

  it('sets the language and the direction: Arabic is right to left, English left to right', () => {
    const arabic = renderMail('notice', 'ar', SAMPLES.notice).html;
    expect(arabic).toMatch(/<html lang="ar" dir="rtl">/);
    expect(arabic).toContain('text-align:right');
    const english = renderMail('notice', 'en', SAMPLES.notice).html;
    expect(english).toMatch(/<html lang="en" dir="ltr">/);
    expect(english).toContain('text-align:left');
  });

  it('uses the female Arabic forms for a female actor and a female reader, and the base forms otherwise', () => {
    const female = renderMail('invite', 'ar', SAMPLES.invite, FEMALE);
    const male = renderMail('invite', 'ar', SAMPLES.invite, MALE);
    const none = renderMail('invite', 'ar', SAMPLES.invite);
    expect(female.subject).toContain('دعتك');
    expect(male.subject).toContain('دعاك');
    expect(female.text).toContain('عيّني');
    expect(male.text).toContain('عيّن ');
    expect(none).toEqual(male);
    // A notice speaks to the reader only.
    expect(renderMail('notice', 'ar', SAMPLES.notice, { reader: 'female' }).text).toContain('افتحي');
    expect(renderMail('notice', 'ar', SAMPLES.notice, { reader: 'male' }).text).toContain('افتح ');
  });

  it('never puts client data in a notice or a summary: no task title, project name or comment text from its data', () => {
    const secret = { title: 'Villa Al Rashid facade', projectName: 'Rashid Tower', commentText: 'The client wants marble', actorName: 'Huda Saleh' };
    for (const lang of ['en', 'ar'] as Language[]) {
      for (const g of [{}, FEMALE] as { actor?: Gender; reader?: Gender }[]) {
        for (const trigger of TRIGGERS) {
          const out = allOutput(renderMail('notice', lang, { ...secret, trigger, link: LINK } as MailData['notice'], g));
          for (const value of Object.values(secret)) expect(out).not.toContain(value);
        }
        const summary = allOutput(renderMail('summary', lang, { ...secret, dueToday: 2, reviewsWaiting: 2, link: LINK } as MailData['summary'], g));
        for (const value of Object.values(secret)) expect(summary).not.toContain(value);
      }
    }
  });

  it('gives the link in the button and in the text part, escaped in the HTML', () => {
    const m = renderMail('notice', 'en', SAMPLES.notice);
    expect(m.html).toContain('href="https://madar.example/tasks/tsk_001?from=mail"');
    expect(m.text).toContain(LINK);
    const invite = renderMail('invite', 'en', SAMPLES.invite);
    expect(invite.html).toContain('href="https://madar.example/welcome?token_hash=abc&amp;type=invite"');
    expect(invite.text).toContain('https://madar.example/welcome?token_hash=abc&type=invite');
  });

  it('escapes the names in the HTML, and keeps them plain in the text and the subject', () => {
    const m = renderMail('invite', 'en', { ...SAMPLES.invite, name: '<b>Sara</b>', inviterName: 'Huda & "Co"' });
    expect(m.html).toContain('&lt;b&gt;Sara&lt;/b&gt;');
    expect(m.html).toContain('Huda &amp; &quot;Co&quot;');
    expect(m.html).not.toContain('<b>Sara</b>');
    expect(m.subject).toBe('Huda & "Co" invited you to Madar');
    expect(m.text).toContain('<b>Sara</b>');
  });

  it('refuses a link that is not http or https', () => {
    expect(() => renderMail('notice', 'en', { trigger: 'mention', link: 'javascript:alert(1)' })).toThrow(/link/);
    expect(() => renderMail('reset', 'en', { name: 'Sara', link: 'not a url' })).toThrow(/link/);
  });

  it('leaves out a summary line whose count is zero, and inflects the Arabic counts', () => {
    const onlyReviews = renderMail('summary', 'en', { dueToday: 0, reviewsWaiting: 2, link: LINK });
    expect(onlyReviews.text).toContain('2 reviews wait for you.');
    expect(onlyReviews.text).not.toMatch(/due today/);
    expect(renderMail('summary', 'en', { dueToday: 1, reviewsWaiting: 0, link: LINK }).text).toContain('1 task is due today.');
    const counts = [1, 2, 3, 11].map((n) => renderMail('summary', 'ar', { dueToday: n, reviewsWaiting: 0, link: LINK }).text.split('\n').find((l) => l.includes('موعد'))!);
    expect(counts).toEqual(['مهمة واحدة موعدها اليوم.', 'مهمتان موعدهما اليوم.', '3 مهام موعدها اليوم.', '11 مهمة موعدها اليوم.']);
  });

  it('names the meter and its one next step in a limit warning, for every meter', () => {
    for (const lang of ['en', 'ar'] as Language[]) {
      const steps = USAGE_METERS.map((meter) => renderMail('limitWarning', lang, { meter, percent: 80, link: LINK }).text);
      expect(new Set(steps).size).toBe(USAGE_METERS.length);
      for (const text of steps) expect(text).toContain('80%');
    }
    expect(renderMail('limitWarning', 'en', SAMPLES.limitWarning).text).toContain('move the files to Cloudflare R2, or remove old file versions');
  });

  it('writes no em dash and no empty line of words in any mail, and only Arabic words in an Arabic mail', () => {
    for (const kind of MAIL_TEMPLATES) {
      for (const lang of ['en', 'ar'] as Language[]) {
        const m = renderMail(kind, lang, SAMPLES[kind] as never, FEMALE);
        expect(allOutput(m)).not.toContain('—');
        expect(m.text).not.toMatch(/undefined|\{\{|(^|\s)mail\.\w/);
        if (lang === 'ar') {
          // Latin letters may appear only in the link, the names of the sample, the CSS and the HTML tags.
          const words = m.text.replace(/https?:\/\/\S+/g, '').replace(/Sara|Huda/g, '');
          expect({ kind, latin: words.match(/[A-Za-z]+/g) }).toEqual({ kind, latin: null });
        }
      }
    }
  });
});
