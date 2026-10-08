import { describe, expect, it } from 'vitest';
import type { Select } from './query';
import { selectSql } from './sqlSource';

/**
 * The SQL text of the loader reads (performance audit 2026-10-07). server/it/loaders.it.test.ts proves that each form gives the
 * rows of the memory form; these tests pin which form a Select gets, and that every value goes as a parameter.
 */

describe('the time bound of atOrAfter (DB-1)', () => {
  const since = (value: string): Select => ({ c: 'events', where: [{ col: 'created_at', atOrAfter: value }], order: { col: 'seq', desc: true }, limit: 50 });

  it('keeps the time test and adds a text bound 36 hours before the time, in UTC, for the index on created_at', () => {
    const { text, values } = selectSql(since('2026-10-01T00:00:00+03:00'));
    expect(text).toContain('(t.created_at)::timestamptz >= $1::timestamptz');
    expect(text).toContain('t.created_at collate "C" >= $2::text');
    expect(values).toEqual(['2026-10-01T00:00:00+03:00', '2026-09-29T09:00:00', 50]);
  });

  it('gives the same bound for the same time in another offset', () => {
    expect(selectSql(since('2026-09-30T21:00:00Z')).values[1]).toBe('2026-09-29T09:00:00');
    expect(selectSql(since('2026-09-30T21:00:00.500-00:00')).values[1]).toBe('2026-09-29T09:00:00');
  });

  it('adds no bound for a time that does not parse', () => {
    const { text, values } = selectSql(since('not a time'));
    expect(text).not.toContain('collate "C" >=');
    expect(values).toEqual(['not a time', 50]);
  });
});

describe('the newest rows of each key (DB-2)', () => {
  const feed: Select = {
    c: 'events', where: [{ col: 'project_id', in: ['prj_001', 'prj_002'] }, { col: 'verb', in: ['task.created'] }, { notUndone: true }],
    order: { col: 'created_at', desc: true }, per: 'project_id', limit: 2, ties: true,
  };

  it('reads each key of the in-list on its own (LATERAL), with every row that ties with the last one', () => {
    const { text, values } = selectSql(feed);
    expect(text).toBe(
      'select x.ord, x.doc from (select distinct k from unnest($1::text[]) as k) p cross join lateral '
        + '(select t.ord, t.doc as doc from events t where t.project_id = p.k and t.verb = any($2::text[]) and not exists (select 1 from events u where u.undoes = t.id) '
        + 'order by t.created_at collate "C" desc fetch first ($3::int) rows with ties) x order by x.ord',
    );
    expect(values).toEqual([['prj_001', 'prj_002'], ['task.created'], 2]);
  });

  it('cuts with a plain limit when the order is total (the newest message of each chat)', () => {
    const { text, values } = selectSql({
      c: 'messages', where: [{ col: 'conversation_id', in: ['cnv_001'] }], order: { col: 'created_at', desc: true, id: true }, per: 'conversation_id', limit: 1,
    });
    expect(text).toContain('where t.conversation_id = p.k order by t.created_at collate "C" desc, t.id collate "C" desc, t.ord desc limit $2::int) x order by x.ord');
    expect(values).toEqual([['cnv_001'], 1]);
  });

  it('keeps the window over all rows when no in-list names the key', () => {
    const { text } = selectSql({ ...feed, where: [{ col: 'verb', in: ['task.created'] }] });
    expect(text).toContain('rank() over (partition by t.project_id order by t.created_at collate "C" desc)');
    expect(text).not.toContain('lateral');
    const inOr = selectSql({ ...feed, where: [{ or: [{ col: 'project_id', in: ['prj_001'] }] }] });
    expect(inOr.text).not.toContain('lateral');
  });
});

describe('the field pick (DB-4)', () => {
  it('builds the picked doc from the one array parameter, and takes away the keys that the doc does not hold', () => {
    const { text, values } = selectSql({ c: 'tasks', where: [{ col: 'project_id', in: ['prj_001'] }], pick: ['id', 'dueDate'] });
    const key = (i: number) => `($2::text[])[${i}]`;
    expect(text).toBe(
      `select t.ord, (jsonb_build_object(${key(1)}, t.doc->(${key(1)}), ${key(2)}, t.doc->(${key(2)})) `
        + `- array_remove(array[case when t.doc ? ${key(1)} then null else ${key(1)} end, case when t.doc ? ${key(2)} then null else ${key(2)} end], null)) as doc `
        + 'from tasks t where t.project_id = any($1::text[]) order by t.ord',
    );
    expect(values).toEqual([['prj_001'], ['id', 'dueDate']]);
  });

  it('gives an empty doc for an empty pick, and never writes a field name into the SQL text', () => {
    expect(selectSql({ c: 'tasks', where: [], pick: [] }).text).toBe(`select t.ord, '{}'::jsonb as doc from tasks t order by t.ord`);
    expect(selectSql({ c: 'tasks', where: [], pick: ['dueDate'] }).text).not.toContain('dueDate');
  });
});
