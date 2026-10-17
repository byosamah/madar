import { ApiError } from '../../src/api/errors';
import type { RunError } from '../core/types';
import { runErrorOf } from '../http/errors';
import type { DayRow } from './parts';

/**
 * The day cap of the test Worker (Supabase exit, wave 4; spec section 6: "a day cap on the test Worker"). The Free day limits count
 * for the whole Cloudflare account, so the test copy stops at its share and production keeps the rest (owner decision 6). The cap
 * reads the day meters of the office object (wave 3); the count may be up to one minute old (DAY_CAP_TTL_MS).
 */

export type DayCap = { rowsRead?: number; rowsWritten?: number; requests?: number };
export const DAY_CAP_TTL_MS = 60_000;
export const DAY_CAP_BUSY = new ApiError('failed', 'The test copy used its share of the free limits of today. It works again at 03:00 Riyadh.', { reason: 'busy' });

const KEYS: Readonly<Record<string, keyof DayCap>> = { rows_read: 'rowsRead', rows_written: 'rowsWritten', requests: 'requests' };

/** The cap of MADAR_DAY_CAP ("rows_written=50000,rows_read=2500000,requests=50000"), or null when the var is not set. */
export function dayCapOf(text: string | undefined): DayCap | null {
  if (!text) return null;
  const cap: DayCap = {};
  for (const part of text.split(',')) {
    const [name, value] = part.split('=').map((s) => s.trim());
    const key = KEYS[name ?? ''];
    const n = Number(value);
    if (!key || value === undefined || value === '' || !Number.isSafeInteger(n) || n <= 0) {
      throw new Error('MADAR_DAY_CAP holds name=number pairs: rows_written, rows_read and requests.');
    }
    cap[key] = n;
  }
  return cap;
}

/** Over the rows read or the requests, every call waits; over the rows written, only a write waits. */
export function capRefusal(day: DayRow, cap: DayCap, writes: boolean): RunError | undefined {
  const over = (used: number, limit: number | undefined) => limit !== undefined && used >= limit;
  if (over(day.rows_read, cap.rowsRead) || over(day.requests, cap.requests)) return runErrorOf(DAY_CAP_BUSY);
  if (writes && over(day.rows_written, cap.rowsWritten)) return runErrorOf(DAY_CAP_BUSY);
  return undefined;
}
