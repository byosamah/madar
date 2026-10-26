import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ar, en } from '../../src/i18n/trees';

/**
 * The words of the Daftra link errors (owner 2026-10-26). Every refusal reason that the Daftra code gives (`daftra_...`) has an English and an
 * Arabic sentence under errors.reasons, in the track pair src/i18n/real/daftra.*.json, so a person always reads a sentence, never a code.
 */

const FILES = [
  '../calls/daftra.ts', '../daftra/paidCall.ts', '../../src/api/handlers/payments.ts', '../../src/api/handlers/serverFakes.ts', '../../src/api/handlers/history.ts',
];

const reasons = [...new Set(FILES.flatMap((file) => [...readFileSync(new URL(file, import.meta.url), 'utf8').matchAll(/'(daftra_[a-z_]+)'/g)].map((match) => match[1])))].sort();

const get = (tree: unknown, path: string[]): unknown => path.reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), tree);

describe('the words of the Daftra errors', () => {
  it('finds the reasons of the code (so this test cannot pass on an empty list)', () => {
    expect(reasons).toEqual(expect.arrayContaining([
      'daftra_not_ready', 'daftra_bad_key', 'daftra_refused', 'daftra_unreachable', 'daftra_invoice_not_found', 'daftra_client_not_found', 'daftra_no_client',
      'daftra_no_match', 'daftra_client_mismatch', 'daftra_draft', 'daftra_invoice_taken', 'daftra_invoice_changed', 'daftra_already_linked', 'daftra_final',
    ]));
  });

  it('has an English and an Arabic sentence for every reason, and no sentence with an em-dash or an en-dash', () => {
    for (const reason of reasons) {
      for (const [name, tree] of [['en', en], ['ar', ar]] as const) {
        const text = get(tree, ['errors', 'reasons', reason]);
        expect(typeof text, `${name} ${reason}`).toBe('string');
        expect(String(text).length, `${name} ${reason}`).toBeGreaterThan(10);
        expect(String(text), `${name} ${reason}`).not.toMatch(/[\u2013\u2014]/);
      }
    }
  });

  it('has the History line "Received, set by Daftra" in both languages', () => {
    expect(get(en, ['payments', 'daftraHistory', 'received'])).toBe('Received, set by Daftra');
    expect(typeof get(ar, ['payments', 'daftraHistory', 'received'])).toBe('string');
  });
});
