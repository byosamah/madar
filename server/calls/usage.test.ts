import { beforeAll, describe, expect, it } from 'vitest';
import { serverContracts } from '../../src/api/contract/server';
import { ApiError } from '../../src/api/errors';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import type { Db, Query } from '../core/ports';
import type { ServerCallCtx } from '../core/types';
import { snapshotOf } from '../data/officeCache';
import { SENT_TODAY_SQL } from '../mail/quota';
import { fakeDeps } from '../test/fakes/deps';
import { FAILED_EFFECTS_SQL, JOBS_LAST_RUN_SQL, METERS_SQL, SIGNALS_SQL } from '../usage/meters';
import { usageGet } from './usage';

/** usage.get (plan 4.11, 5.8; task M1), with the meter statements answered in memory. server/it/usage.it.test.ts runs the SQL. */

const NOW = new Date('2026-10-04T06:00:00Z');
let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

function readOnlyDb(): Db & { modes: string[] } {
  const modes: string[] = [];
  const q = (async (text: string) => {
    if (text === METERS_SQL) return [{ calls: '850', bytes_read: '0', backup_bytes: null, database_bytes: '1000', files_bytes: '900', emails_month: '3' }];
    if (text === SENT_TODAY_SQL) return [{ n: 2 }];
    if (text === FAILED_EFFECTS_SQL) return [{ id: '4', kind: 'mail.notice', error: 'Resend said no.', attempts: 2, created_at: new Date('2026-10-04T05:00:00Z'), payload: { notificationId: 'ntf_1' } }];
    if (text === SIGNALS_SQL || text === JOBS_LAST_RUN_SQL) return [];
    throw new Error(`Not a usage statement: ${text.slice(0, 60)}`);
  }) as Query;
  const refuse = () => Promise.reject(new Error('usage.get reads in one read transaction.'));
  return {
    modes,
    async tx(mode, work) {
      modes.push(mode);
      return work(q);
    },
    savepoint: refuse,
    statement: refuse,
  };
}

function ctxOf(userId: string, db: Db): ServerCallCtx {
  const deps = fakeDeps({ db });
  deps.clock.set(NOW);
  const principal = userId === 'usr_009' ? { userId, agent: { clientId: 'cli' } } : { userId };
  return { deps, principal, office: snapshotOf(seed, 1), batch: { storyRefs: new Map(), overviewCalls: 0 }, now: NOW };
}

describe('usage.get (plan 5.8)', () => {
  it('gives the Admin every meter, the failed effects without their payload and the job run, from one read transaction', async () => {
    const db = readOnlyDb();
    const { output, changed } = await usageGet({}, ctxOf('usr_001', db));
    expect(changed).toBe(false);
    expect(db.modes).toEqual(['read']);
    expect(output).toMatchObject({ month: '2026-10', calls: { used: 850, limit: 500_000 }, files: { used: 900, limit: 1024 * 1024 * 1024 }, emails: { used: 2, limit: 100 } });
    expect(output.failedEffects).toEqual([{ id: '4', kind: 'mail.notice', error: 'Resend said no.', attempts: 2, createdAt: '2026-10-04T08:00:00.000+03:00' }]);
    expect(JSON.stringify(output)).not.toContain('ntf_1');
    expect(() => serverContracts['usage.get'].output.parse(output)).not.toThrow();
  });

  it('refuses a Member and Management with forbidden, before any read', async () => {
    for (const userId of ['usr_002', 'usr_010']) {
      const db = readOnlyDb();
      const refused = await usageGet({}, ctxOf(userId, db)).then(() => null, (error: unknown) => error);
      expect(refused).toBeInstanceOf(ApiError);
      expect((refused as ApiError).code).toBe('forbidden');
      expect(db.modes).toEqual([]);
    }
  });

  it('lets an agent read with the rights of its person: the Admin\'s agent sees the meters', async () => {
    const { output } = await usageGet({}, ctxOf('usr_009', readOnlyDb()));
    expect(output.month).toBe('2026-10');
  });
});
