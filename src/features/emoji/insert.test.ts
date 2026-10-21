import { describe, expect, it } from 'vitest';
import { insertAt } from './insert';

describe('insertAt', () => {
  it('puts the emoji in the middle, and the caret after it', () => {
    expect(insertAt('ab', 1, 1, '😀')).toEqual({ next: 'a😀b', caret: 3 });
  });

  it('puts the emoji at the end and at the start', () => {
    expect(insertAt('ab', 2, 2, '🙏')).toEqual({ next: 'ab🙏', caret: 4 });
    expect(insertAt('ab', 0, 0, '🙏')).toEqual({ next: '🙏ab', caret: 2 });
    expect(insertAt('', 0, 0, '👍')).toEqual({ next: '👍', caret: 2 });
  });

  it('replaces a selection', () => {
    expect(insertAt('hello world', 6, 11, '🌍')).toEqual({ next: 'hello 🌍', caret: 8 });
  });

  it('keeps the whole emoji with its joins and counts the caret in UTF-16 units', () => {
    expect(insertAt('x', 1, 1, '👋🏽')).toEqual({ next: 'x👋🏽', caret: 5 });
  });

  it('moves a place outside the text to the edge of the text', () => {
    expect(insertAt('ab', 9, 9, '🎉')).toEqual({ next: 'ab🎉', caret: 4 });
    expect(insertAt('ab', 2, 0, '🎉')).toEqual({ next: '🎉', caret: 2 });
  });
});
