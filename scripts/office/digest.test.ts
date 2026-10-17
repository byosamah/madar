import { describe, expect, it } from 'vitest';
import { canonical, compareDigests, digestOf, recordDigest, rowDigest } from './digest';

describe('the digests of a table (scripts/office/digest.ts)', () => {
  it('writes an object with sorted keys at every depth, and leaves out an undefined value', () => {
    expect(canonical({ b: 1, a: { d: [2, { z: 1, y: undefined }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"z":1}]},"b":1}');
  });

  it('gives one record digest for a doc as text and as an object, with keys in any order', () => {
    const a = recordDigest([{ id: 'tsk_2', doc: '{"title":"B","n":1}' }, { id: 'tsk_1', doc: { n: 2, title: 'A' } }]);
    const b = recordDigest([{ id: 'tsk_1', doc: '{"title":"A","n":2}' }, { id: 'tsk_2', doc: { n: 1, title: 'B' } }]);
    expect(a).toEqual(b);
    expect(a.rows).toBe(2);
  });

  it('gives another digest when one value of one record differs', () => {
    expect(recordDigest([{ id: 'x', doc: { n: 1 } }]).sha256).not.toBe(recordDigest([{ id: 'x', doc: { n: 2 } }]).sha256);
  });

  it('keeps the order of the rows in a row digest (the rowid order of an export)', () => {
    expect(rowDigest([{ _rowid: 1 }, { _rowid: 2 }]).sha256).not.toBe(rowDigest([{ _rowid: 2 }, { _rowid: 1 }]).sha256);
  });

  it('gives the sha256 of the lines, each one with its newline, and the count of the lines', () => {
    expect(digestOf([])).toEqual({ rows: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
    // sha256 of "a\n".
    expect(digestOf(['a'])).toEqual({ rows: 1, sha256: '87428fc522803d31065e7bce3cf03fe475096631e5e07bbd7a0fde60c4cf25c7' });
  });

  it('names a missing table, another count and another hash; a drift table is a note; a skipped table is left out', () => {
    const want = { tasks: { rows: 2, sha256: 'a' }, events: { rows: 5, sha256: 'b' }, outbox: { rows: 1, sha256: 'c' }, office_meta: { rows: 1, sha256: 'd' } };
    const got = { tasks: { rows: 3, sha256: 'x' }, outbox: { rows: 2, sha256: 'y' }, office_meta: { rows: 1, sha256: 'z' } };
    expect(compareDigests(want, got, { notes: ['outbox'], skip: ['office_meta'] })).toEqual({
      problems: ['events: the source has it, the copy does not.', 'tasks: the source holds 2 rows, the copy holds 3.'],
      notes: ['outbox: the source holds 1 rows, the copy holds 2 (this table may change during an export).'],
    });
  });

  it('names a table that only the copy has, and the same count with another hash', () => {
    const want = { users: { rows: 4, sha256: 'a' } };
    const got = { users: { rows: 4, sha256: 'b' }, extra: { rows: 0, sha256: 'c' } };
    expect(compareDigests(want, got).problems).toEqual(['extra: the copy has it, the source does not.', 'users: the same 4 rows, another hash.']);
  });
});
