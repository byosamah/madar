import { describe, expect, it } from 'vitest';
// The usage.limitWarning handler: the entries register it through server/usage/meter.ts, this test on its own.
import './effects';
import { buildSeed } from '../../src/data/seed';
import { usageGet, usageRetryEffect } from '../calls/usage';
import { snapshotOf } from '../data/officeCache';
import { freshLite } from '../data/lite/testDb';
import { liteWriteState } from '../data/lite/whole';
import { fakeDeps } from '../test/fakes/deps';
import { DAY_LIMITS, checkDayLimits, checkLimits } from './warn';

const NOW = new Date('2026-10-04T06:00:00Z');

async function office() {
  const lite = await freshLite();
  const seed = await buildSeed('2026-10-04', async () => undefined);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const deps = fakeDeps({ db: lite.db, config: { fileStore: 'r2' } });
  deps.clock.set(NOW);
  const ctx = (userId: string) => ({ deps, principal: { userId }, office: snapshotOf(seed, 1), batch: { storyRefs: new Map(), overviewCalls: 0 }, now: NOW });
  return { ...lite, seed, deps, ctx };
}

describe('the usage meters on SQLite (server/usage)', () => {
  it('gives the Admin every meter: the month counts, the size of the database and the bytes of every file version', async () => {
    const { db, seed, ctx } = await office();
    await db.statement('write', "insert into usage_month (month, calls, bytes_read) values ('2026-10', 12, 3400)");
    const bytes = Object.values(seed.files).flatMap((f) => f.versions).reduce((sum, v) => sum + v.size, 0);
    const { output } = await usageGet({}, ctx('usr_001'));
    expect(output).toMatchObject({ month: '2026-10', calls: { used: 12 }, egress: { used: 3400 }, files: { used: bytes }, failedEffects: [], jobsLastRun: null });
    expect(output.database.used).toBeGreaterThan(0);
  });

  it('refuses a person who is not the Admin', async () => {
    const { ctx } = await office();
    await expect(usageGet({}, ctx('usr_002'))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lists a failed effect, and a Retry gives it a new start', async () => {
    const { db, deps, ctx } = await office();
    await db.statement('write', "insert into outbox (kind, payload, attempts, error, created_at) values ('test.none', '{}', 5, 'It failed.', ?1)", [NOW.toISOString()]);
    const { output } = await usageGet({}, ctx('usr_001'));
    expect(output.failedEffects).toEqual([{ id: '1', kind: 'test.none', error: 'It failed.', attempts: 5, createdAt: '2026-10-04T09:00:00.000+03:00' }]);
    expect((await usageRetryEffect({ id: '1' }, ctx('usr_001'))).output).toEqual({ retried: true });
    expect(await db.statement('read', 'select attempts from outbox where id = 1')).toEqual([{ attempts: 1 }]);
    expect(deps.logs.some((line) => line.message.startsWith('An effect after the commit failed'))).toBe(true);
  });

  it('warns each active Admin once a day when a day meter reaches 80%', async () => {
    const { db, deps } = await office();
    await db.statement('write', "insert into usage_day (day, rows_written) values ('2026-10-04', ?1)", [DAY_LIMITS.rowsWrittenDay * 0.8]);
    expect(await checkDayLimits(deps, NOW)).toEqual({ warned: ['rowsWrittenDay'] });
    expect(await checkDayLimits(deps, NOW)).toEqual({ warned: [] });
    expect(deps.mail.sent.map((m) => m.idempotencyKey)).toEqual(['limit-warning-2026-10-04-rowsWrittenDay-usr_001']);
  });

  it('warns about a month meter on SQLite as on Postgres', async () => {
    const { db, deps } = await office();
    await db.statement('write', "insert into usage_month (month, calls) values ('2026-10', ?1)", [500_000]);
    expect((await checkLimits(deps)).warned).toEqual(['calls']);
  });
});
