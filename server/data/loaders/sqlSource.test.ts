import { describe, expect, it } from 'vitest';
import type { Query } from '../../core/ports';
import type { CountSelect, Select } from './query';
import { countSql, selectSql, sqlSource } from './sqlSource';

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

describe('the unread counts and the task threads of the badge (DB-6)', () => {
  const bounds = { col: 'target_id', by: { tsk_001: { gt: '' }, tsk_002: { gt: '2026-10-01', ge: '2026-10-02', after: { at: '2026-10-03', id: 'cmt_009' } } } };
  const unread: CountSelect = { c: 'comments', per: 'target_id', where: [{ col: 'target_type', eq: 'task' }, { bounds }, { field: 'authorId', notIn: ['usr_001'] }] };

  it('joins the bounds to the table on the key, so each key reads its own rows on the index', () => {
    const { text, values } = countSql(unread);
    expect(text).toBe(
      'select b.k as v, count(*)::integer as n from jsonb_to_recordset($1::jsonb) as b(k text, gt text, ge text, aat text, aid text) '
        + 'join comments t on t.target_id = b.k where t.target_type = $2::text and '
        + '(t.created_at collate "C" > b.gt collate "C" and (b.ge is null or t.created_at collate "C" >= b.ge collate "C") '
        + 'and (b.aat is null or t.created_at collate "C" > b.aat collate "C" or (t.created_at = b.aat and t.id collate "C" > b.aid collate "C"))) '
        + `and (t.doc->>'authorId' is null or not (t.doc->>'authorId' = any($3::text[]))) group by b.k`,
    );
    expect(JSON.parse(values[0] as string)).toEqual([
      { k: 'tsk_001', gt: '', ge: null, aat: null, aid: null }, { k: 'tsk_002', gt: '2026-10-01', ge: '2026-10-02', aat: '2026-10-03', aid: 'cmt_009' },
    ]);
    expect(values.slice(1)).toEqual(['task', ['usr_001']]);
  });

  it('keeps the grouped count when the bounds name another column, or when no bounds are set', () => {
    expect(countSql({ ...unread, per: 'created_at' }).text).toMatch(/^select t\.created_at as v, count\(\*\)::integer as n from comments t where /);
    expect(countSql({ c: 'comments', per: 'target_id', where: [{ col: 'target_type', eq: 'task' }] }).text)
      .toBe('select t.target_id as v, count(*)::integer as n from comments t where t.target_type = $1::text group by t.target_id');
  });

  it('bounds a count of events from above on the time (atBefore), with a timestamp test and a text bound 36 hours later', () => {
    const { text, values } = countSql({ c: 'events', per: 'verb', where: [{ col: 'created_at', atBefore: '2026-10-04T00:00:00+03:00' }] });
    expect(text).toBe(
      'select t.verb as v, count(*)::integer as n from events t '
      + 'where ((t.created_at)::timestamptz < $1::timestamptz and t.created_at collate "C" < $2::text) group by t.verb',
    );
    expect(values).toEqual(['2026-10-04T00:00:00+03:00', '2026-10-05T09:00:00']);
  });

  it('gives the time test alone for an upper bound that does not parse', () => {
    const { text, values } = countSql({ c: 'events', per: 'verb', where: [{ col: 'created_at', atBefore: 'not a time' }] });
    expect(text).toBe('select t.verb as v, count(*)::integer as n from events t where (t.created_at)::timestamptz < $1::timestamptz group by t.verb');
    expect(values).toEqual(['not a time']);
  });

  it('finds the candidate tasks of the threads first, then groups only their comments', async () => {
    const sent: string[] = [];
    const q: Query = async <R,>(text: string) => {
      sent.push(text);
      return [] as R[];
    };
    await sqlSource(q).threads({ owner: 'usr_005', led: [], me: ['usr_005'], limit: 100, admin: false });
    const text = sent[0].replace(/\s+/g, ' ');
    expect(text).toContain('cand as (select k.id from tasks k where');
    expect(text).toContain("from comments c where c.target_type = 'task' and c.target_id in (select id from cand)");
    expect(text).not.toContain('join tasks');
  });
});

describe('the rows that still name a record (DB-M3)', () => {
  async function sentFor(c: Parameters<ReturnType<typeof sqlSource>['referencing']>[0], path: string): Promise<{ text: string; values: unknown[] }> {
    const sent: { text: string; values: unknown[] }[] = [];
    const q: Query = async <R,>(text: string, values: unknown[] = []) => {
      sent.push({ text, values });
      return [] as R[];
    };
    await sqlSource(q).referencing(c, path, 'tsk_001', 'cmt_001');
    return sent[0];
  }

  it('looks up a plain field with a text column of its own on that column', async () => {
    expect(await sentFor('comments', 'targetId')).toEqual({
      text: 'select t.ord, t.doc from comments t where t.target_id = $1::text and t.id is distinct from $2::text order by t.ord limit 1', values: ['tsk_001', 'cmt_001'],
    });
    expect((await sentFor('chatReads', 'conversationId')).text).toContain('from chat_reads t where t.conversation_id = $1::text');
    expect((await sentFor('tracker', 'replyTaskId')).text).toContain('where t.reply_task_id = $1::text');
    expect((await sentFor('files', 'taskId')).text).toContain('where t.task_id = $1::text');
  });

  it('keeps the JSON path for a list, a nested field, and a field with no column', async () => {
    for (const [c, path] of [['comments', 'dates.byTaskId'], ['tasks', 'prerequisiteIds[]'], ['tasks', 'dateNotes[].byTaskId'], ['tasks', 'createdBy'], ['comments', 'reactions.*[]']] as const) {
      const { text, values } = await sentFor(c, path);
      expect(text, path).toContain('jsonb_path_exists(t.doc, $1::jsonpath');
      expect(values[1], path).toBe('tsk_001');
    }
  });
});
