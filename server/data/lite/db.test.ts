import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { Query } from '../../core/ports';
import { isLite } from '../dialect';
import { bindOf, liteDb, liteDbOf, onCommit, wroteIn } from './db';
import { nodeHost } from './host';

function fresh() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('create table t (id text primary key, doc text not null, n integer)');
  return liteDb(nodeHost(raw));
}

describe('the SQLite Db (server/data/lite/db.ts)', () => {
  it('commits a write transaction and gives a JSON column back as a value', async () => {
    const db = fresh();
    await db.tx('write', (q) => q('insert into t (id, doc, n) values (?, ?, ?)', ['a', { x: 1 }, 2]));
    expect(await db.statement('read', 'select id, doc, n from t')).toEqual([{ id: 'a', doc: { x: 1 }, n: 2 }]);
  });

  it('rolls back every statement of a transaction that throws, and runs no work of onCommit', async () => {
    const db = fresh();
    let ran = false;
    await expect(db.tx('write', async (q) => {
      await q('insert into t (id, doc) values (?, ?)', ['a', '{}']);
      onCommit(q, () => {
        ran = true;
      });
      throw new Error('stop');
    })).rejects.toThrow('stop');
    expect(await db.statement('read', 'select id from t')).toEqual([]);
    expect(ran).toBe(false);
  });

  it('runs the work of onCommit after the commit, in order', async () => {
    const db = fresh();
    const order: string[] = [];
    await db.tx('write', async (q) => {
      onCommit(q, () => order.push('first'));
      onCommit(q, () => order.push('second'));
      order.push('work');
    });
    expect(order).toEqual(['work', 'first', 'second']);
  });

  it('refuses a second transaction while one is open (two saves at one time)', async () => {
    const db = fresh();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = db.tx('write', async (q) => {
      await q('insert into t (id, doc) values (?, ?)', ['a', '{}']);
      await gate;
    });
    await expect(db.tx('write', async () => undefined)).rejects.toThrow('a SQLite transaction is open already');
    release();
    await first;
    expect(await db.statement('read', 'select id from t')).toEqual([{ id: 'a' }]);
  });

  it('refuses a write inside a read transaction', async () => {
    const db = fresh();
    await expect(db.tx('read', (q) => q('insert into t (id, doc) values (?, ?)', ['a', '{}']))).rejects.toThrow('A read transaction refuses a write');
  });

  it('refuses a statement inside a transaction, and a query after its transaction ended', async () => {
    const db = fresh();
    let kept: Query | undefined;
    await db.tx('read', async (q) => {
      kept = q;
      await expect(db.statement('read', 'select 1 as one')).rejects.toThrow('db.statement runs with no open transaction');
    });
    await expect(kept!('select 1 as one')).rejects.toThrow('a transaction that ended');
  });

  it('refuses a schema statement: the schema step owns the tables', async () => {
    const db = fresh();
    await expect(db.statement('write', 'create table x (id text)')).rejects.toThrow('refuses a schema statement');
  });

  it('binds true, false, undefined, a Date, a list and an object as SQLite values', () => {
    expect([true, false, undefined, null, new Date('2026-10-17T00:00:00Z'), ['a'], { b: 1 }, 3, 'x'].map(bindOf)).toEqual(
      [1, 0, null, null, '2026-10-17T00:00:00.000Z', '["a"]', '{"b":1}', 3, 'x'],
    );
  });

  it('marks its queries as SQLite, names its Db by the query, and knows when a transaction wrote', async () => {
    const db = fresh();
    expect(isLite(db)).toBe(true);
    await db.tx('write', async (q) => {
      expect(isLite(q)).toBe(true);
      expect(liteDbOf(q)).toBe(db);
      expect(wroteIn(q)).toBe(false);
      await q('insert into t (id, doc) values (?, ?)', ['a', '{}']);
      expect(wroteIn(q)).toBe(true);
    });
  });
});
