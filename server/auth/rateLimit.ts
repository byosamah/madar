import type { Query } from '../core/ports';

/**
 * Fixed-window rate limits in the rate_limits table (plan 4.2 and 5.1; task P2): the forgot route (3 a day for each email,
 * 10 an hour for each address) and users.resendInvite (5 a day for each person). One upsert counts a hit and gives the new
 * count, so two parallel hits never both pass the last place. The job deletes windows older than 1 day (plan 5.5).
 * A key that names a person's email or network address holds only a sha256 of it (hashedKey).
 */

export const RATE_SQL =
  'insert into rate_limits (key, window_start, count) values ($1, $2, 1) on conflict (key, window_start) do update set count = rate_limits.count + 1 returning count';

export type LimitResult = { ok: boolean; count: number; retryAfterMs: number };

/** Counts one hit of "key" in the window that holds "now". ok is false from the hit after "limit" on. */
export async function hitLimit(q: Query, o: { key: string; limit: number; windowMs: number; now: Date }): Promise<LimitResult> {
  const start = Math.floor(o.now.getTime() / o.windowMs) * o.windowMs;
  const [row] = await q<{ count: number | string }>(RATE_SQL, [o.key, new Date(start).toISOString()]);
  const count = Number(row?.count ?? 0);
  return { ok: count <= o.limit, count, retryAfterMs: start + o.windowMs - o.now.getTime() };
}

/** "<prefix>:<sha256 hex of the trimmed, lower-case value>". */
export async function hashedKey(prefix: string, value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return `${prefix}:${[...hash].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
