import { describe, expect, it } from 'vitest';
import { BOTTOM_ZONE, START_GAP, isNearBottom, scrollTopFor } from './logScroll';

describe('the scroll math of the message log (design item 1)', () => {
  it('says the bottom zone is the last 80 px', () => {
    expect(BOTTOM_ZONE).toBe(80);
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 430, clientHeight: 500 })).toBe(true);
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 420, clientHeight: 500 })).toBe(false);
  });
  it('puts an item 16 px under the top, or in the middle, and never above 0', () => {
    expect(START_GAP).toBe(16);
    expect(scrollTopFor(500, { top: 100, height: 600 }, { top: 400, height: 80 }, 'start')).toBe(784);
    expect(scrollTopFor(500, { top: 100, height: 600 }, { top: 400, height: 80 }, 'center')).toBe(540);
    expect(scrollTopFor(0, { top: 100, height: 600 }, { top: 100, height: 40 }, 'start')).toBe(0);
  });
});
