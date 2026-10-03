import { describe, expect, it } from 'vitest';
import { mergeWords } from './trees';

describe('mergeWords', () => {
  it('adds the words of each track file to the base tree', () => {
    const base = { errors: { failed: 'Failed.', reasons: { busy_old: 'x' } } };
    const merged = mergeWords(base, [
      { file: 'real/core.en.json', words: { errors: { reasons: { busy: 'Busy.' } } } },
      { file: 'real/mail.en.json', words: { mail: { subject: 'Hello' } } },
    ]);
    expect(merged).toEqual({ errors: { failed: 'Failed.', reasons: { busy_old: 'x', busy: 'Busy.' } }, mail: { subject: 'Hello' } });
    expect(base).toEqual({ errors: { failed: 'Failed.', reasons: { busy_old: 'x' } } });
  });

  it('fails on a key that the base tree already has, and names the file', () => {
    expect(() => mergeWords({ errors: { failed: 'Failed.' } }, [{ file: 'real/core.en.json', words: { errors: { failed: 'Again.' } } }]))
      .toThrow(/errors\.failed.*real\/core\.en\.json/);
  });

  it('fails on a key that two track files both add', () => {
    expect(() => mergeWords({}, [
      { file: 'real/a.en.json', words: { people: { invited: 'Invited' } } },
      { file: 'real/b.en.json', words: { people: { invited: 'Invited too' } } },
    ])).toThrow(/people\.invited.*real\/b\.en\.json/);
  });

  it('fails when a file puts a text where the tree has a group, or a group where it has a text', () => {
    expect(() => mergeWords({ errors: { failed: 'Failed.' } }, [{ file: 'real/x.en.json', words: { errors: 'Text' } }])).toThrow(/errors/);
    expect(() => mergeWords({ errors: 'Text' }, [{ file: 'real/x.en.json', words: { errors: { failed: 'x' } } }])).toThrow(/errors/);
  });
});
