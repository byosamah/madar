import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bodySearchText } from '../../src/lib/searchMatch';
import type { Select } from '../data/loaders/query';
import { selectSql } from '../data/loaders/sqlSource';
import { grantServerRole } from '../test/global-setup';
import { applyMigrations, dropSchema, localClient } from './migrate';

/**
 * The folded search columns of messages and comments (chat design 2026-10-19, item 16; migration 20261020000100_message_search.sql).
 * This suite writes growth data into its own schema, and asks Postgres for the plan of the loader reads of the message search, as
 * madar_server under RLS. A plan that stops using its trigram index fails here, and so does a fold in SQL that differs from the fold
 * in TypeScript. It needs the local stack and the Docker lock.
 *
 * The tables hold 30,000 rows each: a small table makes Postgres prefer a scan over the index (checked on a throwaway Postgres 17
 * with 6,000 rows for the comments, where the plan read every row).
 */

type Node = { 'Node Type': string; 'Index Name'?: string; 'Relation Name'?: string; Plans?: Node[] };

function nodesOf(node: Node): Node[] {
  return [node, ...(node.Plans ?? []).flatMap(nodesOf)];
}

const GROWTH = `
create function pid(prefix text, n bigint) returns text language sql immutable as $$ select prefix || '_' || lpad(n::text, greatest(3, length(n::text)), '0') $$;
create function stamp(ts timestamptz) returns text language sql immutable as $$ select to_char(ts at time zone 'Asia/Riyadh', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || '+03:00' $$;
insert into messages (id, doc, search_text)
select pid('msg', i), jsonb_build_object('id', pid('msg', i), 'body', b, 'conversationId', pid('cnv', 1 + i % 100),
  'createdAt', stamp(timestamptz '2026-06-01 09:00+03' + ((i * 35) % 150000 || ' minutes')::interval)), search_fold(b)
from (select i, case when i % 1000 = 0 then 'The riser moved ' || i when i % 2000 = 1 then 'أسعار المواد ' || i else 'Message about the slab number ' || i end as b
  from generate_series(1, 30000) i) x;
insert into comments (id, doc, project_id, search_text)
select pid('cmt', i), jsonb_build_object('id', pid('cmt', i), 'body', b, 'targetType', 'task', 'targetId', pid('tsk', 1 + (i * 7919) % 1000),
  'createdAt', stamp(timestamptz '2026-06-01 09:00+03' + ((i * 37) % 150000 || ' minutes')::interval)), pid('prj', 1 + i % 50), search_fold(b)
from (select i, case when i % 1000 = 0 then 'Check the riser ' || i when i % 2000 = 1 then 'أسعار المواد ' || i else 'Check item ' || i end as b
  from generate_series(1, 30000) i) x;
analyze messages;
analyze comments;
`;

/** The fold in SQL must give the fold of bodySearchText for each of these bodies. */
const SAMPLES = [
  'The RISER  moved to Level 2. ',
  'أسعارُ المـواد إلى آخرها ٱلله مدرسةٌ في الخُبَر على ملعبى',
  'الأرقام ١٢٣٤٥ و ٦٧٨٩٠ و 123',
  'Ask @[Reem Al-Qahtani](usr_003) and @[سارة](usr_1004) about the fee.',
  'tab\there\nnew line\r\nand\vvertical\fform feed',
  'Emoji 👍 and ✅ and 👀 stay. Ｆｕｌｌ ｗｉｄｔｈ ＡＢＣ ﬁ ligature ㎏ ①',
  `${'x'.repeat(10)} ${'ب'.repeat(3990)}`,
  '        　﻿ middle 　end　',
  '@[a](usr_003)@[b](usr_004) and @[Not a user](tsk_003) and @[x] (usr_003)',
  '',
  '   ',
  'ً ٌ ٍ َ ُ ِ ّ ْ ٰ كتـــاب',
  'عبد‌الله and zero​width',
];

describe('the folded search columns on growth data', () => {
  const schema = `madar_find_${process.pid}`;
  let db: pg.Client;
  let granted = false;

  beforeAll(async () => {
    db = await localClient();
    await applyMigrations(db, schema);
    await db.query(`set search_path to ${schema}`);
    await db.query(GROWTH);
    granted = await grantServerRole(db);
  }, 180_000);

  afterAll(async () => {
    if (!db) return;
    if (granted) await db.query('revoke madar_server from current_user');
    await dropSchema(db, schema);
    await db.end();
  });

  async function planOf(select: Select): Promise<Node[]> {
    const { text, values } = selectSql(select);
    await db.query('begin');
    try {
      await db.query('set local role madar_server');
      const { rows } = await db.query(`explain (format json) ${text}`, values);
      return nodesOf((rows[0]['QUERY PLAN'] as { Plan: Node }[])[0].Plan);
    } finally {
      await db.query('rollback');
    }
  }

  const uses = (nodes: Node[], index: string) => nodes.some((n) => n['Index Name'] === index);
  const scans = (nodes: Node[], table: string) => nodes.some((n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === table);
  const chats = Array.from({ length: 100 }, (_, i) => `cnv_${String(i + 1).padStart(3, '0')}`);
  const projects = Array.from({ length: 50 }, (_, i) => `prj_${String(i + 1).padStart(3, '0')}`);

  it('makes the two trigram indexes', async () => {
    const { rows } = await db.query('select indexname from pg_indexes where schemaname = $1', [schema]);
    expect(rows.map((row) => row.indexname)).toEqual(expect.arrayContaining(['messages_search', 'comments_search']));
  });

  it('gives Arabic text its trigrams (the locale of the database)', async () => {
    const { rows } = await db.query('select extensions.show_trgm($1) as t', ['اسعار المواد']);
    expect(rows[0].t.length).toBeGreaterThan(4);
  });

  it('reads a message search on messages_search, with no scan of every message', async () => {
    for (const word of ['riser', 'اسعار']) {
      const nodes = await planOf({
        c: 'messages', where: [{ col: 'conversation_id', in: chats }, { col: 'search_text', contains: word }],
        order: { col: 'created_at', desc: true, id: true }, limit: 5,
      });
      expect(uses(nodes, 'messages_search'), word).toBe(true);
      expect(scans(nodes, 'messages'), word).toBe(false);
    }
  });

  it('reads a comment search on comments_search, with no scan of every comment', async () => {
    for (const word of ['riser', 'اسعار']) {
      const nodes = await planOf({
        c: 'comments', where: [{ col: 'target_type', in: ['task'] }, { col: 'project_id', in: projects }, { col: 'search_text', contains: word }],
        order: { col: 'created_at', desc: true, id: true }, limit: 5,
      });
      expect(uses(nodes, 'comments_search'), word).toBe(true);
      expect(scans(nodes, 'comments'), word).toBe(false);
    }
  });

  it('finds the rows of a word and gives a typed % or _ no wildcard power', async () => {
    const { text, values } = selectSql({ c: 'messages', where: [{ col: 'search_text', contains: 'riser' }], order: { col: 'created_at', desc: true, id: true }, limit: 100 });
    expect((await db.query(text, values)).rows).toHaveLength(30);
    for (const wild of ['%', '_', 'ris_r', '%%%']) {
      const wildcard = selectSql({ c: 'messages', where: [{ col: 'search_text', contains: wild }], limit: 100 });
      expect((await db.query(wildcard.text, wildcard.values)).rows, wild).toHaveLength(0);
    }
  });

  it('folds a body in SQL as bodySearchText does in TypeScript', async () => {
    for (const body of SAMPLES) expect((await db.query('select search_fold($1) as f', [body])).rows[0].f, body).toBe(bodySearchText(body));
  });
});
