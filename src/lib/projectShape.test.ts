import { describe, expect, it } from 'vitest';
import { OWNER_SHAPES } from '../test/projectShapes';
import { isProjectShape, PROJECT_SHAPE_MAX, PROJECT_SHAPE_PATTERN } from './projectShape';

describe('the shape of a project picture', () => {
  it('takes the three shapes of the owner', () => {
    for (const [name, shape] of Object.entries(OWNER_SHAPES)) expect(isProjectShape(shape), name).toBe(true);
  });

  it('takes every path command letter, the exponent letters, dots, commas and minus signs', () => {
    expect(isProjectShape('m1.5-2,3e-1 L4 5 h6 V7 c1 2 3 4 5 6 S7 8 9 10 q1 2 3 4 T5 6 a1 1 0 0 1 2 2 Zz')).toBe(true);
    expect(isProjectShape('M0 0E1')).toBe(true);
  });

  it('refuses an empty string and a string that does not start with M or m', () => {
    expect(isProjectShape('')).toBe(false);
    expect(isProjectShape('L1 1')).toBe(false);
    expect(isProjectShape(' M0 0')).toBe(false);
    expect(isProjectShape('1 M0 0')).toBe(false);
  });

  it.each([
    ['a double quote', 'M0 0" onload="x'],
    ['a single quote', "M0 0' x"],
    ['an angle bracket', 'M0 0<script>'],
    ['a closing angle bracket', 'M0 0>'],
    ['a letter that is no command', 'M0 0 B1 1'],
    ['a letter x', 'M0 0 x1'],
    ['a plus sign', 'M+1 1'],
    ['a new line', 'M0 0\nL1 1'],
    ['a tab', 'M0\t0'],
    ['an ampersand', 'M0 0&amp;'],
    ['a semicolon', 'M0 0;'],
    ['a parenthesis', 'M0 0 url(x)'],
    ['a hash sign', 'M0 0 #x'],
    ['an Arabic letter', 'M0 0 ب'],
  ])('refuses %s', (_name, value) => {
    expect(isProjectShape(value)).toBe(false);
  });

  it('refuses a string over 2000 characters and takes one of exactly 2000', () => {
    expect(PROJECT_SHAPE_MAX).toBe(2000);
    expect(isProjectShape(`M${'1'.repeat(PROJECT_SHAPE_MAX - 1)}`)).toBe(true);
    expect(isProjectShape(`M${'1'.repeat(PROJECT_SHAPE_MAX)}`)).toBe(false);
  });

  it('refuses a value that is no string', () => {
    for (const value of [null, undefined, 3, {}, ['M0 0']]) expect(isProjectShape(value)).toBe(false);
  });

  it('keeps the pattern anchored, so one bad line in the middle never passes', () => {
    expect(PROJECT_SHAPE_PATTERN.test('M0 0 <')).toBe(false);
  });
});
