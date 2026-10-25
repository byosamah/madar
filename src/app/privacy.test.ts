import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The public privacy page at /privacy (public/privacy.html). The Google Auth Platform asks for its link before an app can be
// published (owner, 2026-10-19, meetings wave 2).
const page = readFileSync('public/privacy.html', 'utf8');

describe('the privacy page', () => {
  it('has an English part and an Arabic part that reads from the right', () => {
    expect(page).toContain('<html lang="en"');
    expect(page).toMatch(/<section lang="ar" dir="rtl"/);
  });

  it('names the one Google Calendar permission and what Madar writes', () => {
    expect(page).toContain('https://www.googleapis.com/auth/calendar.app.created');
    expect(page).toContain('title, the time and the place');
    expect(page).toContain('Limited Use');
    expect(page).toContain('https://myaccount.google.com/permissions');
  });

  it('says what happens at a disconnect, in both languages (fbk_022, the Google Calendar connect)', () => {
    expect(page).toContain('Madar then deletes the key. After a disconnect at Google, Madar deletes it at its next write.');
    expect(page).toContain('When you disconnect, the Madar calendar stays in your Google Calendar. You can delete it there.');
    expect(page).toContain('يحذف مدار المفتاح عند أول كتابة له بعد ذلك');
    expect(page).toContain('يبقى تقويم «مدار» في تقويم Google عندك');
  });

  it('says what Madar keeps after a disconnect: only the calendar id, so a new connect uses the same calendar, and a removal deletes it (owner test 2026-10-20)', () => {
    expect(page).toContain('After a disconnect, Madar keeps only the id of the Madar calendar. It keeps no key and no event.');
    expect(page).toContain('If you connect again, Madar uses the same calendar.');
    expect(page).toContain('When the office removes a person from Madar, Madar deletes this id too.');
    expect(page).toContain('بعد أن تفصل الربط، يحفظ مدار رقم تقويم «مدار» فقط. لا يحفظ مفتاحًا ولا مواعيد.');
    expect(page).toContain('وإذا ربطت من جديد، يستعمل مدار التقويم نفسه.');
    expect(page).toContain('وعندما يحذف المكتب شخصًا من مدار، يحذف مدار هذا الرقم أيضًا.');
  });

  it('holds the date of the last change in both languages', () => {
    expect(page).toContain('Last change: 25 October 2026');
    expect(page).toContain('آخر تعديل: 25 أكتوبر 2026');
  });

  // Insight with PostHog (owner, 2026-10-25): the page names the processor, the region, who sees the data, and what is never recorded.
  it('names PostHog and its EU cloud in Frankfurt in both languages (insight design, 2026-10-25)', () => {
    const english = page.slice(0, page.indexOf('<section lang="ar"'));
    const arabic = page.slice(page.indexOf('<section lang="ar"'));
    expect(english).toContain('<h2>Usage data and errors</h2>');
    expect(english).toContain('PostHog');
    expect(english).toContain('EU cloud in Frankfurt, Germany');
    expect(english).toContain('Only the office owner sees it.');
    expect(english).toContain('Madar never records what you type, the text of chat messages, amounts of money, or the pictures of files.');
    expect(english).toContain('An error carries the name of the person');
    expect(english).toContain('PostHog keeps replays for 30 days.');
    expect(arabic).toContain('<h2>بيانات الاستخدام والأخطاء</h2>');
    expect(arabic).toContain('PostHog');
    expect(arabic).toContain('فرانكفورت');
    expect(arabic).toContain('يراها صاحب المكتب فقط.');
    expect(arabic).toContain('لا يحفظ مدار ما تكتبه، ولا نص رسائل المحادثة، ولا المبالغ المالية، ولا صور الملفات.');
    expect(arabic).toContain('يحمل الخطأ اسمك');
    expect(arabic).toContain('30 يومًا');
  });

  it('loads no script and no outside file', () => {
    expect(page).not.toMatch(/<script|<link|src="http/i);
  });

  it('has no em-dash or en-dash, and does not name the database vendor (the prototype bundle check refuses it)', () => {
    expect(page).not.toMatch(/[–—]/);
    expect(page.toLowerCase()).not.toContain('supabase');
  });
});
