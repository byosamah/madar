import { describe, expect, it } from 'vitest';
import { buildDeps } from '../core/deps';
import type { Db } from '../core/ports';
import { COUNT_REQUEST_SQL, meterPort } from './meter';
import { registerUsageEffects } from './register';

/**
 * The usage meter (plan 5.8; task M1). It keeps the bytes that the loaders read and the change signals that were not sent in
 * memory, and countRequest writes them with the request in one statement of its own. server/it/usage.it.test.ts runs the SQL.
 */

type Statement = { mode: string; text: string; values: unknown[] };

function recordingDb(o: { fail?: number } = {}): Db & { statements: Statement[] } {
  let failures = o.fail ?? 0;
  const statements: Statement[] = [];
  const refuse = () => Promise.reject(new Error('The meter uses one statement, never a transaction.'));
  return {
    statements,
    tx: refuse,
    savepoint: refuse,
    async statement(mode, text, values = []) {
      if (failures > 0) {
        failures -= 1;
        throw new Error('The database is away.');
      }
      statements.push({ mode, text, values });
      return [];
    },
  };
}

describe('meterPort (plan 5.8)', () => {
  it('counts one request with the bytes read since the last request, in one write statement', async () => {
    const meter = meterPort();
    const db = recordingDb();
    meter.addBytes(1200);
    meter.addBytes(34);
    await meter.countRequest(db);
    expect(db.statements).toEqual([{ mode: 'write', text: COUNT_REQUEST_SQL, values: [1234, 0] }]);
  });

  it('sends each byte once: the next request starts from zero', async () => {
    const meter = meterPort();
    const db = recordingDb();
    meter.addBytes(500);
    await meter.countRequest(db);
    await meter.countRequest(db);
    expect(db.statements.map((s) => s.values)).toEqual([[500, 0], [0, 0]]);
  });

  it('counts the change signals that were not sent (signalsFailed, N1) and writes them with the next request', async () => {
    const meter = meterPort();
    const db = recordingDb();
    meter.signalsFailed(2);
    meter.signalsFailed(1);
    await meter.countRequest(db);
    expect(db.statements[0].values).toEqual([0, 3]);
    await meter.countRequest(db);
    expect(db.statements[1].values).toEqual([0, 0]);
  });

  it('ignores a count that is not a positive whole number', async () => {
    const meter = meterPort();
    const db = recordingDb();
    meter.addBytes(-5);
    meter.addBytes(Number.NaN);
    meter.addBytes(10.7);
    meter.signalsFailed(0);
    meter.signalsFailed(-1);
    await meter.countRequest(db);
    expect(db.statements[0].values).toEqual([10, 0]);
  });

  it('keeps the numbers for the next request when the statement fails, and lets the error go to the batch route', async () => {
    const meter = meterPort();
    const db = recordingDb({ fail: 1 });
    meter.addBytes(800);
    meter.signalsFailed(1);
    await expect(meter.countRequest(db)).rejects.toThrow('The database is away.');
    meter.addBytes(200);
    await meter.countRequest(db);
    expect(db.statements).toEqual([{ mode: 'write', text: COUNT_REQUEST_SQL, values: [1000, 1] }]);
  });

  it('counts in the UTC month of the database clock, adds to the row of that month, and keeps the time of the last failed signal', () => {
    expect(COUNT_REQUEST_SQL).toContain("to_char(now() at time zone 'utc', 'YYYY-MM')");
    expect(COUNT_REQUEST_SQL).toContain('on conflict (month) do update');
    expect(COUNT_REQUEST_SQL).toContain('signals_failed_at');
  });

  it('is the meter of the entries, so the batch route and the loaders report through it (deps.ts)', async () => {
    const env: Record<string, string> = {
      DATABASE_URL: 'postgres://madar_server:pw@127.0.0.1:54322/postgres',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_made_up_value' }),
      APP_URL: 'http://127.0.0.1:5173',
      MAIL_FROM: 'Madar <notices@madar.test>',
      MAIL_DRIVER: 'outbox',
    };
    const deps = buildDeps((name) => env[name]);
    const db = recordingDb();
    deps.meter.addBytes(42);
    await deps.meter.countRequest(db);
    expect(db.statements).toEqual([{ mode: 'write', text: COUNT_REQUEST_SQL, values: [42, 0] }]);
  });

  it('registers the usage.limitWarning handler once for the entries, so the job can run and retry the warning rows', () => {
    expect(() => registerUsageEffects()).toThrow(/usage.limitWarning is already registered/);
  });
});
