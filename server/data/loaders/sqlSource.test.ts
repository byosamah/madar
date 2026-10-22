import { describe, expect, it } from 'vitest';
import type { Query } from '../../core/ports';
import type { CountSelect, Select } from './query';
import type { Read } from './source';
import { batchSql, countSql, selectSql, sqlSource } from './sqlSource';

/**
 * The SQL text of the loader reads (performance audit 2026-10-07). server/it/loaders.it.test.ts proves that each form gives the
 * rows of the memory form; these tests pin which form a Select gets, and that every value goes as a parameter.
 */

describe('the counters of a write (DB-12)', () => {
  it('reads the counters with a statement of its own when the call has none', async () => {
    const asked: string[] = [];
    const q = (async (text: string) => {
      asked.push(text);
      return [{ prefix: 'tsk', n: 7 }];
    }) as unknown as Query;
    expect(await sqlSource(q).counters()).toEqual({ tsk: 7 });
    expect(asked).toEqual(['select prefix, n from counters']);
  });

  it('gives the counters that the office read of the call already holds, with no statement', async () => {
    const q = (async () => {
      throw new Error('no statement expected');
    }) as unknown as Query;
    const held = { tsk: 7, msg: 3 };
    const source = sqlSource(q, { counters: () => held });
    const first = await source.counters();
    expect(first).toEqual({ tsk: 7, msg: 3 });
    // A copy: the caller owns what it gets, and a change to it never reaches the held numbers.
    first.tsk = 99;
    expect(await source.counters()).toEqual({ tsk: 7, msg: 3 });
  });

  it('falls back to the statement when the office read held no counters', async () => {
    const q = (async () => [{ prefix: 'cmt', n: '4' }]) as unknown as Query;
    expect(await sqlSource(q, { counters: () => undefined }).counters()).toEqual({ cmt: 4 });
  });
});

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

describe('the rows after one row, oldest first, and contains as a LIKE (chat design 2026-10-19, item 17)', () => {
  it('reads the rows after one row, oldest first (open at one message)', () => {
    const { text, values } = selectSql({
      c: 'messages', where: [{ col: 'conversation_id', in: ['cnv_001'] }, { after: { at: '2026-10-04T10:00:00.000+03:00', id: 'msg_010' } }],
      order: { col: 'created_at', asc: true, id: true }, limit: 479,
    });
    expect(text).toContain('(t.created_at collate "C" > $2::text or (t.created_at = $2::text and t.id collate "C" > $3::text))');
    // The order ends with the id, so the read takes the plain LIMIT form of DB-9 (perf2): one key is an equality and the id makes the order total.
    expect(text).toContain('order by t.created_at collate "C" asc, t.id collate "C" asc limit $4::int) x order by x.ord');
    expect(text).toContain('t.conversation_id = $1::text');
    expect(values).toEqual(['cnv_001', '2026-10-04T10:00:00.000+03:00', 'msg_010', 479]);
  });

  it('sends contains as LIKE with its wildcards escaped, so a trigram index can serve it', () => {
    const { text, values } = selectSql({ c: 'tasks', where: [{ col: 'search_text', contains: '50%_off\\' }] });
    expect(text).toContain('t.search_text like $1::text');
    expect(values).toEqual(['%50\\%\\_off\\\\%']);
  });

  it('refuses an ascending read with ties', () => {
    expect(() => selectSql({ c: 'messages', where: [], order: { col: 'created_at', asc: true }, limit: 2, ties: true })).toThrow('An ascending read takes no ties.');
  });

  it('gives a per read the ascending order in its LATERAL form too', () => {
    const { text } = selectSql({ c: 'messages', where: [{ col: 'conversation_id', in: ['cnv_001'] }], order: { col: 'created_at', asc: true, id: true }, per: 'conversation_id', limit: 3 });
    expect(text).toContain('order by t.created_at collate "C" asc, t.id collate "C" asc, t.ord asc limit $2::int) x order by x.ord');
  });
});

describe('the plain LIMIT form of an ordered read with a total order (DB-9 of perf2)', () => {
  const inbox: Select = {
    c: 'notifications', where: [{ col: 'user_id', in: ['usr_005'] }, { col: 'read', eq: true }], order: { col: 'created_at', desc: true, id: true }, limit: 100,
  };

  it('reads one key as an equality and cuts with LIMIT on the order columns and the id, with the order by ord outside', () => {
    const { text, values } = selectSql(inbox);
    expect(text).toBe(
      'select x.ord, x.doc from (select t.ord, t.doc as doc from notifications t where t.user_id = $1::text and t.read = $2::boolean '
        + 'order by t.created_at collate "C" desc, t.id collate "C" desc limit $3::int) x order by x.ord',
    );
    expect(values).toEqual(['usr_005', true, 100]);
  });

  it('keeps a list of keys as any(), because the equality is for one key only', () => {
    const { text, values } = selectSql({ ...inbox, where: [{ col: 'user_id', in: ['usr_005', 'usr_006'] }, { col: 'read', eq: true }] });
    expect(text).toContain('t.user_id = any($1::text[])');
    expect(text).toContain('limit $3::int) x order by x.ord');
    expect(values).toEqual([['usr_005', 'usr_006'], true, 100]);
  });

  it('keeps the window form with ties, with no id in the order, and with no order', () => {
    expect(selectSql({ ...inbox, ties: true }).text).toContain('rank() over (order by t.created_at collate "C" desc, t.id collate "C" desc)');
    expect(selectSql({ ...inbox, order: { col: 'created_at', desc: true } }).text).toContain('row_number() over (order by t.created_at collate "C" desc, t.ord desc)');
    expect(selectSql({ ...inbox, order: undefined }).text).toContain('row_number() over (order by t.ord)');
  });

  it('leaves a read with no limit as it was, with any() for one key', () => {
    expect(selectSql({ c: 'notifications', where: [{ col: 'user_id', in: ['usr_005'] }, { col: 'read', eq: false }] }).text)
      .toBe('select t.ord, t.doc as doc from notifications t where t.user_id = any($1::text[]) and t.read = $2::boolean order by t.ord');
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
  const key = (i: number) => `($2::text[])[${i}]`;

  it('returns the picked values as one array with the mask of the absent keys in front, from the one array parameter', () => {
    const { text, values } = selectSql({ c: 'tasks', where: [{ col: 'project_id', in: ['prj_001'] }], pick: ['id', 'dueDate'] });
    expect(text).toBe(
      `select t.ord, jsonb_build_array(case when t.doc ? ${key(1)} then 0 else 1 end + case when t.doc ? ${key(2)} then 0 else 2 end, `
        + `t.doc->(${key(1)}), t.doc->(${key(2)})) as doc from tasks t where t.project_id = any($1::text[]) order by t.ord`,
    );
    expect(values).toEqual([['prj_001'], ['id', 'dueDate']]);
  });

  it('gives an empty doc for an empty pick, and never writes a field name into the SQL text', () => {
    expect(selectSql({ c: 'tasks', where: [], pick: [] }).text).toBe(`select t.ord, '{}'::jsonb as doc from tasks t order by t.ord`);
    expect(selectSql({ c: 'tasks', where: [], pick: ['dueDate'] }).text).not.toContain('dueDate');
  });

  it('keeps the object form for a pick of more than 50 keys', () => {
    const pick = Array.from({ length: 51 }, (_, i) => `f${i}`);
    expect(selectSql({ c: 'tasks', where: [], pick }).text).toContain('jsonb_each(t.doc)');
    expect(selectSql({ c: 'tasks', where: [], pick: pick.slice(0, 50) }).text).toContain('jsonb_build_array(');
  });

  /** A Query that answers one read with the rows that the database sends. */
  const answering = (rows: unknown[]): Query => async <R,>() => rows as R[];

  it('builds the object of each row back from the array: an absent key stays absent, a JSON null stays null (DB-4 of perf2)', async () => {
    // The pick is id, ownerId, completedAt, rank. Row 1 has them all; row 2 has no completedAt (bit 2, value 4) and a null ownerId.
    const src = sqlSource(answering([
      { ord: '2', doc: [0, 'tsk_001', 'usr_001', '2026-10-01', 3] },
      { ord: '5', doc: [4, 'tsk_002', null, null, 7] },
      { ord: '9', doc: [14, 'tsk_003', null, null, null] },
    ]));
    const rows = await src.select({ c: 'tasks', where: [{ col: 'id', in: ['tsk_001'] }], pick: ['id', 'ownerId', 'completedAt', 'rank'] });
    expect(rows).toEqual([
      { ord: 2, doc: { id: 'tsk_001', ownerId: 'usr_001', completedAt: '2026-10-01', rank: 3 } },
      { ord: 5, doc: { id: 'tsk_002', ownerId: null, rank: 7 } },
      { ord: 9, doc: { id: 'tsk_003' } },
    ]);
    expect('completedAt' in rows[1].doc).toBe(false);
    expect('ownerId' in rows[1].doc && rows[1].doc.ownerId === null).toBe(true);
  });

  it('gives the keys in the order of jsonb (the shorter name first, then by bytes), as the object form gave them', async () => {
    const src = sqlSource(answering([{ ord: '1', doc: [0, 'a-long-name', 'id', 'ab', 'b'] }]));
    const [row] = await src.select({ c: 'tasks', where: [], pick: ['zeta', 'id', 'ab', 'b'] });
    expect(Object.keys(row.doc)).toEqual(['b', 'ab', 'id', 'zeta']);
    expect(row.doc).toEqual({ zeta: 'a-long-name', id: 'id', ab: 'ab', b: 'b' });
  });

  it('reads the mask of a pick of 50 keys without losing the last bit', async () => {
    const pick = Array.from({ length: 50 }, (_, i) => `f${String(i).padStart(2, '0')}`);
    const mask = 2 ** 49 + 1;
    const src = sqlSource(answering([{ ord: '1', doc: [mask, ...pick.map((_, i) => i)] }]));
    const [row] = await src.select({ c: 'tasks', where: [], pick });
    expect(Object.keys(row.doc)).toHaveLength(48);
    expect('f00' in row.doc).toBe(false);
    expect('f49' in row.doc).toBe(false);
    expect(row.doc.f48).toBe(48);
  });

  it('gives a doc of the object form (a pick of more than 50 keys, or an empty pick) as the database sent it', async () => {
    const pick = Array.from({ length: 51 }, (_, i) => `f${i}`);
    const wide = sqlSource(answering([{ ord: '1', doc: { f0: 1, f7: 2 } }]));
    expect((await wide.select({ c: 'tasks', where: [], pick }))[0].doc).toEqual({ f0: 1, f7: 2 });
    const none = sqlSource(answering([{ ord: '1', doc: {} }]));
    expect((await none.select({ c: 'tasks', where: [], pick: [] }))[0].doc).toEqual({});
  });
});

describe('the unread counts and the task threads of the badge (DB-6)', () => {
  const bounds = { col: 'target_id', by: { tsk_001: { gt: '' }, tsk_002: { gt: '2026-10-01', ge: '2026-10-02', after: { at: '2026-10-03', id: 'cmt_009' } } } };
  const unread: CountSelect = { c: 'comments', per: 'target_id', where: [{ col: 'target_type', eq: 'task' }, { bounds }, { field: 'authorId', notIn: ['usr_001'] }] };

  it('counts each key in a LATERAL subquery on the key, so each key reads its own rows on the index (DB-5 of perf2)', () => {
    const { text, values } = countSql(unread);
    expect(text).toBe(
      'select b.k as v, x.n from jsonb_to_recordset($1::jsonb) as b(k text, gt text, ge text, aat text, aid text) '
        + 'cross join lateral (select count(*)::integer as n from comments t where t.target_id = b.k and t.target_type = $2::text and '
        + '(t.created_at collate "C" > b.gt collate "C" and (b.ge is null or t.created_at collate "C" >= b.ge collate "C") '
        + 'and (b.aat is null or t.created_at collate "C" > b.aat collate "C" or (t.created_at = b.aat and t.id collate "C" > b.aid collate "C"))) '
        + `and (t.doc->>'authorId' is null or not (t.doc->>'authorId' = any($3::text[])))) x where x.n > 0`,
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
    await sqlSource(q).threads({ owner: 'usr_005', led: [], me: ['usr_005'], limit: 100, admin: false, seen: ['prj_005'] });
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

describe('several reads in one statement (SV-10 of perf2)', () => {
  const chatReads: Select = { c: 'chatReads', where: [{ col: 'id', in: ['cr_1', 'cr_2'] }] };
  const picked: Select = { c: 'tasks', where: [{ col: 'id', in: ['tsk_001'] }], pick: ['id', 'ownerId'] };
  const unread: CountSelect = { c: 'messages', per: 'conversation_id', where: [{ bounds: { col: 'conversation_id', by: { cnv_001: { gt: '' } } } }] };
  const threads = { owner: 'usr_001', led: ['prj_001'], me: ['usr_001'], limit: 30, admin: false, seen: ['prj_001'] };
  const reads: Read[] = [{ select: chatReads }, { select: picked }, { count: unread }, { threads }];

  /** A Query that writes down what it gets and answers with the rows given. */
  function recording(answer: unknown[] = []) {
    const sent: { text: string; values: unknown[] }[] = [];
    const q: Query = async <R,>(text: string, values: unknown[] = []) => {
      sent.push({ text, values });
      return answer as R[];
    };
    return { sent, q };
  }

  it('joins the reads with union all, one tag for each read, and numbers the values of each read after the values before it', () => {
    const { text, values } = batchSql(reads);
    expect(text.match(/ union all /g)).toHaveLength(3);
    expect(text).toMatch(/^select u\.i, jsonb_agg\(u\.j order by u\.o\) as j from \([\s\S]*\) u group by u\.i order by u\.i$/);
    const sizes = [selectSql(chatReads).values, selectSql(picked).values, countSql(unread).values, [0, 0, 0, 0, 0, 0]].map((one) => one.length);
    expect(values).toHaveLength(sizes.reduce((a, b) => a + b, 0));
    // The values of the first two selects and the count come first, in the order of the reads.
    expect(values.slice(0, 1)).toEqual(selectSql(chatReads).values.slice(0, 1));
    expect(values.slice(sizes[0], sizes[0] + sizes[1])).toEqual(selectSql(picked).values);
    // Every number up to the last one is used, and no text holds a value.
    const used = new Set([...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    expect([...used].sort((a, b) => a - b)).toEqual(values.map((_, i) => i + 1));
    expect(text).not.toContain('cr_1');
    expect(text).not.toContain('usr_001');
  });

  it('sends one statement for several reads and gives each read its own answer, in the order of the reads', async () => {
    const { sent, q } = recording([
      { i: 0, j: [[3, { id: 'cr_1' }], [8, { id: 'cr_2' }]] },
      { i: 1, j: [[1, [0, 'tsk_001', null]]] },
      { i: 2, j: [['cnv_001', 4], [null, 9]] },
      { i: 3, j: [['tsk_005', '2026-10-02T10:00:00.000+03:00', null], ['tsk_002', '2026-10-01T10:00:00.000+03:00', 'x']] },
    ]);
    const answers = await sqlSource(q).batch!(reads);
    expect(sent).toHaveLength(1);
    expect(answers[0]).toEqual([{ ord: 3, doc: { id: 'cr_1' } }, { ord: 8, doc: { id: 'cr_2' } }]);
    expect(answers[1]).toEqual([{ ord: 1, doc: { id: 'tsk_001', ownerId: null } }]);
    expect(answers[2]).toEqual(new Map([['cnv_001', 4]]));
    expect(answers[3]).toEqual([
      { id: 'tsk_005', last: '2026-10-02T10:00:00.000+03:00', mine: null }, { id: 'tsk_002', last: '2026-10-01T10:00:00.000+03:00', mine: 'x' },
    ]);
  });

  it('gives an empty answer to a read that has no row in the answer of the statement', async () => {
    const { q } = recording([{ i: 1, j: [['cnv_001', 2]] }]);
    const answers = await sqlSource(q).batch!([{ select: chatReads }, { count: unread }, { threads }]);
    expect(answers).toEqual([[], new Map([['cnv_001', 2]]), []]);
  });

  it('keeps the plain statement of a batch of one read, and sends nothing for reads that match nothing', async () => {
    const one = recording();
    await sqlSource(one.q).batch!([{ select: chatReads }, { select: { c: 'tasks', where: [{ col: 'id', in: [] }] } }]);
    expect(one.sent).toEqual([{ text: selectSql(chatReads).text, values: selectSql(chatReads).values }]);
    const none = recording();
    const answers = await sqlSource(none.q).batch!([{ select: { c: 'tasks', where: [{ col: 'id', in: [] }] } }, { count: { ...unread, where: [{ col: 'conversation_id', in: [] }] } }]);
    expect(none.sent).toEqual([]);
    expect(answers).toEqual([[], new Map()]);
  });

  it('puts the order of a thread read in its own row number, so the union cannot change it', () => {
    expect(batchSql([{ select: chatReads }, { threads }]).text).toContain('row_number() over (order by x.last collate "C" desc, x.id collate "C" desc)');
  });
});
