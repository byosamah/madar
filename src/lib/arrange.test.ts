import { describe, expect, it } from 'vitest';
import { arranged, arrangeRanks, RANK_STEP } from './arrange';

const rising = (ranks: number[]) => ranks.every((rank, i) => i === 0 || rank > ranks[i - 1]);
const changed = (before: (number | null | undefined)[], after: number[]) => after.filter((rank, i) => rank !== before[i]).length;

describe('the place numbers of a new order (owner, 2026-10-07)', () => {
  it('numbers a list that has no numbers yet', () => {
    expect(arrangeRanks([undefined, null, undefined])).toEqual([RANK_STEP, RANK_STEP * 2, RANK_STEP * 3]);
  });

  it('changes only the task that moved to the top, to the bottom or to the middle', () => {
    const top = [3000, 1000, 2000];
    expect(rising(arrangeRanks(top))).toBe(true);
    expect(changed(top, arrangeRanks(top))).toBe(1);
    expect(arrangeRanks(top)[0]).toBeLessThan(1000);
    const bottom = [2000, 3000, 1000];
    expect(arrangeRanks(bottom)).toEqual([2000, 3000, 4000]);
    const middle = [1000, 3000, 2000, 4000];
    expect(arrangeRanks(middle, 1)).toEqual([1000, 1500, 2000, 4000]);
  });

  it('gives the new number to the task the person moved when two answers are as short', () => {
    // 3000 went above 2000. Without the hint, 2000 could take the new number instead.
    expect(arrangeRanks([1000, 3000, 2000, 4000], 1)[2]).toBe(2000);
    expect(arrangeRanks([1000, 3000, 2000, 4000], 2)[1]).toBe(3000);
  });

  it('places tasks with no number between the numbered ones around them', () => {
    const ranks = arrangeRanks([1000, undefined, undefined, 4000]);
    expect(ranks).toEqual([1000, 2000, 3000, 4000]);
    expect(arrangeRanks([undefined, 1000])).toEqual([0, 1000]);
  });

  it('numbers the whole list again when no room is left between two places', () => {
    const tight = [1, 1 + 1e-7, 1 + 2e-7];
    const ranks = arrangeRanks([tight[0], tight[2], tight[1]], 1);
    expect(ranks).toEqual([RANK_STEP, RANK_STEP * 2, RANK_STEP * 3]);
  });
});

describe('rows in the shared order', () => {
  const row = (id: string, rank?: number | null) => ({ id, task: { rank } });
  it('puts the numbered tasks first, lowest first, then the others in the order given', () => {
    const rows = [row('a'), row('b', 2000), row('c', null), row('d', 1000)];
    expect(arranged(rows).map((item) => item.id)).toEqual(['d', 'b', 'a', 'c']);
  });
});
