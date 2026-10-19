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

  it('holds the date of the last change in both languages', () => {
    expect(page).toContain('Last change: 23 October 2026');
    expect(page).toContain('آخر تعديل: 23 أكتوبر 2026');
  });

  it('loads no script and no outside file', () => {
    expect(page).not.toMatch(/<script|<link|src="http/i);
  });

  it('has no em-dash or en-dash, and does not name the database vendor (the prototype bundle check refuses it)', () => {
    expect(page).not.toMatch(/[–—]/);
    expect(page.toLowerCase()).not.toContain('supabase');
  });
});
