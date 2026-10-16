// The proof of the counters: a tiny table, 3 rows in, 3 rows out, and both counters of each cursor.
export function proof(sql) {
  const out = {};
  const run = (label, text, ...args) => {
    const cur = sql.exec(text, ...args);
    const rows = cur.toArray();
    out[label] = { rows: rows.length, rowsRead: cur.rowsRead, rowsWritten: cur.rowsWritten };
    return rows;
  };
  run('drop', 'drop table if exists tiny');
  run('create', 'create table tiny (id text primary key, v integer)');
  run('insert3', "insert into tiny (id, v) values ('a', 1), ('b', 2), ('c', 3)");
  run('selectAll', 'select * from tiny');
  run('selectOne', "select * from tiny where id = 'b'");
  run('count', 'select count(*) as n from tiny');
  run('updateOne', "update tiny set v = 9 where id = 'c'");
  run('deleteOne', "delete from tiny where id = 'a'");
  // The size of one value: the snapshot needs to know where a row stops (the limits page names 2 MB).
  run('big', 'create table if not exists big (id integer primary key, body text)');
  for (const mb of [1.5, 2.5]) {
    try {
      run(`insert ${mb} MB`, 'insert or replace into big (id, body) values (1, ?)', 'x'.repeat(mb * 1_000_000));
    } catch (error) {
      out[`insert ${mb} MB`] = `refused: ${error.message}`;
    }
  }
  run('read the big row', 'select length(body) as n from big');
  run('drop big', 'drop table big');
  out.databaseSize = sql.databaseSize;
  return out;
}
