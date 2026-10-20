import type { Query } from '../core/ports';
import { onCommit } from '../data/lite/db';
import { utcDay } from '../mail/quota';

/** The day row of the meters: the cap of the office object (server/office/parts.ts) and its report read it. */
export const DAY_ROW_LITE = 'select rows_read, rows_written, requests, calls, worker_requests from usage_day where day = ?1';

/**
 * The meter of the office object (exit wave 3; wave 0 change 6). The Free day limits of Durable Objects are rows read (5 million),
 * rows written (100,000) and requests (100,000), each until 00:00 UTC. The meter counts them, the calls inside them, and the Worker
 * requests that the Worker reports with each object call. It keeps every count in memory and adds it in the next write transaction
 * (one row of usage_day), never in a statement of its own.
 *
 * The Usage section, the month meter and the 80% warning are gone (owner, 2026-10-23). The day counts stay because the CAP of the office
 * object blocks requests at the Free day limits (parts.ts, capDay). The tables usage_month and usage_warnings stay and nothing writes them.
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
const zero = (): DayCounts => ({ rowsRead: 0, rowsWritten: 0, requests: 0, calls: 0, workerRequests: 0 });
const countOf = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export class OfficeMeter {
  readonly #host: { readonly totals: { rowsRead: number; rowsWritten: number } };
  #pending: DayCounts = zero();
  #taken = { rowsRead: 0, rowsWritten: 0 };

  constructor(host: { readonly totals: { rowsRead: number; rowsWritten: number } }) {
    this.#host = host;
  }

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
    if (Object.values(day).every((n) => n === 0)) return;
    await q(DAY_FLUSH_LITE, [utcDay(now), day.rowsRead, day.rowsWritten, day.requests, day.calls, day.workerRequests]);
    onCommit(q, () => {
      this.#pending.rowsRead -= day.rowsRead;
      this.#pending.rowsWritten -= day.rowsWritten;
      this.#pending.requests -= day.requests;
      this.#pending.calls -= day.calls;
      this.#pending.workerRequests -= day.workerRequests;
    });
  }
}
