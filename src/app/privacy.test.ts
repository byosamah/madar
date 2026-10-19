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

  it('loads no script and no outside file', () => {
    expect(page).not.toMatch(/<script|<link|src="http/i);
  });

  it('has no em-dash or en-dash, and does not name the database vendor (the prototype bundle check refuses it)', () => {
    expect(page).not.toMatch(/[–—]/);
    expect(page.toLowerCase()).not.toContain('supabase');
  });
});
