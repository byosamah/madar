import { describe, expect, it } from 'vitest';
import i18n from 'i18next';
import { initI18n } from '../i18n';
import { dueText, dueWord } from './due';

const TODAY = '2026-09-30';

describe('gentle due words', () => {
  it('names past, today, soon and later dates calmly', () => {
    expect(dueWord('2026-09-27', TODAY, 'in_progress')).toEqual({ key: 'pastDue', n: 3, tone: 'attn' });
    expect(dueWord('2026-09-30', TODAY, 'todo')).toEqual({ key: 'dueToday', n: 0, tone: 'quiet' });
    expect(dueWord('2026-10-03', TODAY, 'todo')).toEqual({ key: 'dueIn', n: 3, tone: 'quiet' });
    expect(dueWord('2026-10-20', TODAY, 'todo')).toEqual({ key: 'dueOn', n: 20, tone: 'quiet' });
    expect(dueWord(null, TODAY, 'todo')).toBeNull();
    expect(dueWord('2026-09-20', TODAY, 'done')).toBeNull();
    expect(dueWord('2026-09-20', TODAY, 'in_review')).toEqual({ key: 'dueOn', n: -10, tone: 'quiet' });
  });

  it('writes the words in English and Arabic', () => {
    initI18n('en');
    const t = i18n.t.bind(i18n);
    expect(dueText(dueWord('2026-09-29', TODAY, 'todo')!, t, 'en', '2026-09-29')).toBe('1 day past due');
    expect(dueText(dueWord('2026-09-27', TODAY, 'todo')!, t, 'en', '2026-09-27')).toBe('3 days past due');
    expect(dueText(dueWord('2026-09-30', TODAY, 'todo')!, t, 'en', '2026-09-30')).toBe('Due today');
    expect(dueText(dueWord('2026-10-01', TODAY, 'todo')!, t, 'en', '2026-10-01')).toBe('Tomorrow');
    expect(dueText(dueWord('2026-10-02', TODAY, 'todo')!, t, 'en', '2026-10-02')).toBe('In 2 days');
    initI18n('ar');
    const ta = i18n.t.bind(i18n);
    expect(dueText(dueWord('2026-09-27', TODAY, 'todo')!, ta, 'ar', '2026-09-27')).toBe('متأخرة 3 أيام');
    expect(dueText(dueWord('2026-09-28', TODAY, 'todo')!, ta, 'ar', '2026-09-28')).toBe('متأخرة يومين');
    initI18n('en');
  });
});
