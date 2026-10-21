import { describe, expect, it } from 'vitest';
import data from './data.generated.json';
import { foldArabic, searchEmoji, type EmojiItem } from './search';

/** The search of the emoji panel (chat presence design D4, track emoji E1). */
const groups = data.groups as { items: EmojiItem[] }[];
const flat = groups.flatMap((group) => group.items.map((item) => item.e));

describe('foldArabic', () => {
  it('drops the short vowels and the tatweel, and joins the forms of alef, teh marbuta and alef maksura', () => {
    expect(foldArabic('أَحْمَر')).toBe('احمر');
    expect(foldArabic('إِيمُوجِي')).toBe('ايموجي');
    expect(foldArabic('آمن')).toBe('امن');
    expect(foldArabic('قلـــب')).toBe('قلب');
    expect(foldArabic('وردة')).toBe('ورده');
    expect(foldArabic('مستشفى')).toBe('مستشفي');
  });

  it('puts Latin letters in lower case', () => {
    expect(foldArabic('Grinning FACE')).toBe('grinning face');
  });
});

describe('searchEmoji', () => {
  it('finds 🙏 for thanks', () => {
    expect(searchEmoji(groups, 'thanks').map((item) => item.e)).toContain('🙏');
  });

  it('finds ❤️ for قلب and for احمر', () => {
    expect(searchEmoji(groups, 'قلب').map((item) => item.e)).toContain('❤️');
    expect(searchEmoji(groups, 'احمر').map((item) => item.e)).toContain('❤️');
    expect(searchEmoji(groups, 'أَحمر').map((item) => item.e)).toContain('❤️');
  });

  it('finds ❤️ for heart, and matches the start of a word, not the middle', () => {
    expect(searchEmoji(groups, 'hear').map((item) => item.e)).toContain('❤️');
    expect(searchEmoji(groups, 'rtbeat')).toEqual([]);
  });

  it('needs every word of the query', () => {
    const found = searchEmoji(groups, 'red heart').map((item) => item.e);
    expect(found).toContain('❤️');
    expect(searchEmoji(groups, 'red zzzz')).toEqual([]);
  });

  it('finds nothing for zzzz, and nothing for an empty query', () => {
    expect(searchEmoji(groups, 'zzzz')).toEqual([]);
    expect(searchEmoji(groups, '   ')).toEqual([]);
  });

  it('keeps the list order and stops at the limit', () => {
    const found = searchEmoji(groups, 'face', 500).map((item) => flat.indexOf(item.e));
    expect(found.length).toBeGreaterThan(20);
    expect(found).toEqual([...found].sort((a, b) => a - b));
    expect(searchEmoji(groups, 'face', 5)).toHaveLength(5);
  });
});
