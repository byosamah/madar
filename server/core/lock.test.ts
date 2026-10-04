import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import { fakeDeps } from '../test/fakes/deps';
import type { Query } from './ports';
import { LOCK_SQL, SLOW_LOCK_MS, busyOf, logLockHold, takeOfficeLock } from './lock';

const pgError = (code: string) => Object.assign(new Error('canceling statement due to lock timeout'), { code });

describe('the office lock (plan 4.5, step 5.2)', () => {
  it('takes the transaction advisory lock with the key of the office', async () => {
    const seen: [string, unknown[] | undefined][] = [];
    const q = (async (text: string, values?: unknown[]) => {
      seen.push([text, values]);
      return [];
    }) as Query;
    await takeOfficeLock(q, 7_310_001);
    expect(seen).toEqual([[LOCK_SQL, [7_310_001]]]);
    expect(LOCK_SQL).toContain('pg_advisory_xact_lock');
  });

  it('turns a lock timeout (55P03) into failed with the reason busy, and keeps any other error', async () => {
    const timeout = (async () => {
      throw pgError('55P03');
    }) as Query;
    const error = await takeOfficeLock(timeout, 1).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect([(error as ApiError).code, (error as ApiError).details.reason]).toEqual(['failed', 'busy']);

    const other = pgError('57014');
    const broken = (async () => {
      throw other;
    }) as Query;
    await expect(takeOfficeLock(broken, 1)).rejects.toBe(other);
    expect(busyOf(pgError('55P03'))?.details.reason).toBe('busy');
    expect(busyOf(other)).toBeUndefined();
  });

  it('logs how long a call held the lock, with the call name and the region, as a warning above 500 ms', () => {
    const deps = fakeDeps();
    logLockHold(deps, 'tasks.create', 12);
    logLockHold(deps, 'projects.delete', SLOW_LOCK_MS + 1);
    expect(deps.logs).toEqual([
      { level: 'info', message: 'The call held the office lock.', fields: { name: 'tasks.create', ms: 12, region: 'eu-central-1' } },
      { level: 'warn', message: 'The call held the office lock for a long time.', fields: { name: 'projects.delete', ms: SLOW_LOCK_MS + 1, region: 'eu-central-1' } },
    ]);
  });
});
