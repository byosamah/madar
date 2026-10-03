import { describe, expect, it } from 'vitest';
import { moveTargets, nextColumn } from './board';

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

describe('move targets', () => {
  it('lets a card move to every other column', () => {
    expect(moveTargets('todo', false)).toEqual(['in_progress', 'in_review', 'done']);
    expect(moveTargets('in_review', false)).toEqual(['todo', 'in_progress', 'done']);
  });

  it('lets the reviewer move a task in review only to Done (audit 2026-10-03, V-5)', () => {
    expect(moveTargets('in_review', true)).toEqual(['done']);
    expect(moveTargets('in_progress', true)).toEqual(['todo', 'in_review', 'done']);
  });
});
