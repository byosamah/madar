// The probe object of scripts/proof/do-tx (exit plan, wave 1 Task 1). Each route answers one open question of the plan.
import { DurableObject } from 'cloudflare:workers';
import { allowed } from './guard.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Office extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('create table if not exists log (n integer primary key, who text not null)');
    ctx.storage.sql.exec('create table if not exists r (id text primary key)');
  }

  /** (a) A transaction closure that writes, awaits, writes again and then throws: are its rows gone? */
  async rollback() {
    const sql = this.ctx.storage.sql;
    let error = 'none';
    try {
      await this.ctx.storage.transaction(async () => {
        sql.exec("insert into r values ('a')");
        await Promise.resolve();
        sql.exec("insert into r values ('b')");
        throw new Error('stop');
      });
    } catch (e) {
      error = e.message;
    }
    return { error, rows: sql.exec('select id from r order by id').toArray().map((row) => row.id) };
  }

  /** (b) and (c): a transaction that awaits microtasks or a timer. poke() comes in from a second request meanwhile. */
  async hold(who, kind, fail) {
    const sql = this.ctx.storage.sql;
    try {
      await this.ctx.storage.transaction(async () => {
        sql.exec('insert into log (who) values (?)', `${who}:start`);
        for (let i = 0; i < 20; i++) await (kind === 'timer' ? wait(2) : Promise.resolve());
        sql.exec('insert into log (who) values (?)', `${who}:end`);
        if (fail) throw new Error('stop');
      });
    } catch {
      // The log shows what the rollback kept.
    }
    return sql.exec('select who from log order by n').toArray().map((row) => row.who);
  }

  /** The whole log after the race: a poke that ran after the transaction shows here, one that joined a rolled-back one does not. */
  readLog() {
    return this.ctx.storage.sql.exec("select who from log order by n").toArray().map((row) => row.who);
  }

  poke(who) {
    this.ctx.storage.sql.exec('insert into log (who) values (?)', who);
    return true;
  }

  /** (d) to (h): the counters of a rolled-back write, and the SQL forms that the plan uses. */
  features() {
    const sql = this.ctx.storage.sql;
    const one = (text, ...values) => {
      try {
        const cursor = sql.exec(text, ...values);
        const rows = cursor.toArray();
        return { ok: true, rows, read: cursor.rowsRead, written: cursor.rowsWritten };
      } catch (e) {
        return { ok: false, error: String(e.message).slice(0, 120) };
      }
    };
    let rolledBackWritten = -1;
    try {
      this.ctx.storage.transactionSync(() => {
        const cursor = sql.exec("insert into r values ('z')");
        cursor.toArray();
        rolledBackWritten = cursor.rowsWritten;
        throw new Error('stop');
      });
    } catch {
      // Expected.
    }
    sql.exec('create table if not exists ev (id text primary key, seq integer)');
    sql.exec("create trigger if not exists ev_guard before update on ev begin select raise(abort, 'events only grow'); end");
    sql.exec('create index if not exists ev_seq on ev (seq)');
    return {
      rolledBackWritten,
      foreignKeys: one('pragma foreign_keys'),
      subsec: one("select unixepoch('2026-10-16T12:00:00.500+03:00', 'subsec') as s"),
      julian: one("select julianday('2026-10-16T12:00:00.500+03:00') > julianday('2026-10-16T09:00:00.499Z') as later"),
      numbered: one('select ?2 as a, ?1 as b', 'one', 'two'),
      dollar: one('select $1 as a', 'one'),
      boolean: one('select ? as b', true),
      indexedBy: one('select id from ev indexed by ev_seq where seq > ?', 0),
      insertWithTrigger: one("insert into ev values ('e1', 1)"),
      triggerRefuses: one("update ev set seq = 2 where id = 'e1'"),
      values100: one(`select ${Array.from({ length: 100 }, () => '?').join(', ')}`, ...Array(100).fill(1)),
      values101: one(`select ${Array.from({ length: 101 }, () => '?').join(', ')}`, ...Array(101).fill(1)),
      returning: one("insert into r values ('m'), ('k') returning id"),
      tableValuedPragma: one("select count(*) as n from pragma_table_info('r')"),
      sqliteMaster: one("select count(*) as n from sqlite_master where name = 'sqlite_stat1'"),
      missingTable: one('select version from schema_version where id = 1'),
      fullkey: one(`select l.fullkey from json_each('{"a":[{"b":1},"x"]}', '$.a') l`),
    };
  }
}

export default {
  async fetch(request, env) {
    // A deployed probe (wrangler.deployed.toml, exit wave 5 R8 (e)) answers only with its secret header.
    if (!allowed(request, env)) return new Response('not found', { status: 404 });
    const url = new URL(request.url);
    const stub = env.OFFICE.get(env.OFFICE.idFromName(url.searchParams.get('o') ?? 'probe'));
    if (url.pathname === '/rollback') return Response.json(await stub.rollback());
    if (url.pathname === '/features') return Response.json(await stub.features());
    if (url.pathname === '/race') {
      const kind = url.searchParams.get('kind');
      const fail = url.searchParams.get('fail') === '1';
      const holding = stub.hold('A', kind, fail);
      await wait(3);
      await stub.poke('B');
      const log = await holding;
      return Response.json({ kind, fail, log, after: await stub.readLog() });
    }
    return new Response('not found', { status: 404 });
  },
};
