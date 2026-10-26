/**
 * The own shape of a project picture (owner, 2026-10-26): one SVG path in a box of 0 0 18 18, drawn in ink in the place of the fixed
 * form of the mark. The glow does not change.
 *
 * Only path command letters (M m L l H h V v C c S s Q q T t A a Z z), digits, spaces, commas, dots, minus signs and the exponent
 * letters e and E may stand in the string, and it starts with M or m. So the string is safe to put in an SVG attribute and in SVG text.
 */
export const PROJECT_SHAPE_MAX = 2000;
export const PROJECT_SHAPE_PATTERN = /^[Mm][MmLlHhVvCcSsQqTtAaZz0-9 ,.eE-]*$/;

/** The words of the refusal, for the contract and the screens. */
export const PROJECT_SHAPE_RULE = 'Use one SVG path that starts with M, in a box of 18 by 18, of 2000 characters or less.';

export function isProjectShape(value: unknown): value is string {
  return typeof value === 'string' && value.length <= PROJECT_SHAPE_MAX && PROJECT_SHAPE_PATTERN.test(value);
}
