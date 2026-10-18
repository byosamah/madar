import { describe, expect, it } from 'vitest';
import { ar, en } from '../i18n/trees';
import { WHATS_NEW } from './entries';

/** The text at a key path of a word tree, or undefined when the tree has no such key. */
function wordAt(tree: unknown, path: string[]): unknown {
  return path.reduce<unknown>((at, key) => (typeof at === 'object' && at !== null ? (at as Record<string, unknown>)[key] : undefined), tree);
}

describe("What's new entries", () => {
  it('have unique ids in the form YYYY-MM-DD-n', () => {
    const ids = WHATS_NEW.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-\d+$/);
  });

  it('give each entry the day of its id', () => {
    for (const entry of WHATS_NEW) expect(entry.id.startsWith(`${entry.day}-`)).toBe(true);
  });

  it('list the newest day first', () => {
    const days = WHATS_NEW.map((entry) => entry.day);
    expect([...days].sort().reverse()).toEqual(days);
  });

  it('have a title and a body in both languages', () => {
    for (const entry of WHATS_NEW) {
      for (const tree of [en, ar]) {
        expect(typeof wordAt(tree, ['whatsNew', 'items', entry.id, 'title'])).toBe('string');
        expect(typeof wordAt(tree, ['whatsNew', 'items', entry.id, 'body'])).toBe('string');
      }
    }
  });

  it('use no em-dash and no en-dash in any word of an entry', () => {
    for (const entry of WHATS_NEW) {
      for (const tree of [en, ar]) {
        for (const part of ['title', 'body']) {
          expect(String(wordAt(tree, ['whatsNew', 'items', entry.id, part]))).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
        }
      }
    }
  });
});
