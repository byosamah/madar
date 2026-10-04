import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { serverContracts } from '../../src/api/contract/server';
import { ApiError } from '../../src/api/errors';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import type { Db, Query } from '../core/ports';
import type { ServerCallCtx } from '../core/types';
import { registerEffect } from '../core/effects';
import { snapshotOf } from '../data/officeCache';
import { memoryMailDb } from '../mail/memoryMailDb';
import { SENT_TODAY_SQL } from '../mail/quota';
import { fakeDeps } from '../test/fakes/deps';
import { FAILED_EFFECTS_SQL, JOBS_LAST_RUN_SQL, METERS_SQL, SIGNALS_SQL, STORAGE_PRESENT_SQL } from '../usage/meters';
import { RETRY_EFFECT_SQL, usageGet, usageRetryEffect } from './usage';

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
    if (text === STORAGE_PRESENT_SQL) return [{ present: false }];
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

  it('refuses every agent, also the Admin\'s agent, before any read (plan 5.6: usage.get is on the MCP deny list)', async () => {
    const db = readOnlyDb();
    const refused = await usageGet({}, ctxOf('usr_009', db)).then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).code).toBe('forbidden');
    expect(db.modes).toEqual([]);
  });
});

describe('usage.retryEffect (plan 4.12: one Retry for each failed effect)', () => {
  const undo: (() => void)[] = [];
  afterEach(() => {
    while (undo.length > 0) undo.pop()!();
  });

  /** An outbox in memory with one row of each state, and the reset statement of the Retry. */
  function outbox(o: { fails?: boolean } = {}) {
    const ran: Record<string, unknown>[] = [];
    undo.push(registerEffect('test.retry', async (payload) => {
      ran.push(payload);
      if (o.fails) throw new Error('Still away.');
    }));
    const mem = memoryMailDb((text, values) => {
      if (text !== RETRY_EFFECT_SQL) return undefined;
      const row = mem.outbox.find((r) => String(r.id) === values[0] && !r.done && r.error !== null);
      if (!row) return [];
      Object.assign(row, { attempts: 0, error: null, claimed: false });
      return [{ id: row.id }];
    });
    mem.outbox.push(
      { id: 1, kind: 'test.retry', payload: { n: 1 }, done: false, claimed: true, attempts: 5, error: 'Resend is away.' },
      { id: 2, kind: 'test.retry', payload: { n: 2 }, done: true, claimed: true, attempts: 1, error: null },
    );
    return { mem, ran };
  }

  it('sets the attempts of a failed row back to zero and runs it again after the commit', async () => {
    const { mem, ran } = outbox();
    const { output, changed } = await usageRetryEffect({ id: '1' }, ctxOf('usr_001', mem.db));
    expect([output, changed]).toEqual([{ retried: true }, false]);
    expect(ran).toEqual([{ n: 1 }]);
    expect(mem.outbox[0]).toMatchObject({ done: true, attempts: 1, error: null });
    expect(mem.statements.indexOf(RETRY_EFFECT_SQL)).toBeLessThan(mem.statements.findIndex((t) => t.startsWith('update outbox set claimed_until')));
  });

  it('keeps the new error when the effect fails again, so the line shows again with one try', async () => {
    const { mem } = outbox({ fails: true });
    expect((await usageRetryEffect({ id: '1' }, ctxOf('usr_001', mem.db))).output).toEqual({ retried: true });
    expect(mem.outbox[0]).toMatchObject({ done: false, attempts: 1, error: 'Still away.' });
  });

  it('changes nothing for a row that is done or not there, and says not_found', async () => {
    const { mem, ran } = outbox();
    for (const id of ['2', '99']) {
      const refused = await usageRetryEffect({ id }, ctxOf('usr_001', mem.db)).then(() => null, (error: unknown) => error);
      expect((refused as ApiError).code).toBe('not_found');
    }
    expect(mem.outbox[1]).toMatchObject({ done: true, attempts: 1 });
    expect(ran).toEqual([]);
  });

  it('refuses a Member, Management and every agent with forbidden, before any statement', async () => {
    for (const userId of ['usr_002', 'usr_010', 'usr_009']) {
      const { mem } = outbox();
      const refused = await usageRetryEffect({ id: '1' }, ctxOf(userId, mem.db)).then(() => null, (error: unknown) => error);
      expect((refused as ApiError).code).toBe('forbidden');
      expect(mem.statements).toEqual([]);
      expect(mem.outbox[0]).toMatchObject({ attempts: 5, error: 'Resend is away.' });
      undo.pop()!();
    }
  });
});
