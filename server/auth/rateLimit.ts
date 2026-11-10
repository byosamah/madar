import type { Query } from '../core/ports';
import { sqlFor } from '../data/dialect';

/**
 * Fixed-window rate limits in the rate_limits table (plan 4.2 and 5.1; task P2): the forgot route (3 an hour for each email,
 * 10 an hour for each address), users.resendInvite (5 a day for each person) and the limits of the own sign-in (own/limits.ts).
 * One upsert counts a hit and gives the new count, so two parallel hits never both pass the last place. The job deletes windows
 * older than 1 day (plan 5.5). A key that names a person's email or network address holds only a sha256 of it (hashedKey).
 *
 * The update has a condition (review 2026-11-10, finding 1): the hit that takes the count to limit + 1 is the last write of a
 * window. Each later hit of that window updates nothing and gets no row back, so a flood over the limit writes no rows (each row
 * write counts against the Free day limit of the office object).
 */

export const RATE_SQL =
  'insert into rate_limits (key, window_start, count) values ($1, $2, 1) on conflict (key, window_start) do update set count = rate_limits.count + 1 where rate_limits.count <= $3 returning count';
/** The SQLite form (Supabase exit, wave 2). */
export const RATE_LITE =
  'insert into rate_limits (key, window_start, count) values (?1, ?2, 1) on conflict (key, window_start) do update set count = rate_limits.count + 1 where rate_limits.count <= ?3 returning count';

export type LimitResult = { ok: boolean; count: number; retryAfterMs: number };

/**
 * Counts one hit of "key" in the window that holds "now". ok is false from the hit after "limit" on. The count is never above
 * limit + 1: no returned row means that the window is full already, and the hit wrote nothing.
 */
export async function hitLimit(q: Query, o: { key: string; limit: number; windowMs: number; now: Date }): Promise<LimitResult> {
  const start = Math.floor(o.now.getTime() / o.windowMs) * o.windowMs;
  const [row] = await q<{ count: number | string }>(sqlFor(q, RATE_SQL, RATE_LITE), [o.key, new Date(start).toISOString(), o.limit]);
  const count = row === undefined ? o.limit + 1 : Number(row.count);
  return { ok: count <= o.limit, count, retryAfterMs: start + o.windowMs - o.now.getTime() };
}

/** "<prefix>:<sha256 hex of the trimmed, lower-case value>". */
export async function hashedKey(prefix: string, value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return `${prefix}:${[...hash].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The four bytes of a dotted IPv4 address, or null. */
function ipv4Bytes(text: string): number[] | null {
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!parts) return null;
  const bytes = parts.slice(1).map(Number);
  return bytes.every((byte) => byte <= 255) ? bytes : null;
}

/** The eight 16-bit groups of an IPv6 address (with :: and a dotted IPv4 end), or null. */
function ipv6Groups(text: string): number[] | null {
  const halves = text.split('::');
  if (halves.length > 2 || (halves.length === 2 && halves[0].includes('.'))) return null;
  const groupsOf = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    const items = part.split(':');
    for (const [at, item] of items.entries()) {
      const v4 = at === items.length - 1 && item.includes('.') ? ipv4Bytes(item) : null;
      if (v4) out.push(v4[0] * 256 + v4[1], v4[2] * 256 + v4[3]);
      else if (/^[0-9a-f]{1,4}$/.test(item)) out.push(parseInt(item, 16));
      else return null;
    }
    return out;
  };
  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  return missing >= 1 ? [...head, ...new Array<number>(missing).fill(0), ...tail] : null;
}

/**
 * The network address of a limit key (review 2026-11-10, task D3b). One machine on IPv6 holds a whole /64 block, so an IPv6 address counts
 * as its first 4 groups, fully expanded (2001:db8:1:2::9 gives 2001:0db8:0001:0002). Without it, each new address of the block is a new
 * count, and one machine reaches the total stop of an email alone. It reads ::, short groups, upper case, brackets and a zone id after %.
 * An IPv4-mapped address (::ffff:1.2.3.4) gives the IPv4 address. An IPv4 address, and a text that is no address, stay as they are
 * (trimmed, lower-case). It never throws. Use it only where a key is built: clientAddress keeps the full address.
 */
export function limitAddress(address: string): string {
  const text = address.trim().toLowerCase();
  let host = text;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end < 0) return text;
    host = host.slice(1, end);
  }
  const zone = host.indexOf('%');
  if (zone >= 0) host = host.slice(0, zone);
  if (!host.includes(':')) return text;
  const groups = ipv6Groups(host);
  if (!groups) return text;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.');
  }
  return groups.slice(0, 4).map((group) => group.toString(16).padStart(4, '0')).join(':');
}
