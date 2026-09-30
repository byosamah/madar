import { describe, expect, it } from 'vitest';
import { nextColumn } from './board';

describe('board keys', () => {
  it('moves forward with the end-side arrow', () => {
    expect(nextColumn('todo', 'ArrowRight', false)).toBe('in_progress');
    expect(nextColumn('todo', 'ArrowLeft', true)).toBe('in_progress');
    expect(nextColumn('in_progress', 'ArrowLeft', false)).toBe('todo');
    expect(nextColumn('in_progress', 'ArrowRight', true)).toBe('todo');
  });

  it('stops at the edges and ignores other keys', () => {
    expect(nextColumn('done', 'ArrowRight', false)).toBeNull();
    expect(nextColumn('todo', 'ArrowLeft', false)).toBeNull();
    expect(nextColumn('todo', 'ArrowDown', false)).toBeNull();
  });
});
