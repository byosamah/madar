import { describe, expect, it } from 'vitest';
import { ar } from './trees';

/** Real names that stay in Latin letters in Arabic text. */
const ALLOWED = ['Revit', 'KH', 'Escape', 'English'];

function values(node: unknown, path = ''): [string, string][] {
  if (typeof node === 'string') return [[path, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) => values(child, path ? `${path}.${key}` : key));
}

describe('Arabic text', () => {
  it('uses Arabic script, except placeholders and real names', () => {
    const latin = values(ar).filter(([, text]) => {
      let rest = text.replace(/\{\{[^}]+\}\}/g, '');
      for (const word of ALLOWED) rest = rest.split(word).join('');
      return /[A-Za-z]/.test(rest);
    });
    expect(latin).toEqual([]);
  });

  it('words the meeting lines as the rest of the app does (final review, 2026-10-02)', () => {
    // "الفريق" means the office team elsewhere. The people of a project are "الأشخاص", as on the Dashboard.
    expect(ar.dashboard.meeting.people).toBe(ar.dashboard.views.people);
    // A count of days needs a preposition before it, as in dateReason.auto.
    expect(ar.dashboard.meeting.ifFinishesToday).toBe('عند انتهاء {{late}} اليوم، ينتقل موعد {{dependent}} بمقدار {{lateness}} إلى {{date}}.');
  });

  it('uses one word for one state (audit 2026-10-03, V-19, V-25, V-28)', () => {
    // A task past its due date is "تجاوزت موعدها", also on the switch of its notice; "تأخر" is the project health Late.
    expect(ar.settings.triggers.overdue).toBe('تجاوز مهمتي موعدها');
    // A dual subject takes a dual verb and pronoun.
    expect(ar.dashboard.meeting.personLate_two).toBe('اثنتان تجاوزتا موعدهما');
    // A person with active off is "غير نشط" in Admin and in the chat.
    expect(ar.chat.inactive).toBe(ar.admin.inactive);
    expect(ar.errors.reasons.person_left).toBe(ar.chat.closed);
  });

  it('never uses the plain ar-SA calendar words for dates', () => {
    const hijri = values(ar).filter(([, text]) => /هـ|هجري/.test(text));
    expect(hijri).toEqual([]);
  });
});
