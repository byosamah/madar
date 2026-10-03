import type { Db } from '../../core/ports';

/** A database that refuses every use, so a unit test never reaches a database by mistake. The db tests use the D1 harness. */
const refuse = () => Promise.reject(new Error('This test has no database. Use the db-mode harness for SQL.'));

export const noDb: Db = {
  tx: refuse,
  savepoint: refuse,
  statement: refuse,
};
