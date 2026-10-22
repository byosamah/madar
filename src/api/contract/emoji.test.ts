import { describe, expect, it, vi } from 'vitest';
import { isReactionEmoji, orderReactions } from './emoji';

describe('isReactionEmoji', () => {
  it.each(['👍', '👍🏽', '👨‍👩‍👧', '🇸🇦', '1️⃣', '❤️', '🫨'])('takes %s', (e) => expect(isReactionEmoji(e)).toBe(true));
  it.each(['', 'a', 'ok', '👍👍', '👍 ', '<b>', '٣', '👍'.repeat(17)])('refuses %j', (e) => expect(isReactionEmoji(e)).toBe(false));
});

describe('the grapheme segmenter (SV-2)', () => {
  const holder = Intl as { Segmenter?: typeof Intl.Segmenter };

  it('builds no segmenter when the module loads, and builds one on the first check only', async () => {
    const Real = Intl.Segmenter;
    let built = 0;
    class Counting extends Real {
      constructor(...args: ConstructorParameters<typeof Intl.Segmenter>) {
        super(...args);
        built += 1;
      }
    }
    holder.Segmenter = Counting as typeof Intl.Segmenter;
    try {
      vi.resetModules();
      const fresh = await import('./emoji');
      expect(built).toBe(0);
      expect(fresh.isReactionEmoji('👍')).toBe(true);
      expect(fresh.isReactionEmoji('👍👍')).toBe(false);
      expect(fresh.isReactionEmoji('🇸🇦')).toBe(true);
      expect(built).toBe(1);
    } finally {
      holder.Segmenter = Real;
    }
  });

  it('keeps the old answers when the runtime has no Segmenter', async () => {
    const Real = Intl.Segmenter;
    delete holder.Segmenter;
    try {
      vi.resetModules();
      const fresh = await import('./emoji');
      expect(fresh.isReactionEmoji('👍')).toBe(true);
      expect(fresh.isReactionEmoji('👍👍')).toBe(false);
      expect(fresh.isReactionEmoji('ok')).toBe(false);
    } finally {
      holder.Segmenter = Real;
    }
  });
});

describe('orderReactions', () => {
  it('puts the three quick ones first, then code point order', () => {
    expect(orderReactions(['🙏', '👀', '🎉', '👍'])).toEqual(['👍', '👀', '🎉', '🙏']);
  });
});
