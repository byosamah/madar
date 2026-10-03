import { describe, expect, it } from 'vitest';
import { arrowStep } from './keys';

describe('arrowStep', () => {
  it('moves forward with the end-side arrow, so ArrowLeft moves forward in Arabic', () => {
    expect(arrowStep('ArrowRight', false)).toBe(1);
    expect(arrowStep('ArrowLeft', false)).toBe(-1);
    expect(arrowStep('ArrowLeft', true)).toBe(1);
    expect(arrowStep('ArrowRight', true)).toBe(-1);
  });

  it('takes Up and Down only in a vertical group, and ignores other keys', () => {
    expect(arrowStep('ArrowDown', false)).toBe(0);
    expect(arrowStep('ArrowDown', false, true)).toBe(1);
    expect(arrowStep('ArrowUp', true, true)).toBe(-1);
    expect(arrowStep('Enter', false, true)).toBe(0);
  });
});
