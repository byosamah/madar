import { describe, expect, it } from 'vitest';
import { hasCycle } from './flow';

describe('hasCycle', () => {
  it('finds no cycle in an empty map', () => {
    expect(hasCycle(new Map())).toBe(false);
  });

  it('finds no cycle in a chain of waits', () => {
    expect(hasCycle(new Map([['a', ['b']], ['b', ['c']]]))).toBe(false);
  });

  it('finds no cycle when two chains meet at one part', () => {
    expect(hasCycle(new Map([['a', ['b', 'c']], ['b', ['d']], ['c', ['d']]]))).toBe(false);
  });

  it('finds a cycle of two parts that wait for each other', () => {
    expect(hasCycle(new Map([['a', ['b']], ['b', ['a']]]))).toBe(true);
  });

  it('finds a part that waits for itself', () => {
    expect(hasCycle(new Map([['a', ['a']]]))).toBe(true);
  });

  it('finds a cycle that a chain reaches, even when the chain is not part of the cycle', () => {
    expect(hasCycle(new Map([['a', ['b']], ['b', ['c']], ['c', ['b']]]))).toBe(true);
  });

  it('ignores a part that has no entry of its own', () => {
    expect(hasCycle(new Map([['a', ['z']]]))).toBe(false);
  });
});
