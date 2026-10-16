// What the two counters count, on small tables: an insert, an update and a delete with 0, 1, 2 and 3 indexes, in three table
// forms, and the reads of a key lookup, an index range and a scan. It settles whether each index entry counts as a row written.

const FORMS = {
  rowid: (t) => `create table ${t} (id text primary key, doc text, a text, b text, c text)`,
  norowid: (t) => `create table ${t} (id text primary key not null, doc text, a text, b text, c text) without rowid`,
  intpk: (t) => `create table ${t} (rid integer primary key, id text, doc text, a text, b text, c text)`,
};

export function matrix(sql) {
  const one = (text, ...args) => {
    const cursor = sql.exec(text, ...args);
    const rows = cursor.toArray();
    return { rows: rows.length, read: cursor.rowsRead, written: cursor.rowsWritten };
  };
  const out = { writes: {}, reads: {}, other: {} };
  for (const [form, make] of Object.entries(FORMS)) {
    for (let k = 0; k <= 3; k++) {
      const t = `m_${form}_${k}`;
      one(`drop table if exists ${t}`);
      one(make(t));
      ['a', 'b', 'c'].slice(0, k).forEach((col) => one(`create index ${t}_${col} on ${t} (${col})`));
      const ins = (id) => (form === 'intpk' ? one(`insert into ${t} (id, doc, a, b, c) values (?, ?, ?, ?, ?)`, id, '{}', `a${id}`, `b${id}`, `c${id}`) : one(`insert into ${t} (id, doc, a, b, c) values (?, ?, ?, ?, ?)`, id, '{}', `a${id}`, `b${id}`, `c${id}`));
      const key = form === 'intpk' ? 'rid' : 'id';
      const first = ins('r001');
      for (let i = 2; i <= 100; i++) ins(`r${String(i).padStart(3, '0')}`);
      const where = form === 'intpk' ? 'rid = 50' : "id = 'r050'";
      out.writes[`${form}, ${k} index`] = {
        insert: first.written,
        'update doc only': one(`update ${t} set doc = '{"x":1}' where ${where}`).written,
        'update a (indexed when k >= 1)': one(`update ${t} set a = 'new' where ${where}`).written,
        'update a to the same value': one(`update ${t} set a = 'new' where ${where}`).written,
        'update a, b, c': one(`update ${t} set a = 'x', b = 'y', c = 'z' where ${where}`).written,
        'upsert of a row that exists (doc only)': form === 'intpk' ? null : one(`insert into ${t} (id, doc, a, b, c) values ('r051', '{}', 'a', 'b', 'c') on conflict (id) do update set doc = excluded.doc`).written,
        delete: one(`delete from ${t} where ${where}`).written,
      };
      if (k === 3) {
        out.reads[form] = {
          'lookup by key': one(`select * from ${t} where ${key} = ${form === 'intpk' ? 60 : "'r060'"}`).read,
          'lookup by key, no row': one(`select * from ${t} where ${key} = ${form === 'intpk' ? 6000 : "'zzz'"}`).read,
          'lookup on a secondary index (1 row)': one(`select * from ${t} where b = 'br070'`).read,
          'index range of 10 rows': one(`select * from ${t} where b >= 'br080' and b < 'br090'`).read,
          'covering index range of 10 rows (b only)': one(`select b from ${t} where b >= 'br080' and b < 'br090'`).read,
          'scan with a filter that matches 1 row (no index on doc)': one(`select * from ${t} where doc = '{"x":1}'`).read,
          'count(*)': one(`select count(*) from ${t}`).read,
          'in-list of 5 keys by json_each': one(`select * from ${t} where ${key} in (select value from json_each(?))`, JSON.stringify(form === 'intpk' ? [61, 62, 63, 64, 65] : ['r061', 'r062', 'r063', 'r064', 'r065'])).read,
          'in-list of 5 keys by bound values': one(`select * from ${t} where ${key} in (?, ?, ?, ?, ?)`, ...(form === 'intpk' ? [61, 62, 63, 64, 65] : ['r061', 'r062', 'r063', 'r064', 'r065'])).read,
          'order by key desc limit 5': one(`select * from ${t} order by ${key} desc limit 5`).read,
          'order by doc limit 5 (a sort of every row)': one(`select * from ${t} order by doc limit 5`).read,
        };
      }
    }
  }
  // Generated columns: the doc changes in a field that no index reads. Does SQLite still write every index on a generated column?
  one('drop table if exists m_gen');
  one("create table m_gen (id text primary key, doc text, a text generated always as (json_extract(doc, '$.a')) virtual, b text generated always as (json_extract(doc, '$.b')) virtual, c text generated always as (json_extract(doc, '$.c')) stored)");
  ['a', 'b', 'c'].forEach((col) => one(`create index m_gen_${col} on m_gen (${col})`));
  out.other['generated columns (2 virtual, 1 stored), 3 indexes: insert'] = one(`insert into m_gen (id, doc) values ('g1', '{"a":"1","b":"2","c":"3","note":"x"}')`).written;
  out.other['generated columns: update doc, only an unindexed field changes'] = one(`update m_gen set doc = '{"a":"1","b":"2","c":"3","note":"y"}' where id = 'g1'`).written;
  // A partial index: a row outside it, and a row inside it.
  one('drop table if exists m_part');
  one('create table m_part (id text primary key, done integer, at text)');
  one('create index m_part_open on m_part (at) where done is null');
  out.other['partial index, insert of a row outside it'] = one("insert into m_part values ('p1', 1, 'x')").written;
  out.other['partial index, insert of a row inside it'] = one("insert into m_part values ('p2', null, 'x')").written;
  out.other['partial index, update that moves the row out of it'] = one("update m_part set done = 1 where id = 'p2'").written;
  // An index build on a table that already holds 100 rows.
  one('create table if not exists m_build (id text primary key, a text)');
  for (let i = 0; i < 100; i++) one('insert into m_build values (?, ?)', `b${i}`, `a${i}`);
  const build = one('create index m_build_a on m_build (a)');
  out.other['create index on 100 rows: rows read, rows written'] = [build.read, build.written];
  // The limit of bound values in one statement.
  try {
    const args = Array.from({ length: 150 }, (_, i) => `r${i}`);
    one(`select * from m_rowid_3 where id in (${args.map(() => '?').join(', ')})`, ...args);
    out.other['150 bound values in one statement'] = 'accepted';
  } catch (error) {
    out.other['150 bound values in one statement'] = `refused: ${error.message}`;
  }
  try {
    const args = Array.from({ length: 100 }, (_, i) => `r${i}`);
    one(`select * from m_rowid_3 where id in (${args.map(() => '?').join(', ')})`, ...args);
    out.other['100 bound values in one statement'] = 'accepted';
  } catch (error) {
    out.other['100 bound values in one statement'] = `refused: ${error.message}`;
  }
  for (const t of sql.exec("select name from sqlite_master where type = 'table' and name like 'm_%'").toArray()) sql.exec(`drop table "${t.name}"`);
  return out;
}
