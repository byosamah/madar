import { describe, expect, it } from 'vitest';
import type { Db, Query } from '../core/ports';
import { isLite, markLite, sqlFor } from './dialect';

const pgQuery: Query = async () => [];
const liteQuery: Query = markLite(async () => []);

describe('the dialect of a query or a Db (server/data/dialect.ts)', () => {
  it('names the Postgres text for a query that no SQLite Db made', () => {
    expect(isLite(pgQuery)).toBe(false);
    expect(sqlFor(pgQuery, 'select $1', 'select ?1')).toBe('select $1');
  });

  it('names the SQLite text for a query that a SQLite Db marked', () => {
    expect(isLite(liteQuery)).toBe(true);
    expect(sqlFor(liteQuery, 'select $1', 'select ?1')).toBe('select ?1');
  });

  it('reads the dialect of a Db from its field, and takes a Db with no field as Postgres', () => {
    const pg: Pick<Db, 'dialect'> = {};
    const lite: Pick<Db, 'dialect'> = { dialect: 'sqlite' };
    expect(sqlFor(pg, 'a', 'b')).toBe('a');
    expect(sqlFor(lite, 'a', 'b')).toBe('b');
  });
});
