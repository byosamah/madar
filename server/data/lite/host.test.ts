import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { nodeHost } from './host';
import { EXPECTED_CHECKS, hostChecks } from './hostChecks';

describe('the node:sqlite host (server/data/lite/host.ts)', () => {
  it('refuses what the office object refuses, and keeps its transactions as the office object does', async () => {
    expect(await hostChecks(nodeHost(new DatabaseSync(':memory:')))).toEqual(EXPECTED_CHECKS);
  });

  it('runs a statement with values and gives plain rows back', () => {
    const host = nodeHost(new DatabaseSync(':memory:'));
    host.exec('create table t (id text primary key, n integer)', []);
    host.exec('insert into t values (?, ?)', ['a', 1]);
    const { rows } = host.exec('select id, n from t', []);
    expect(rows).toEqual([{ id: 'a', n: 1 }]);
    expect(Object.getPrototypeOf(rows[0])).toBe(Object.prototype);
  });

  it('gives the rows of a write with returning, and counts no rows', () => {
    const host = nodeHost(new DatabaseSync(':memory:'));
    host.exec('create table t (id integer primary key, kind text)', []);
    expect(host.exec('insert into t (kind) values (?) returning id', ['x'])).toEqual({ rows: [{ id: 1 }], rowsRead: 0, rowsWritten: 0 });
    expect(host.counts).toBe(false);
  });

  it('writes each statement that it runs to the log, when the caller gives one', () => {
    const log: string[] = [];
    const host = nodeHost(new DatabaseSync(':memory:'), { log });
    host.exec('select 1 as one', []);
    expect(log).toEqual(['select 1 as one']);
  });
});
