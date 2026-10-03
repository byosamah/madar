import type { PoolClient } from 'pg';
import { notBuiltAsync } from '../core/notBuilt';
import type { Db } from '../core/ports';

/**
 * Two pg pools (writes and reads), each max 1, with set local timeouts and no nested transaction (plan 4.5, Connections).
 * callerClient is only for the D1 harness. Track C1 replaces this stub.
 */
export function pgDb(_urls: { writeUrl: string; readUrl: string; ca?: string }, _o: { callerClient?: PoolClient } = {}): Db {
  return {
    tx: () => notBuiltAsync('The database'),
    savepoint: () => notBuiltAsync('The database'),
    statement: () => notBuiltAsync('The database'),
  };
}
