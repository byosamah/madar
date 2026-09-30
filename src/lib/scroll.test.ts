import { describe, expect, it } from 'vitest';
import { nextCompact } from './scroll';

describe('compact bars', () => {
  it('goes compact when the content moves down past 64 px, and back when it moves up', () => {
    expect(nextCompact(false, 0, 40)).toBe(false);
    expect(nextCompact(false, 80, 120)).toBe(true);
    expect(nextCompact(true, 300, 250)).toBe(false);
    expect(nextCompact(true, 300, 302)).toBe(true);
    expect(nextCompact(true, 300, 20)).toBe(false);
  });
});
