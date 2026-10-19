import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EMAIL_TRIGGERS, type Gender, type Language } from '../../../src/api/contract/entities';
import { MAIL_LOGO_PATH } from './layout';
import { MAIL_TEMPLATES, USAGE_METERS, renderMail, type MailData, type MailTemplate } from './index';

/**
 * The mail templates (plan 5.4, change 22; task N2.1): snapshots in both languages, Arabic right to left with the female forms,
 * and no client data in a notice. The morning summary lists the open tasks of the person (fbk_021, owner 2026-10-19): the titles
 * and the project keys it is given, and nothing else.
 */

const LINK = 'https://madar.example/tasks/tsk_001?from=mail';
const APP_URL = 'https://madar.example';

const SAMPLES: { [K in MailTemplate]: MailData[K] } = {
  invite: { name: 'Sara', inviterName: 'Huda', link: 'https://madar.example/welcome?token_hash=abc&type=invite' },
  reset: { name: 'Sara', link: 'https://madar.example/reset?token_hash=abc&type=recovery' },
  notice: { trigger: 'task_assigned', link: LINK },
  summary: {
    pastDue: [{ title: 'Check the setback of the villa', where: '260902AZT', due: '2026-10-01' }],
    today: [{ title: 'Renew the trade licence', where: null, due: '2026-10-04' }, { title: 'مراجعة مخططات الواجهة', where: '260903BNH', due: '2026-10-04' }],
    week: [{ title: 'Send the survey to the client', where: 'KH-26-014', due: '2026-10-07' }],
    more: 3,
    reviewsWaiting: 1,
    link: 'https://madar.example/',
  },
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
      expect(renderMail(kind, 'en', SAMPLES[kind] as never, {}, { appUrl: APP_URL })).toMatchSnapshot();
      expect(renderMail(kind, 'ar', SAMPLES[kind] as never, FEMALE, { appUrl: APP_URL })).toMatchSnapshot();
    });
  }

  describe('the header (TASKS.md, Logo, point 4)', () => {
    it('shows the Madar mark as the 192 px picture at the app address, with the name, in both languages', () => {
      // The empty alt: the name sits in the next cell, so a screen reader or a mail program that blocks pictures gives it once.
      const english = renderMail('notice', 'en', SAMPLES.notice, {}, { appUrl: APP_URL }).html;
      expect(english).toContain('<img src="https://madar.example/icons/madar-192.png" width="28" height="28" alt=""');
      expect(english).toMatch(/>Madar<\/td>/);
      const arabic = renderMail('notice', 'ar', SAMPLES.notice, {}, { appUrl: APP_URL }).html;
      expect(arabic).toContain('<img src="https://madar.example/icons/madar-192.png" width="28" height="28" alt=""');
      expect(arabic).toMatch(/>مدار<\/td>/);
      // The gap sits between the mark and the name: after the mark in English, before it (on the left) in Arabic.
      expect(english).toContain('padding-right:10px');
      expect(arabic).toContain('padding-left:10px');
    });

    it('never sends an SVG or a data: picture, which email programs often block', () => {
      for (const lang of ['en', 'ar'] as Language[]) {
        const html = renderMail('summary', lang, SAMPLES.summary, {}, { appUrl: APP_URL }).html;
        expect(html).not.toMatch(/<svg|data:|\.svg/);
      }
    });

    it('takes the app address from the caller, with a path and a slash at the end too, never a fixed host', () => {
      const html = renderMail('notice', 'en', SAMPLES.notice, {}, { appUrl: 'https://office.example/madar/' }).html;
      expect(html).toContain('src="https://office.example/madar/icons/madar-192.png"');
      expect(html).not.toContain('madar.example/icons');
    });

    it('shows the name only when no app address is known', () => {
      for (const lang of ['en', 'ar'] as Language[]) {
        const html = renderMail('notice', lang, SAMPLES.notice).html;
        expect(html).not.toContain('<img');
        expect(html).toContain(lang === 'ar' ? '>مدار</p>' : '>Madar</p>');
      }
    });

    it('refuses an app address that is not http or https', () => {
      expect(() => renderMail('notice', 'en', SAMPLES.notice, {}, { appUrl: 'javascript:alert(1)' })).toThrow(/link/);
    });

    it('points to a picture that the screens build publishes', () => {
      expect(MAIL_LOGO_PATH).toBe('icons/madar-192.png');
      expect(existsSync(new URL(`../../../public/${MAIL_LOGO_PATH}`, import.meta.url))).toBe(true);
    });

    it('keeps the text part as it was: a plain text mail has no picture', () => {
      expect(renderMail('notice', 'en', SAMPLES.notice, {}, { appUrl: APP_URL }).text).toBe(renderMail('notice', 'en', SAMPLES.notice).text);
    });
  });

  // Only the triggers that send email: the notices of requests and bugs stay in the app (owner, 2026-10-07). The snapshot keeps its name.
  it('renders each notice trigger with its own subject in both languages', () => {
    for (const lang of ['en', 'ar'] as Language[]) {
      const subjects = EMAIL_TRIGGERS.map((trigger) => renderMail('notice', lang, { trigger, link: LINK }).subject);
      expect(new Set(subjects).size).toBe(EMAIL_TRIGGERS.length);
      expect(Object.fromEntries(EMAIL_TRIGGERS.map((trigger, i) => [trigger, subjects[i]]))).toMatchSnapshot(`notice subjects ${lang}`);
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

  it('never puts client data in a notice: no task title, project name or comment text from its data', () => {
    const secret = { title: 'Villa Al Rashid facade', projectName: 'Rashid Tower', commentText: 'The client wants marble', actorName: 'Huda Saleh' };
    for (const lang of ['en', 'ar'] as Language[]) {
      for (const g of [{}, FEMALE] as { actor?: Gender; reader?: Gender }[]) {
        for (const trigger of EMAIL_TRIGGERS) {
          const out = allOutput(renderMail('notice', lang, { ...secret, trigger, link: LINK } as MailData['notice'], g));
          for (const value of Object.values(secret)) expect(out).not.toContain(value);
        }
      }
    }
  });

  it('puts in a summary only the title, the key and the day of each line it is given, never another field of the data', () => {
    const extra = { projectName: 'Rashid Tower', commentText: 'The client wants marble', clientName: 'Mr Al Rashid' };
    const data = {
      ...extra,
      pastDue: [{ title: 'Check the setback', where: '260902AZT', due: '2026-10-01', ...extra }],
      today: [], week: [], more: 0, reviewsWaiting: 0, link: LINK,
    } as unknown as MailData['summary'];
    for (const lang of ['en', 'ar'] as Language[]) {
      const out = allOutput(renderMail('summary', lang, data));
      expect(out).toContain('Check the setback');
      expect(out).toContain('260902AZT');
      for (const value of Object.values(extra)) expect(out).not.toContain(value);
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

  it('leaves out the review line when no review waits, and inflects the Arabic counts', () => {
    const base = { pastDue: [], today: [], week: [], more: 0, link: LINK };
    const onlyReviews = renderMail('summary', 'en', { ...base, reviewsWaiting: 2 });
    expect(onlyReviews.text).toContain('2 reviews wait for you.');
    expect(renderMail('summary', 'en', { ...base, reviewsWaiting: 0 }).text).not.toMatch(/review/);
    const counts = [1, 2, 3, 11].map((n) => renderMail('summary', 'ar', { ...base, reviewsWaiting: n }).text.split('\n').find((l) => l.includes('بانتظارك'))!);
    expect(counts).toEqual(['مراجعة واحدة بانتظارك.', 'مراجعتان بانتظارك.', '3 مراجعات بانتظارك.', '11 مراجعة بانتظارك.']);
  });

  it('names the meter and its one next step in a limit warning, for every meter', () => {
    for (const lang of ['en', 'ar'] as Language[]) {
      const steps = USAGE_METERS.map((meter) => renderMail('limitWarning', lang, { meter, percent: 80, link: LINK }).text);
      expect(new Set(steps).size).toBe(USAGE_METERS.length);
      for (const text of steps) expect(text).toContain('80%');
    }
    expect(renderMail('limitWarning', 'en', SAMPLES.limitWarning).text).toContain('move the files to Cloudflare R2, or remove old file versions');
  });

  it('gives the calls on the Worker their own next step: Workers Paid charges above 10 million, no action (owner, 2026-10-16)', () => {
    const en = renderMail('limitWarning', 'en', { meter: 'callsWorkers', percent: 82, link: LINK }).text;
    expect(en).toContain('Server calls this month: 82% of the free plan limit.');
    expect(en).toContain('Above 10 million calls in a month, Cloudflare Workers charges about $0.30 for each extra million. No action is needed.');
    const ar = renderMail('limitWarning', 'ar', { meter: 'callsWorkers', percent: 82, link: LINK }).text;
    expect(ar).toContain('طلبات الخادم هذا الشهر');
    expect(ar).toContain('لا يلزم أي إجراء.');
  });

  it('never names the database vendor: the screen bundle loads these words, and the prototype bundle check refuses the name', () => {
    for (const lang of ['en', 'ar']) {
      const words = readFileSync(new URL(`../../../src/i18n/real/mail.${lang}.json`, import.meta.url), 'utf8');
      expect({ lang, vendor: words.match(/supabase|سوبابيس/gi) }).toEqual({ lang, vendor: null });
    }
  });

  it('counts every email of the day in the quota warning, not only the notices: the limit counts sign-in mail too', () => {
    expect(renderMail('quotaWarning', 'en', SAMPLES.quotaWarning).text).toContain('Madar sent 90 emails today.');
    expect(renderMail('quotaWarning', 'ar', SAMPLES.quotaWarning).text).toContain('أرسل مدار 90 رسالة اليوم');
  });

  it('writes no em dash and no empty line of words in any mail, and only Arabic words in an Arabic mail', () => {
    for (const kind of MAIL_TEMPLATES) {
      for (const lang of ['en', 'ar'] as Language[]) {
        const m = renderMail(kind, lang, SAMPLES[kind] as never, FEMALE);
        expect(allOutput(m)).not.toContain('\u2014');
        expect(m.text).not.toMatch(/undefined|\{\{|(^|\s)mail\.\w/);
        if (lang === 'ar') {
          // Latin letters may appear only in the link, the names of the sample, the CSS and the HTML tags.
          const words = m.text.replace(/https?:\/\/\S+/g, '').replace(/Sara|Huda/g, '')
            .replace(/Check the setback of the villa|Renew the trade licence|Send the survey to the client|260902AZT|260903BNH|KH-26-014/g, '');
          expect({ kind, latin: words.match(/[A-Za-z]+/g) }).toEqual({ kind, latin: null });
        }
      }
    }
  });
});

describe('the morning summary lists the open tasks (fbk_021, owner 2026-10-19)', () => {
  const line = (n: number, where: string | null = '260902AZT', due = '2026-10-01') => ({ title: `Task number ${n}`, where, due });
  const MANY: MailData['summary'] = {
    pastDue: [line(1), line(2), line(3)],
    today: [line(4, null, '2026-10-04'), line(5, '260903BNH', '2026-10-04')],
    week: [line(6, 'KH-26-014', '2026-10-07'), line(7, '260902AZT', '2026-10-08'), line(8, '260902AZT', '2026-10-08')],
    more: 5,
    reviewsWaiting: 2,
    link: LINK,
  };
  const NONE: MailData['summary'] = { pastDue: [], today: [], week: [], more: 0, reviewsWaiting: 0, link: LINK };

  it('keeps the subject short and of the same kind as before', () => {
    expect(renderMail('summary', 'en', MANY).subject).toBe('Your morning summary from Madar');
    expect(renderMail('summary', 'ar', MANY).subject).toBe('ملخص الصباح من مدار');
  });

  it('shows the three groups in order, and a line for each task: the title, the project key or Office, and the due day', () => {
    const { text } = renderMail('summary', 'en', MANY);
    const at = ['Past due', 'Today', 'This week'].map((heading) => text.indexOf(`\n${heading}\n`));
    expect(at.every((index) => index > 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(text).toContain('Past due\n- Task number 1\n  260902AZT · Thu 1 Oct\n');
    expect(text).toContain('- Task number 4\n  Office · Sun 4 Oct\n');
    expect(text).toContain('- Task number 6\n  KH-26-014 · Wed 7 Oct\n');
  });

  it('shows the same eight lines in the HTML and in the text, then "and N more tasks", the reviews and one button', () => {
    const m = renderMail('summary', 'en', MANY, {}, { appUrl: APP_URL });
    expect(m.text.match(/^- Task number \d$/gm)).toHaveLength(8);
    expect(m.html.match(/Task number \d/g)).toHaveLength(8);
    expect(m.text).toContain('and 5 more tasks.');
    expect(m.html).toContain('and 5 more tasks.');
    expect(m.text).toContain('2 reviews wait for you.');
    // The "more" line and the review line come after the lists and before the button.
    expect(m.text.indexOf('and 5 more tasks.')).toBeGreaterThan(m.text.indexOf('- Task number 8'));
    expect(m.text.indexOf('2 reviews wait for you.')).toBeGreaterThan(m.text.indexOf('and 5 more tasks.'));
    expect(m.text.indexOf('Open Madar: ')).toBeGreaterThan(m.text.indexOf('2 reviews wait for you.'));
    expect(m.html.match(/>Open Madar<\/a>/g)).toHaveLength(1);
    expect(m.text.match(/Open Madar: /g)).toHaveLength(1);
    expect(m.text).not.toMatch(/[\u2013\u2014]/);
    expect(m.html).not.toMatch(/[\u2013\u2014]/);
  });

  it('leaves out an empty group, the "more" line when nothing is left, and the review line when no review waits', () => {
    const m = renderMail('summary', 'en', { ...NONE, today: [line(4, null, '2026-10-04')] });
    expect(m.text).toContain('\nToday\n');
    expect(m.text).not.toContain('Past due');
    expect(m.text).not.toContain('This week');
    expect(m.text).not.toMatch(/more task|review/);
    expect(m.html).not.toMatch(/Past due|This week|more task|review/);
  });

  it('renders a person with no open task as the intro and the button only', () => {
    const m = renderMail('summary', 'en', NONE);
    expect(m.text).toContain('Here is what waits for you today.');
    expect(m.text).not.toMatch(/^- /m);
    expect(m.text).toContain('Open Madar: https://madar.example');
  });

  it('adds no picture but the Madar mark, no style sheet, no script and no link but the button link and the mark', () => {
    for (const lang of ['en', 'ar'] as Language[]) {
      const html = renderMail('summary', lang, MANY, {}, { appUrl: APP_URL }).html;
      expect(html.match(/<img /g)).toHaveLength(1);
      expect(html).not.toMatch(/<script|<style|<link |<iframe|<video|<audio|<object|background-image|url\(|track|pixel|open\?/i);
      const urls = [...html.matchAll(/https?:\/\/[^"'<\s]+/g)].map((match) => match[0]);
      expect(new Set(urls)).toEqual(new Set([LINK, `${APP_URL}/icons/madar-192.png`]));
      const bare = renderMail('summary', lang, MANY).html;
      expect(bare).not.toContain('<img');
    }
  });

  it('escapes a title for the HTML, keeps it plain in the text, and isolates it so a title in another script does not break the line', () => {
    const odd = { ...NONE, today: [{ title: `<b>Plan</b> & "section" A's`, where: '260902AZT', due: '2026-10-04' }] };
    const m = renderMail('summary', 'en', odd);
    expect(m.html).toContain('<bdi dir="auto">&lt;b&gt;Plan&lt;/b&gt; &amp; &quot;section&quot; A&#39;s</bdi>');
    expect(m.html).not.toContain('<b>Plan</b>');
    expect(m.text).toContain(`- <b>Plan</b> & "section" A's`);
  });

  it('renders in Arabic, right to left, with the Arabic group names, "Office", the Arabic day and the Arabic counts', () => {
    const m = renderMail('summary', 'ar', MANY, FEMALE, { appUrl: APP_URL });
    expect(m.html).toMatch(/<html lang="ar" dir="rtl">/);
    expect(m.html).toContain('text-align:right');
    for (const heading of ['تجاوزت موعدها', 'اليوم', 'هذا الأسبوع']) expect(m.text, heading).toContain(`\n${heading}\n`);
    expect(m.text).toContain('- Task number 1\n  260902AZT · الخميس، 1 أكتوبر\n');
    expect(m.text).toContain('- Task number 4\n  المكتب · الأحد، 4 أكتوبر\n');
    expect(m.text).toContain('و5 مهام أخرى.');
    expect(m.text).toContain('مراجعتان بانتظارك.');
    expect(m.text).toContain('فتح مدار: ');
    expect(m.text).not.toMatch(/[\u2013\u2014]/);
  });

  it('inflects the Arabic "more" line for 1, 2, 3 and 11 tasks', () => {
    const more = [1, 2, 3, 11, 100].map((n) => renderMail('summary', 'ar', { ...NONE, more: n }).text.split('\n').find((l) => l.includes('أخر'))!);
    expect(more).toEqual(['ومهمة أخرى.', 'ومهمتان أخريان.', 'و3 مهام أخرى.', 'و11 مهمة أخرى.', 'و100 مهمة أخرى.']);
    expect(renderMail('summary', 'en', { ...NONE, more: 1 }).text).toContain('and 1 more task.');
  });
});
