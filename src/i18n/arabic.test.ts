import { describe, expect, it } from 'vitest';
import ar from './ar.json';

/** Real names that stay in Latin letters in Arabic text. */
const ALLOWED = ['Revit', 'KH', 'Escape', 'English'];

function values(node: unknown, path = ''): [string, string][] {
  if (typeof node === 'string') return [[path, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) => values(child, path ? `${path}.${key}` : key));
}

describe('Arabic text', () => {
  it('uses Arabic script, except placeholders and real names', () => {
    const latin = values(ar).filter(([, text]) => {
      let rest = text.replace(/\{\{[^}]+\}\}/g, '');
      for (const word of ALLOWED) rest = rest.split(word).join('');
      return /[A-Za-z]/.test(rest);
    });
    expect(latin).toEqual([]);
  });

  it('never uses the plain ar-SA calendar words for dates', () => {
    const hijri = values(ar).filter(([, text]) => /هـ|هجري/.test(text));
    expect(hijri).toEqual([]);
  });
});
