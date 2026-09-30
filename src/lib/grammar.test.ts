import { describe, expect, it } from 'vitest';
import i18n from 'i18next';
import { initI18n } from '../i18n';
import { counted } from './grammar';

describe('counted text', () => {
  it('uses the Arabic number forms for days and weeks', () => {
    initI18n('ar');
    const t = i18n.t.bind(i18n);
    expect([1, 2, 5, 11, 100].map((n) => counted(t, 'time.daysLeft', n))).toEqual(['بعد يوم', 'بعد يومين', 'بعد 5 أيام', 'بعد 11 يومًا', 'بعد 100 يوم']);
    expect([1, 2, 3, 12].map((n) => counted(t, 'time.days', n))).toEqual(['يوم', 'يومان', '3 أيام', '12 يومًا']);
    expect([1, 2, 4].map((n) => counted(t, 'time.weeks', n))).toEqual(['أسبوع', 'أسبوعان', '4 أسابيع']);
    expect(counted(t, 'time.daysLate', 3)).toBe('متأخر 3 أيام');
    initI18n('en');
    expect(counted(i18n.t.bind(i18n), 'time.daysLeft', 5)).toBe('5d');
  });
});
