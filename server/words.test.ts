import { describe, expect, it } from 'vitest';
import { ar, en } from '../src/i18n/trees';

/** Server code (the mail of N2, plan 5.4) reads its words from the merged trees, so the server build and type check must load them. */
describe('the word trees on the server', () => {
  it('hold the base words and the words of the real build in both languages', () => {
    // errors.unauthenticated comes from src/i18n/real/core.*.json, which the base type does not list.
    for (const tree of [en, ar]) {
      expect(tree.errors.forbidden).toEqual(expect.any(String));
      expect((tree.errors as Record<string, unknown>).unauthenticated).toEqual(expect.any(String));
    }
  });
});
