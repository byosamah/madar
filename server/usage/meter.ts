import type { MeterPort } from '../core/ports';
import './effects';

/**
 * The usage meter (plan 5.8; task M1). The loaders and the office cache report the bytes they read (the egress estimate,
 * plan 2 change 10), and the Realtime sender reports the change signals that realtime.send did not send (proof.md, Z0a item 5).
 * Both stay in memory until countRequest, which the batch route runs once for each request, after its calls: one statement of
 * its own adds the request, the bytes and the failed signals to the row of the UTC month in usage_month. A statement that fails
 * keeps the numbers for the next request, and the batch route logs the error.
 *
 * The import of ./effects registers the usage.limitWarning handler for every entry, since deps.ts imports this file.
 *
 * The numbers live in the isolate, so an isolate that stops before its next request loses a few bytes. The egress meter is an
 * estimate, and that is good enough for an 80% warning.
 */

/** $1 the bytes read, $2 the change signals that were not sent. The month is the UTC month of the database clock. */
export const COUNT_REQUEST_SQL = `insert into usage_month (month, calls, bytes_read, signals_failed, signals_failed_at)
values (to_char(now() at time zone 'utc', 'YYYY-MM'), 1, $1::bigint, $2::bigint, case when $2::bigint > 0 then now() end)
on conflict (month) do update set
  calls = usage_month.calls + 1,
  bytes_read = usage_month.bytes_read + excluded.bytes_read,
  signals_failed = usage_month.signals_failed + excluded.signals_failed,
  signals_failed_at = coalesce(excluded.signals_failed_at, usage_month.signals_failed_at)`;

/** A count that the meter takes: a positive number, as a whole number. */
const countOf = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function meterPort(): MeterPort {
  let bytes = 0;
  let signals = 0;
  return {
    addBytes(n) {
      bytes += countOf(n);
    },
    signalsFailed(count) {
      signals += countOf(count);
    },
    async countRequest(db) {
      // Take the numbers before the await, so a request that ends meanwhile counts its own bytes once.
      const taken = { bytes, signals };
      bytes = 0;
      signals = 0;
      try {
        await db.statement('write', COUNT_REQUEST_SQL, [taken.bytes, taken.signals]);
      } catch (error) {
        bytes += taken.bytes;
        signals += taken.signals;
        throw error;
      }
    },
  };
}
