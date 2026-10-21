import { describe, expect, it } from 'vitest';
import { isReactionEmoji, orderReactions } from './emoji';

describe('isReactionEmoji', () => {
  it.each(['👍', '👍🏽', '👨‍👩‍👧', '🇸🇦', '1️⃣', '❤️', '🫨'])('takes %s', (e) => expect(isReactionEmoji(e)).toBe(true));
  it.each(['', 'a', 'ok', '👍👍', '👍 ', '<b>', '٣', '👍'.repeat(17)])('refuses %j', (e) => expect(isReactionEmoji(e)).toBe(false));
});

describe('orderReactions', () => {
  it('puts the three quick ones first, then code point order', () => {
    expect(orderReactions(['🙏', '👀', '🎉', '👍'])).toEqual(['👍', '👀', '🎉', '🙏']);
  });
});
