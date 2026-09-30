import { describe, expect, it } from 'vitest';
import { groupByDay } from './group';

describe('groupByDay', () => {
  it('keeps the order and starts a new group when the day changes', () => {
    expect(groupByDay(['a1', 'a2', 'b1', 'a3'], (item) => item[0])).toEqual([
      { day: 'a', items: ['a1', 'a2'] },
      { day: 'b', items: ['b1'] },
      { day: 'a', items: ['a3'] },
    ]);
  });
});
