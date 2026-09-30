import { describe, expect, it } from 'vitest';
import { linkedProjectCodes, mentionMarkup, mentionedUserIds, normalizeForSearch } from './text';

describe('text helpers', () => {
  it('reads mentions once each', () => {
    const body = 'Hi @[Sara Al-Qahtani](usr_005) and @[Omar](usr_004), and again @[Sara Al-Qahtani](usr_005).';
    expect(mentionedUserIds(body)).toEqual(['usr_005', 'usr_004']);
  });

  it('writes mention markup', () => {
    expect(mentionMarkup('Sara', 'usr_005')).toBe('@[Sara](usr_005)');
  });

  it('reads project links', () => {
    expect(linkedProjectCodes('See #KH-26-014 and #KH-26-015.')).toEqual(['KH-26-014', 'KH-26-015']);
  });

  it('ignores case, spaces, diacritics and letter forms in search', () => {
    expect(normalizeForSearch('  CORNICHE   Tower ')).toBe('corniche tower');
    expect(normalizeForSearch('أَحْمَد')).toBe(normalizeForSearch('احمد'));
    expect(normalizeForSearch('إبراهيم')).toBe(normalizeForSearch('ابراهيم'));
    expect(normalizeForSearch('مدرسة')).toBe(normalizeForSearch('مدرسه'));
    expect(normalizeForSearch('مستشفى')).toBe(normalizeForSearch('مستشفي'));
  });
});
