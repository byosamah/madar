import type { Db, MeterPort, Query } from '../core/ports';
import { onCommit } from '../data/lite/db';
import { utcDay } from '../mail/quota';
import { utcMonth } from '../usage/meters';

/**
 * The meter of the office object (exit wave 3; wave 0 change 6). The Free day limits of Durable Objects are rows read (5 million),
 * rows written (100,000) and requests (100,000), each until 00:00 UTC. The meter counts them, the calls inside them, and the Worker
 * requests that the Worker reports with each object call. It keeps every count in memory and adds it in the next write transaction
 * (one row of usage_day, one of usage_month), never in a statement of its own: today's countRequest writes 1 row for each request.
 *
 * The rows come from the totals of the office object host (server/office/doHost.ts), which count every statement, also the
 * statements of a write that rolled back (proof.md, "Wave 1: the transaction facts": 2 rows written for a rolled-back insert). A
 * flush that rolls back keeps its counts for the next one. An object that sleeps loses the counts since its last write (an estimate,
 * as the bytes meter of today; wave 5 compares it with the Cloudflare numbers).
 */

export type DayCounts = { rowsRead: number; rowsWritten: number; requests: number; calls: number; workerRequests: number };

export const DAY_FLUSH_LITE =
  'insert into usage_day (day, rows_read, rows_written, requests, calls, worker_requests) values (?1, ?2, ?3, ?4, ?5, ?6) '
  + 'on conflict (day) do update set rows_read = usage_day.rows_read + excluded.rows_read, '
  + 'rows_written = usage_day.rows_written + excluded.rows_written, requests = usage_day.requests + excluded.requests, '
  + 'calls = usage_day.calls + excluded.calls, worker_requests = usage_day.worker_requests + excluded.worker_requests';
/** usage_month.calls counts the requests, as COUNT_REQUEST_SQL does on Postgres (server/usage/meter.ts). */
export const MONTH_FLUSH_LITE =
  'insert into usage_month (month, calls, bytes_read, signals_failed, signals_failed_at) values (?1, ?2, ?3, ?4, ?5) '
  + 'on conflict (month) do update set calls = usage_month.calls + excluded.calls, bytes_read = usage_month.bytes_read + excluded.bytes_read, '
  + 'signals_failed = usage_month.signals_failed + excluded.signals_failed, '
  + 'signals_failed_at = coalesce(excluded.signals_failed_at, usage_month.signals_failed_at)';
export const DAY_ROW_LITE = 'select rows_read, rows_written, requests, calls, worker_requests from usage_day where day = ?1';

const zero = (): DayCounts => ({ rowsRead: 0, rowsWritten: 0, requests: 0, calls: 0, workerRequests: 0 });
const countOf = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export class OfficeMeter implements MeterPort {
  readonly #host: { readonly totals: { rowsRead: number; rowsWritten: number } };
  #pending: DayCounts = zero();
  #taken = { rowsRead: 0, rowsWritten: 0 };
  #bytes = 0;
  #signals = 0;

  constructor(host: { readonly totals: { rowsRead: number; rowsWritten: number } }) {
    this.#host = host;
  }

  addBytes(n: number): void {
    this.#bytes += countOf(n);
  }

  signalsFailed(count: number): void {
    this.#signals += countOf(count);
  }

  /** The office object keeps every count in memory (see the file comment): no statement here. */
  async countRequest(_db: Db): Promise<void> {}

  /** One object request (an RPC call, a socket open), with the calls inside it and the Worker requests since the last report. */
  request(o: { calls?: number; worker?: number } = {}): void {
    this.#pending.requests += 1;
    this.#pending.calls += countOf(o.calls ?? 0);
    this.#pending.workerRequests += countOf(o.worker ?? 0);
  }

  /** The counts that no flush wrote yet, with the rows of the host since the last call. */
  pending(): DayCounts {
    const totals = this.#host.totals;
    this.#pending.rowsRead += totals.rowsRead - this.#taken.rowsRead;
    this.#pending.rowsWritten += totals.rowsWritten - this.#taken.rowsWritten;
    this.#taken = { rowsRead: totals.rowsRead, rowsWritten: totals.rowsWritten };
    return { ...this.#pending };
  }

  /** Adds the pending counts inside the write transaction of q. They leave memory only after the commit. */
  async flush(q: Query, now: Date): Promise<void> {
    const day = this.pending();
    const bytes = this.#bytes;
    const signals = this.#signals;
    if (Object.values(day).every((n) => n === 0) && bytes === 0 && signals === 0) return;
    await q(DAY_FLUSH_LITE, [utcDay(now), day.rowsRead, day.rowsWritten, day.requests, day.calls, day.workerRequests]);
    await q(MONTH_FLUSH_LITE, [utcMonth(now), day.requests, bytes, signals, signals > 0 ? now.toISOString() : null]);
    onCommit(q, () => {
      this.#pending.rowsRead -= day.rowsRead;
      this.#pending.rowsWritten -= day.rowsWritten;
      this.#pending.requests -= day.requests;
      this.#pending.calls -= day.calls;
      this.#pending.workerRequests -= day.workerRequests;
      this.#bytes -= bytes;
      this.#signals -= signals;
    });
  }
}
